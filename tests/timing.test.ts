import {describe, expect, it} from 'vitest';
import {beatAfter, computeSongWindow, loadBeatMap, nearestBeat, snapToBeat} from '../src/music/beatmap';
import {loadAssetsConfig, loadMusicConfig, loadPipelineConfig, type MusicConfig} from '../src/core/config';
import {outroSlots, planOutro} from '../src/outro/outro';
import {buildEditPlan, contentRange, selectStorySegments} from '../src/edit/planner';
import {buildOutroPreviewPlan} from '../src/outro/preview';
import {gridBeatMap, syntheticAnalysis} from './helpers/fixtures';

const music: MusicConfig = {track: 'assets/music/meant-to-be.mp3', title: 'Meant to Be', beatmap: 'data/analysis/music/meant-to-be.beatmap.json', drop: {auto: 48.216, source: 'test', evidence: [], manualOverride: null}, earliestSongStart: 0};

describe('beat map (real analysis of "Meant to Be")', () => {
  const bm = loadBeatMap(loadMusicConfig());
  it('has a plausible tempo and a dense beat grid', () => {
    expect(bm.bpm).toBeGreaterThan(130);
    expect(bm.bpm).toBeLessThan(150);
    expect(bm.beats.length).toBeGreaterThan(300);
    const ibi = bm.beats.slice(1).map((b, i) => b - bm.beats[i]);
    const med = [...ibi].sort((a, b) => a - b)[Math.floor(ibi.length / 2)];
    expect(med).toBeCloseTo(60 / bm.bpm, 2);
  });
  it('the configured drop (48.216 s) is a detected downbeat', () => {
    const drop = loadMusicConfig().drop.auto;
    expect(Math.abs(nearestBeat(bm.downbeats, drop) - drop)).toBeLessThan(0.03);
  });
});

describe('music sync math', () => {
  const bm = gridBeatMap(120, 120); // beats at 0.1, 0.6, 1.1 ...
  it('snaps only within tolerance', () => {
    expect(nearestBeat(bm.beats, 1.0)).toBeCloseTo(1.1, 5);
    expect(snapToBeat(bm.beats, 1.0, 0.15)).toBeCloseTo(1.1, 5);
    expect(snapToBeat(bm.beats, 0.85, 0.1)).toBeCloseTo(0.85, 5);
  });
  it('beatAfter extrapolates past the end of the grid', () => {
    const last = bm.beats[bm.beats.length - 1];
    expect(beatAfter(bm, last, 4)).toBeCloseTo(last + 2, 5);
  });
  it('aligns the song so the drop lands exactly at the end of the story', () => {
    const m = {...music, drop: {...music.drop, auto: 48.1}};
    const w = computeSongWindow(bm, m, 30, 6, 0.6);
    expect(w.songStart).toBeCloseTo(18.1, 5);
    expect(w.songStart + w.storyDuration).toBeCloseTo(w.drop, 6);
    expect(w.outroEnd).toBeCloseTo(48.1 + 6 * 4 * 0.5, 5);
  });
  it('a manual drop correction moves every timing accordingly', () => {
    const m = {...music, drop: {...music.drop, auto: 48.1, manualOverride: 60.1}};
    const w = computeSongWindow(bm, m, 30, 6, 0.6);
    expect(w.drop).toBeCloseTo(60.1, 5);
    expect(w.songStart).toBeCloseTo(30.1, 5);
  });
  it('refuses stories that are longer than the music before the drop', () => {
    const m = {...music, drop: {...music.drop, auto: 20.1}};
    expect(() => computeSongWindow(bm, m, 30, 6, 0.6)).toThrow(RangeError);
  });
});

