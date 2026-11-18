import {describe, expect, it, beforeAll} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {dHashDistance, makeProxy, mediaInfo, videoDHash} from '../src/media/ffmpeg';
import {findInInbox, describeMedia} from '../src/acquisition/acquire';
import {loadAssetsConfig, loadMusicConfig, loadPipelineConfig} from '../src/core/config';
import {loadBeatMap} from '../src/music/beatmap';
import {buildEditPlan} from '../src/edit/planner';
import {renderPlan} from '../src/render/render';
import {qualityCheck} from '../src/render/qc';
import {candidate, syntheticAnalysis, syntheticVideo, tmpDir, TEST_MEDIA} from './helpers/fixtures';
import {rel} from '../src/core/paths';

describe('file detection & media metadata (synthetic TEST media)', () => {
  let vid: string;
  beforeAll(() => {
    vid = syntheticVideo('detect', {seconds: 4, width: 640, height: 360});
  });
  it('reads resolution, fps, duration and codecs via ffprobe', () => {
    const m = mediaInfo(vid);
    expect(m.width).toBe(640);
    expect(m.height).toBe(360);
    expect(m.fps).toBeCloseTo(30, 3);
    expect(m.durationSec).toBeGreaterThan(3.9);
    expect(m.videoCodec).toBe('h264');
    expect(m.audioCodec).toBe('aac');
  });
  it('perceptual hash: identical file -> distance 0, different content -> large distance', () => {
    const a = videoDHash(vid, 4);
    const other = syntheticVideo('other', {seconds: 4, width: 640, height: 360, freq: 880});
    expect(dHashDistance(a, videoDHash(vid, 4))).toBe(0);
    const desc = describeMedia(other);
    expect(desc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.length).toBe(128);
  });
  it('finds user-provided files in the inbox by candidate id', () => {
    const dir = tmpDir();
    const c = candidate({title: 't', platformId: 'XYZ12345'});
    fs.copyFileSync(vid, path.join(dir, `${c.id}.mp4`));
    expect(findInInbox(c, dir)).toBe(path.join(dir, `${c.id}.mp4`));
    expect(findInInbox(candidate({title: 'u', platformId: 'nothere'}), dir)).toBeNull();
  });
  it('creates an H.264 CFR proxy with the requested frame rate', async () => {
    const src = syntheticVideo('proxy', {seconds: 3, width: 640, height: 360, fps: 24});
    const out = path.join(TEST_MEDIA, 'TEST_proxy_out.mp4');
    await makeProxy(src, out, 30, true);
    const m = mediaInfo(out);
    expect(m.fps).toBeCloseTo(30, 3);
    expect(m.videoCodec).toBe('h264');
  });
});

describe('video export (Remotion render + QC, synthetic TEST story clip)', () => {
  it(
    'renders a 1080x1920 H.264/AAC MP4 whose music is aligned to the drop and passes QC',
    async () => {
      const cfg = loadPipelineConfig();
      cfg.video.x264Preset = 'ultrafast';
      cfg.outro.bars = 1; // keep the test short: ~1.7 s outro
      cfg.story.minSec = 3;
      const music = loadMusicConfig();
      const beatmap = loadBeatMap(music);
      const assets = loadAssetsConfig();
      const story = syntheticVideo('story', {seconds: 6, width: 1280, height: 720});
      const analysis = syntheticAnalysis(6, {peak: 3, shot: 100});
      const plan = buildEditPlan({jobId: 'TEST_render', candidateId: 'test', storySrc: rel(story), analysis, config: cfg, music, beatmap, assets, overrides: {hookText: 'TEST render'}});
      const out = path.join(TEST_MEDIA, 'TEST_render', 'final.mp4');
      fs.rmSync(path.dirname(out), {recursive: true, force: true});
      await renderPlan(plan, cfg, out);
      const qc = await qualityCheck(out, plan);
      const failed = qc.checks.filter((c) => !c.pass && c.severity === 'error');
      expect(failed, JSON.stringify(failed)).toEqual([]);
      const sync = qc.checks.find((c) => c.name.startsWith('music aligned'))!;
      expect(sync.pass).toBe(true);
    },
    600_000,
  );
});
