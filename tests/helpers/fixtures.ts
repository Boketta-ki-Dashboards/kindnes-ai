import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import type {VideoAnalysis} from '../../src/outro/outro';
import type {BeatMap} from '../../src/music/beatmap';
import type {Candidate} from '../../src/core/types';
import {newCandidate} from '../../src/core/store';

/** Folder for clearly-labelled synthetic TEST media (never committed). */
export const TEST_MEDIA = path.resolve('.cache/test-media');

export function tmpDir(prefix = 'kai-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Synthetic test video: colour bars + moving box + sine tone, labelled TEST. */
export function syntheticVideo(name: string, opts: {seconds?: number; width?: number; height?: number; fps?: number; freq?: number; source?: string} = {}): string {
  const {seconds = 6, width = 640, height = 360, fps = 30, freq = 440, source = 'testsrc2'} = opts;
  fs.mkdirSync(TEST_MEDIA, {recursive: true});
  const out = path.join(TEST_MEDIA, `TEST_${name}_${width}x${height}_${seconds}s.mp4`);
  if (fs.existsSync(out)) return out;
  const r = spawnSync('ffmpeg', [
    '-nostdin', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `${source}=size=${width}x${height}:rate=${fps}:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=48000:duration=${seconds}`,
    '-vf', `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='TEST MEDIA':x=20:y=20:fontsize=${Math.round(height / 10)}:fontcolor=white:box=1:boxcolor=black@0.6`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
  ]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return out;
}

/** Regular beat grid (e.g. 120 BPM) as a BeatMap. */
export function gridBeatMap(bpm = 120, duration = 120): BeatMap {
  const p = 60 / bpm;
  const beats: number[] = [];
  for (let t = 0.1; t < duration; t += p) beats.push(Number(t.toFixed(4)));
  return {
    schema: 'kindness-ai/beatmap', analysisVersion: 2, source: {path: 'synthetic', sha256: 'x'}, durationSec: duration, bpm,
    beatPeriodSec: p, meter: 4, beats, downbeats: beats.filter((_, i) => i % 4 === 0), strongOnsets: [], sections: [], dropCandidates: [],
    loudness: {integratedLufs: -14, loudnessRangeLu: 4, truePeakDbfs: -1},
  };
}

/** Synthetic analysis: shots every `shot` seconds, loud reaction around `peak`. */
export function syntheticAnalysis(duration: number, opts: {shot?: number; peak?: number; width?: number; height?: number} = {}): VideoAnalysis {
  const {shot = 4, peak = duration * 0.7, width = 1280, height = 720} = opts;
  const cuts = [] as {time: number; score: number}[];
  for (let t = shot; t < duration; t += shot) cuts.push({time: t, score: 0.6});
  const bounds = [0, ...cuts.map((c) => c.time), duration];
  const n = Math.ceil(duration);
  return {
    info: {width, height, fps: 30, durationSec: duration},
    cuts,
    shots: bounds.slice(0, -1).map((s, i) => ({start: s, end: bounds[i + 1], duration: bounds[i + 1] - s, meanMotion: 0.03, meanBrightness: 0.5, focusX: 0.5, warmth: 0.1})),
    blackSegments: [],
    perSecond: {motion: Array(n).fill(0.03), brightness: Array(n).fill(0.5), focusX: Array(n).fill(0.5), sharpness: Array(n).fill(0.05), warmth: Array(n).fill(0.1)},
    highlights: [{time: peak, score: 2, features: {loudnessZ: 2, loudnessRiseZ: 1.5, motionZ: 0.5}}],
    audio: {halfSecond: Array.from({length: n * 2}, (_, i) => ({t: i / 2, rmsDb: Math.abs(i / 2 - peak) < 2 ? -10 : -25})), meanRmsDb: -20},
  };
}

export function candidate(over: Partial<Candidate> & {title: string}): Candidate {
  const c = newCandidate({platform: over.platform ?? 'youtube', platformId: over.platformId ?? Math.random().toString(36).slice(2, 12), url: over.url ?? `https://www.youtube.com/watch?v=${Math.random().toString(36).slice(2, 13)}`, title: over.title});
  return Object.assign(c, over);
}
