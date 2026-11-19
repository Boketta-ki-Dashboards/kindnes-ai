import {describe, expect, it} from 'vitest';
import {loadAssetsConfig, loadMusicConfig, loadPipelineConfig} from '../src/core/config';
import {loadBeatMap, nearestBeat} from '../src/music/beatmap';
import {beatBefore, buildMusicEnvelope, speechOnTimeline} from '../src/music/envelope';
import {autoStoryGain, buildEditPlan} from '../src/edit/planner';
import {buildV4OutroPlan} from '../src/outro/v4';
import {buildV3Plans} from '../src/outro/v3';
import {syntheticAnalysis} from './helpers/fixtures';

const cfg = loadPipelineConfig();
const music = loadMusicConfig();
const bm = loadBeatMap(music);
const fps = 30;
const db = (env: {db: number[]}, t: number) => env.db[Math.round(t * fps)];

describe('music envelope (one continuous song with dramaturgy)', () => {
  const story = 20;
  const songStart = 48.216 - story;
  const env = buildMusicEnvelope({fps, totalSec: story + 10.9, storySec: story, songStart, drop: 48.216, beatmap: bm, cfg, speech: [[6, 9]], storyAudible: true});

  it('phase A: starts quiet (≈ -20 dB) after a short fade-in', () => {
    expect(db(env, 0)).toBeLessThan(-40);
    expect(db(env, 0.5)).toBeCloseTo(cfg.audio.storyMusic.startDb, 0);
  });
  it('phase B: body level, ducked by the configured depth while people speak (with look-ahead)', () => {
    expect(db(env, 5)).toBeCloseTo(cfg.audio.storyMusic.bodyDb, 1);
    expect(db(env, 7.5)).toBeCloseTo(cfg.audio.storyMusic.bodyDb - cfg.audio.ducking.depthDb, 1);
    // attack starts before the speech, release after it – no hard steps
    expect(db(env, 6 - cfg.audio.ducking.attackSec / 2)).toBeLessThan(cfg.audio.storyMusic.bodyDb);
    const steps = env.db.slice(1).map((x, i) => Math.abs(x - env.db[i]));
    expect(Math.max(...steps.slice(Math.round(1 * fps)))).toBeLessThan(2.5);
  });
  it('phase C: the build-up starts on a beat, N beats before the drop, and rises smoothly', () => {
    const songT = songStart + env.buildUpStart;
    expect(Math.abs(nearestBeat(bm.beats, songT) - songT)).toBeLessThan(0.002);
    expect(48.216 - songT).toBeCloseTo(cfg.audio.storyMusic.buildUpBeats * bm.beatPeriodSec, 1);
    const seg = env.db.slice(Math.round(env.buildUpStart * fps), Math.round(story * fps));
    for (let i = 1; i < seg.length; i++) expect(seg[i]).toBeGreaterThanOrEqual(seg[i - 1] - 0.05);
  });
  it('phase D: exactly the outro level at the drop – no jump, no restart', () => {
    expect(db(env, story - 1 / fps)).toBeGreaterThan(cfg.audio.musicGainDb - 0.6);
    expect(db(env, story)).toBe(cfg.audio.musicGainDb);
    expect(db(env, story + 5)).toBe(cfg.audio.musicGainDb);
  });
  it('no ducking when the clip audio is muted', () => {
    const e2 = buildMusicEnvelope({fps, totalSec: 30, storySec: 20, songStart, drop: 48.216, beatmap: bm, cfg, speech: [[6, 9]], storyAudible: false});
    expect(db(e2, 7.5)).toBeCloseTo(cfg.audio.storyMusic.bodyDb, 1);
  });
  it('an early build-up never starts from silence (outro preview lead-in)', () => {
    const p = buildV4OutroPlan();
    const e = p.music.envelope!;
    expect(e.buildUpStart).toBe(0);
    expect(db(e, 0.5)).toBeGreaterThan(-25);
    expect(db(e, p.outro.start)).toBe(cfg.audio.musicGainDb);
  });
  it('beatBefore extrapolates before the first beat', () => {
    expect(beatBefore(bm, bm.beats[2], 5)).toBeLessThan(bm.beats[0]);
  });
});