describe('outro synchronisation', () => {
  const bm = gridBeatMap(120, 120);
  it('slots follow the beat pattern and end exactly at the outro end', () => {
    const slots = outroSlots(bm, 48.1, 60.1, [2, 1, 1]);
    expect(slots[0].start).toBeCloseTo(48.1, 5);
    expect(slots[0].end - slots[0].start).toBeCloseTo(1.0, 5);
    expect(slots[1].end - slots[1].start).toBeCloseTo(0.5, 5);
    expect(slots.at(-1)!.end).toBeCloseTo(60.1, 5);
    for (let i = 1; i < slots.length; i++) expect(slots[i].start).toBeCloseTo(slots[i - 1].end, 6);
  });
  it('outro shots are contiguous, start on the drop and cut slightly before the beat', () => {
    const assets = loadAssetsConfig();
    const variant = assets.outroVariants.find((v) => v.id === 'A')!;
    const a = syntheticAnalysis(56, {shot: 1.6});
    const res = planOutro({assets, variant, map: bm, drop: 48.1, outroEnd: 60.1, fadeOutSec: 0.6, fps: 30, cutLeadFrames: 2, analysisLoader: () => a});
    expect(res.shots[0].start).toBeCloseTo(0, 6);
    for (let i = 1; i < res.shots.length; i++) {
      expect(res.shots[i].start).toBeCloseTo(res.shots[i - 1].start + res.shots[i - 1].duration, 5);
      const cutSong = 48.1 + res.shots[i].start;
      const beat = nearestBeat(bm.beats, cutSong);
      expect(beat - cutSong).toBeCloseTo(2 / 30, 5); // 2 frames early
    }
    const end = res.shots.at(-1)!;
    expect(end.start + end.duration).toBeCloseTo(60.1 + 0.6 - 48.1, 5);
  });
  it('builds previews for every configured variant from the real analysed sources', () => {
    const cfg = loadPipelineConfig();
    const assets = loadAssetsConfig();
    const realMusic = loadMusicConfig();
    for (const v of assets.outroVariants) {
      const p = buildOutroPreviewPlan({variantId: v.id, config: cfg, music: realMusic, beatmap: loadBeatMap(realMusic), assets});
      expect(p.outro.shots.length).toBeGreaterThan(0);
      for (const s of p.outro.shots) expect(s.srcIn).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('story cut timing', () => {
  const bm = gridBeatMap(120, 160);
  const cfg = loadPipelineConfig();
  const assets = loadAssetsConfig();
  const outroLoader = () => syntheticAnalysis(56, {shot: 1.6});

  it('ends the story right after the emotional peak and puts the drop there', () => {
    const a = syntheticAnalysis(30, {peak: 20, shot: 100});
    const plan = buildEditPlan({jobId: 't', candidateId: 'c', storySrc: 'x.mp4', analysis: a, config: cfg, music, beatmap: bm, assets, outroAnalysisLoader: outroLoader});
    const last = plan.story.segments.at(-1)!;
    expect(last.srcOut).toBeCloseTo(20 + cfg.story.reactionHoldSec, 3);
    expect(plan.music.songStart + plan.story.duration).toBeCloseTo(plan.music.drop, 3);
    expect(plan.transition.at).toBeCloseTo(plan.story.duration, 3);
    expect(plan.outro.start).toBeCloseTo(plan.story.duration, 3);
    expect(plan.durationSec).toBeCloseTo(plan.story.duration + (plan.music.songEnd - plan.music.drop), 3);
    expect(plan.story.highlight.timelineTime).toBeLessThan(plan.story.duration);
  });

  it('respects the maximum story length and keeps the climax when shortening', () => {
    const a = syntheticAnalysis(120, {peak: 100, shot: 5});
    const segs = selectStorySegments(a, 0, 102, 100, 40);
    const total = segs.reduce((s, x) => s + x.srcOut - x.srcIn, 0);
    expect(total).toBeLessThanOrEqual(40.001);
    expect(segs.at(-1)!.srcOut).toBeCloseTo(102, 3);
    expect(segs[0].srcIn).toBeCloseTo(0, 3); // context shot kept
  });

  it('puts internal jump cuts on the beat without moving the drop', () => {
    const a = syntheticAnalysis(120, {peak: 100, shot: 5});
    const plan = buildEditPlan({jobId: 't', candidateId: 'c', storySrc: 'x.mp4', analysis: a, config: cfg, music, beatmap: bm, assets, outroAnalysisLoader: outroLoader});
    expect(plan.story.segments.length).toBeGreaterThan(1);
    for (const seg of plan.story.segments.slice(1)) {
      const songT = plan.music.songStart + seg.start;
      expect(Math.abs(nearestBeat(bm.beats, songT) - songT)).toBeLessThan(0.21);
    }
    expect(plan.music.songStart + plan.story.duration).toBeCloseTo(plan.music.drop, 3);
  });

  it('skips leading/trailing black frames', () => {
    const a = syntheticAnalysis(30);
    a.blackSegments = [{start: 0, end: 1.2}, {start: 28.5, end: 30}];
    expect(contentRange(a)).toEqual([1.2, 28.5]);
  });

  it('keeps all texts inside the video duration', () => {
    const a = syntheticAnalysis(30, {peak: 20});
    const plan = buildEditPlan({jobId: 't', candidateId: 'c', storySrc: 'x.mp4', analysis: a, config: cfg, music, beatmap: bm, assets, overrides: {hookText: 'He did not expect this'}, outroAnalysisLoader: outroLoader});
    for (const t of plan.texts) {
      expect(t.start).toBeGreaterThanOrEqual(0);
      expect(t.end).toBeLessThanOrEqual(plan.durationSec);
    }
  });
});
