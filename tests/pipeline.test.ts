import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {CandidateStore} from '../src/core/store';
import {loadPipelineConfig} from '../src/core/config';
import {allQueries, nextQueries, BASE_TERMS} from '../src/discovery/queries';
import type {SearchAdapter, SearchHit} from '../src/discovery/adapters/types';
import {AdapterBlockedError} from '../src/discovery/adapters/types';
import * as P from '../src/pipeline/pipeline';
import {acquireMedia} from '../src/acquisition/acquire';
import {candidate, tmpDir} from './helpers/fixtures';

function freshStore() {
  const d = tmpDir();
  return new CandidateStore(path.join(d, 'candidates.json'), path.join(d, 'productions.json'));
}

const hit = (id: string, title: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  platform: 'youtube', platformId: id, url: `https://www.youtube.com/watch?v=${id}`, title, durationSec: 40, mediaStatus: 'manual_required', ...extra,
});

function fakeAdapter(name: string, hits: SearchHit[] | Error): SearchAdapter {
  return {platform: 'youtube', name, capabilities: 'test', search: async () => {
    if (hits instanceof Error) throw hits;
    return hits;
  }};
}

describe('search terms', () => {
  it('contains every term from the brief plus multilingual variants', () => {
    const q = allQueries();
    for (const t of BASE_TERMS) expect(q).toContain(t.toLowerCase());
    expect(q.some((x) => /menschlichkeit/i.test(x))).toBe(true);
    expect(q.some((x) => /bondad/i.test(x))).toBe(true);
  });
  it('rotates so consecutive runs search different terms', () => {
    const f = path.join(tmpDir(), 'qs.json');
    const a = nextQueries(10, f);
    const b = nextQueries(10, f);
    expect(a.filter((x) => b.includes(x))).toEqual([]);
  });
});

describe('discovery run (fake adapters, no network)', () => {
  it('adds new candidates, recognises known ones and filters by duration', async () => {
    const s = freshStore();
    const cfg = loadPipelineConfig();
    const adapters = [
      fakeAdapter('a', [hit('AAA1', 'Stranger helps elderly man cross the road'), hit('LONG1', 'Some long compilation', {durationSec: 3600})]),
      fakeAdapter('b', [hit('AAA1', 'Stranger helps elderly man cross the road'), hit('BBB2', 'Runner carries injured opponent to the finish line')]),
    ];
    const r = await P.discover(s, cfg, {queries: ['q1'], adapterList: adapters});
    expect(r.added.sort()).toEqual(['yt_AAA1', 'yt_BBB2']);
    expect(r.perAdapter.a.filtered).toBe(1);
    expect(r.perAdapter.b.duplicates).toBe(1);
    expect(s.require('yt_AAA1').state).toBe('METADATA_ANALYZED');
    // second run: nothing new
    const r2 = await P.discover(s, cfg, {queries: ['q1'], adapterList: adapters});
    expect(r2.added).toEqual([]);
  });
  it('stops querying a platform that blocks us and reports it', async () => {
    const s = freshStore();
    const r = await P.discover(s, loadPipelineConfig(), {queries: ['q1', 'q2', 'q3'], adapterList: [fakeAdapter('blocked', new AdapterBlockedError('reddit', 'HTTP 403'))]});
    expect(r.perAdapter.blocked.blocked).toBe(true);
  });
});

describe('scoring rules in the pipeline', () => {
  it('>= threshold goes to SHORTLISTED, below to ARCHIVED (kept, restorable)', async () => {
    const s = freshStore();
    const cfg = loadPipelineConfig();
    await P.discover(s, cfg, {queries: ['q'], adapterList: [fakeAdapter('a', [
      hit('GOOD1', 'Stranger surprises homeless man with a new home, he cries tears of joy', {viewCount: 3_000_000, description: 'heartwarming unexpected kindness reaction caught on camera', width: 1080, height: 1920}),
      hit('BAD1', 'Official music video lyrics', {durationSec: 200}),
    ])]});
    const r = P.scoreCandidates(s, cfg);
    expect(r.scored).toBe(2);
    const good = s.require('yt_GOOD1');
    const bad = s.require('yt_BAD1');
    expect(good.score!.provisional).toBe(true);
    expect(bad.state).toBe('ARCHIVED');
    expect(good.state).toBe(good.score!.total >= 75 ? 'SHORTLISTED' : 'ARCHIVED');
    P.setStatus(s, bad, 'restore');
    expect(bad.state).toBe('SHORTLISTED');
    expect(s.all().length).toBe(2); // nothing deleted
  });
});

describe('resume after failures', () => {
  it('a failed render can be retried from SELECTED without redoing discovery/scoring', () => {
    const s = freshStore();
    const c = candidate({title: 'x'});
    s.add(c);
    for (const st of ['METADATA_ANALYZED', 'SCORED', 'SHORTLISTED', 'SELECTED', 'EDITING', 'RENDER_FAILED'] as const) s.setState(c, st);
    expect(P.retry(s, c)).toBe('SELECTED');
    expect(c.history.filter((h) => h.to === 'SCORED').length).toBe(1);
  });
});

describe('acquisition only through permitted routes', () => {
  it('never downloads YouTube/Dailymotion/TikTok media by default', async () => {
    const cfg = loadPipelineConfig();
    for (const platform of ['youtube', 'dailymotion', 'tiktok'] as const) {
      const r = await acquireMedia(candidate({title: 'x', platform}), cfg);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/media\/inbox|Creative-Commons/);
    }
  });
});