describe('speech mapping and planner integration', () => {
  it('maps source speech through the story segments to the timeline', () => {
    const t = speechOnTimeline([[2, 5], [12, 14]], [{srcIn: 1, srcOut: 6, start: 0}, {srcIn: 10, srcOut: 15, start: 5}]);
    expect(t).toEqual([[1, 4], [7, 9]]);
  });
  it('mutes a clip that already contains the song and keeps the envelope', () => {
    const a = {...syntheticAnalysis(30, {peak: 20}), speech: {segments: [[3, 6]] as [number, number][]}};
    const assets = loadAssetsConfig();
    const p = buildEditPlan({jobId: 't', candidateId: 'c', storySrc: 'x.mp4', analysis: a, config: cfg, music, beatmap: bm, assets, overrides: {variant: 'V4', outroOverlay: 'dictionary'}, songInClip: true});
    expect(p.story.audioGain).toBe(0);
    expect(p.story.songInClip).toBe(true);
    expect(p.music.envelope!.ducked).toEqual([]);
    const q = buildEditPlan({jobId: 't', candidateId: 'c', storySrc: 'x.mp4', analysis: a, config: cfg, music, beatmap: bm, assets, overrides: {variant: 'V4', outroOverlay: 'dictionary'}, songInClip: false});
    expect(q.story.audioGain).toBe(autoStoryGain(a, a.speech.segments, cfg)); // automatic story level
    expect(q.music.envelope!.ducked.length).toBe(1);
    const r = buildEditPlan({jobId: 't', candidateId: 'c', storySrc: 'x.mp4', analysis: a, config: cfg, music, beatmap: bm, assets, overrides: {variant: 'V4', outroOverlay: 'dictionary', storyAudioGain: 0.5}, songInClip: true});
    expect(r.story.audioGain).toBe(0.5); // a manual override always wins (also over the song-in-clip mute)
  });
  it('automatic story level: speech RMS → target, clamped to the configured range', () => {
    const lv = cfg.audio.storyLevel;
    const half = (db: number) => ({audio: {halfSecond: Array.from({length: 20}, (_, i) => ({t: i / 2, rmsDb: db, onset: 0, flatness: 0}))}}) as never;
    const g = (db: number) => 20 * Math.log10(autoStoryGain(half(db), [[0, 10]], cfg));
    expect(g(lv.targetSpeechRmsDb - 5)).toBeCloseTo(5, 1);
    expect(g(-80 + 15)).toBeCloseTo(lv.maxGainDb, 1);
    expect(g(0)).toBeCloseTo(lv.minGainDb, 1);
    expect(autoStoryGain({audio: {halfSecond: []}} as never, [], cfg)).toBe(cfg.audio.storyAudioGain);
  });
});

describe('V4 outro', () => {
  const p = buildV4OutroPlan();
  it('definition fade-in comes from config: 0.30 s after the drop, 0.25 s long', () => {
    expect(cfg.text.dictionary.fadeInDelaySec).toBe(0.3);
    expect(cfg.text.dictionary.fadeInDurationSec).toBe(0.25);
    expect(p.outro.dictionary!.fadeInAt).toBe(0.3);
    expect(p.outro.dictionary!.fadeInDur).toBe(0.25);
    expect(p.texts).toEqual([]); // no extra text in the definition version
  });
  it('every curated shot is a different motif, Thorfinn on the drop, calm V3 ending kept', () => {
    const motifs = p.outro.shots.map((s) => s.motif);
    expect(new Set(motifs).size).toBe(motifs.length);
    expect(p.outro.shots[0].tag).toBe('thorfinn-face');
    expect(motifs.slice(-3)).toEqual(['father-child-silhouette', 'field-rock-tree', 'adult-trees-final']);
    expect(p.warnings).toEqual([]);
  });
  it('keeps the V3 look: same format, grade, framing, zoom, drop and outro length', () => {
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
    expect(p.fps).toBe(30);
    expect(p.outro.grade).toBe('golden');
    expect(p.music.drop).toBeCloseTo(48.216, 6);
    const v3 = buildV3Plans(cfg).definition;
    expect(p.durationSec).toBe(v3.durationSec); // same outro length as V3
    expect(p.outro.end - p.outro.start).toBe(v3.outro.end - v3.outro.start);
  });
});
