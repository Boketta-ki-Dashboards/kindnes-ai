import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {CandidateStore, canonicalUrl, titleFingerprint} from '../src/core/store';
import {canTransition, retryTarget, transition, TransitionError} from '../src/core/state';
import {candidate, tmpDir} from './helpers/fixtures';

function freshStore() {
  const d = tmpDir();
  return new CandidateStore(path.join(d, 'candidates.json'), path.join(d, 'productions.json'));
}

describe('duplicate detection', () => {
  it('canonicalises YouTube/TikTok/Dailymotion URL variants', () => {
    expect(canonicalUrl('https://youtu.be/abcDEF12345')).toBe('youtube:abcDEF12345');
    expect(canonicalUrl('https://www.youtube.com/watch?v=abcDEF12345&t=10s')).toBe('youtube:abcDEF12345');
    expect(canonicalUrl('https://m.youtube.com/shorts/abcDEF12345')).toBe('youtube:abcDEF12345');
    expect(canonicalUrl('https://www.tiktok.com/@x/video/7312345678901234567?lang=de')).toBe('tiktok:7312345678901234567');
    expect(canonicalUrl('https://www.dailymotion.com/video/x8abc12')).toBe('dailymotion:x8abc12');
  });

  it('rejects the same video by id, by URL and by near-identical title', () => {
    const s = freshStore();
    const a = candidate({title: 'Stranger helps homeless man get a haircut', platformId: 'AAA111', url: 'https://www.youtube.com/watch?v=AAA111', durationSec: 60});
    expect(s.add(a).added).toBe(true);
    expect(s.add(candidate({title: 'other', platformId: 'AAA111', url: 'https://www.youtube.com/watch?v=AAA111'})).duplicate?.reason).toBe('same-id');
    expect(s.add(candidate({title: 'other', platformId: 'ZZZ', url: 'https://youtu.be/AAA111'})).duplicate?.reason).toBe('same-url');
    const reupload = candidate({title: 'Stranger HELPS homeless man get a haircut!! #shorts', platformId: 'BBB222', url: 'https://www.youtube.com/watch?v=BBB222', durationSec: 61});
    expect(s.add(reupload).duplicate?.reason).toBe('similar-title');
    expect(s.add(candidate({title: 'Dog guides blind cat home', platformId: 'CCC333', url: 'https://www.youtube.com/watch?v=CCC333'})).added).toBe(true);
  });

  it('title fingerprints ignore hashtags, case and filler words', () => {
    expect(titleFingerprint('The Kindness of Strangers #shorts')).toBe(titleFingerprint('kindness strangers'));
  });

  it('prevents a second production of the same media', () => {
    const s = freshStore();
    const a = candidate({title: 'a'});
    a.media = {status: 'available', local: {path: 'x.mp4', durationSec: 10, width: 1, height: 1, fps: 30, sha256: 'abc'}};
    s.recordProduction({candidateId: 'other', jobId: 'j1', mediaSha256: 'abc', status: 'rendered'});
    expect(s.findProduction(a)?.jobId).toBe('j1');
  });
});

describe('state machine', () => {
  it('follows the documented happy path', () => {
    const c = candidate({title: 'x'});
    for (const st of ['METADATA_ANALYZED', 'CONTENT_ANALYZED', 'SCORED', 'SHORTLISTED', 'SELECTED', 'EDITING', 'RENDERED', 'QUALITY_CHECKED', 'REVIEW', 'APPROVED', 'EXPORTED'] as const) {
      transition(c, st);
    }
    expect(c.state).toBe('EXPORTED');
    expect(c.history.length).toBe(12);
  });

  it('rejects skipping steps (e.g. no approval without review)', () => {
    const c = candidate({title: 'x'});
    expect(() => transition(c, 'APPROVED')).toThrow(TransitionError);
    expect(canTransition('RENDERED', 'APPROVED')).toBe(false);
    expect(canTransition('SCORED', 'EXPORTED')).toBe(false);
  });

  it('error states can be entered and retried without restarting the whole process', () => {
    const c = candidate({title: 'x'});
    for (const st of ['METADATA_ANALYZED', 'SCORED', 'SHORTLISTED', 'SELECTED', 'EDITING'] as const) transition(c, st);
    transition(c, 'RENDER_FAILED', 'boom');
    expect(retryTarget(c)).toBe('SELECTED');
    transition(c, 'SELECTED');
    transition(c, 'EDITING');
    expect(c.state).toBe('EDITING');
  });

  it('an interrupted production (EDITING / RENDERED) can resume', () => {
    expect(canTransition('EDITING', 'SELECTED')).toBe(true);
    expect(canTransition('RENDERED', 'SELECTED')).toBe(true);
  });

  it('archived (< 75) candidates are restorable, never deleted', () => {
    const c = candidate({title: 'x'});
    for (const st of ['METADATA_ANALYZED', 'SCORED', 'ARCHIVED', 'SCORED', 'SHORTLISTED'] as const) transition(c, st);
    expect(c.state).toBe('SHORTLISTED');
  });
});
