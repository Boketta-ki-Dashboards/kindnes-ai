/**
 * Music gain envelope over the whole video (one continuous song, never restarted).
 *
 *   Phase A  story start   startDb (≈ -20 dB), short fade-in, then a gentle rise
 *   Phase B  story body    bodyDb (≈ -18 dB), ducked by depthDb while people speak
 *                          (look-ahead attack, hold, release – no level jumps)
 *   Phase C  build-up      the last `buildUpBeats` beats before the drop: smooth
 *                          S-curve from the current level to the outro level,
 *                          starting exactly on a beat
 *   Phase D  drop / outro  outro level (musicGainDb ≈ -7 dB); the existing final
 *                          fade-out is applied on top in the renderer
 *
 * The envelope is stored per frame in the edit plan, so every render (and every QC
 * check) uses exactly the same, reproducible curve.
 */
import type {PipelineConfig} from '../core/config.js';
import type {BeatMap} from './beatmap.js';
import {nearestBeatIndex} from './beatmap.js';

/** The beat `n` beats before `t` (extrapolated with the beat period near the song start). */
export function beatBefore(map: BeatMap, t: number, n: number): number {
  const i = nearestBeatIndex(map.beats, t) - n;
  return i >= 0 ? map.beats[i] : map.beats[0] + i * map.beatPeriodSec;
}

export interface MusicEnvelope {
  fps: number;
  /** Music gain in dB for every output frame. */
  db: number[];
  /** Timeline seconds where the build-up starts (a beat) and where the drop is. */
  buildUpStart: number;
  drop: number;
  /** Speech segments on the output timeline that caused ducking. */
  ducked: [number, number][];
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return 0.5 - 0.5 * Math.cos(Math.PI * t); // ease-in-out (sine)
};

export function buildMusicEnvelope(opts: {
  fps: number;
  totalSec: number;
  /** Story length = timeline second of the drop. */
  storySec: number;
  songStart: number;
  drop: number;
  beatmap: BeatMap;
  cfg: PipelineConfig;
  /** Speech on the output timeline (already mapped from source time). */
  speech: [number, number][];
  /** False when the story's own audio is muted – then nothing needs ducking. */
  storyAudible: boolean;
}): MusicEnvelope {
  const {fps, totalSec, storySec, cfg} = opts;
  const sm = cfg.audio.storyMusic;
  const dk = cfg.audio.ducking;
  const outroDb = cfg.audio.musicGainDb;
  const frames = Math.max(1, Math.round(totalSec * fps));

  // build-up start: N beats before the drop, on the beat grid (song time -> timeline)
  const buildSong = beatBefore(opts.beatmap, opts.drop, sm.buildUpBeats);
  const buildUpStart = Math.max(0, buildSong - opts.songStart);

  // story curve WITHOUT the fade-in (the fade-in is applied on top, so a build-up that
  // starts very early never starts from silence)
  const rise = Math.max(0.01, Math.min(sm.riseSec, storySec * 0.5));
  const baseStory = (t: number) => (t < rise ? sm.startDb + (sm.bodyDb - sm.startDb) * (t / rise) : sm.bodyDb);
  const fadeInDb = (t: number) => (sm.fadeInSec > 0 && t < sm.fadeInSec ? 20 * Math.log10(Math.max(t / sm.fadeInSec, 1e-3)) : 0);

  // ducking amount 0..1 per frame: look-ahead attack, hold, linear release
  const duck = new Float32Array(frames);
  const ducked: [number, number][] = [];
  if (dk.enabled && opts.storyAudible && opts.speech.length) {
    const target = new Uint8Array(frames);
    for (const [a, b] of opts.speech) {
      if (a >= storySec) continue;
      const s = Math.max(0, Math.floor((a - dk.attackSec) * fps));
      const e = Math.min(frames - 1, Math.ceil((Math.min(b, storySec) + dk.holdSec) * fps));
      for (let f = s; f <= e; f++) target[f] = 1;
      ducked.push([Number(a.toFixed(2)), Number(Math.min(b, storySec).toFixed(2))]);
    }
    const up = 1 / Math.max(1, dk.attackSec * fps);
    const down = 1 / Math.max(1, dk.releaseSec * fps);
    let cur = 0;
    for (let f = 0; f < frames; f++) {
      cur = target[f] ? Math.min(1, cur + up) : Math.max(0, cur - down);
      duck[f] = cur;
    }
  }

  const db: number[] = new Array(frames);
  // level of the undisturbed story curve at the build-up start (ducking is applied on top)
  const startLevel = baseStory(buildUpStart);
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    let v: number;
    if (t >= storySec) v = outroDb;
    else if (t >= buildUpStart && storySec > buildUpStart) {
      const x = (t - buildUpStart) / (storySec - buildUpStart);
      // rise from the level at the build-up start to the outro level; speech stays ducked
      // relative to the rising curve so the story remains understandable
      v = startLevel + (outroDb - startLevel) * smoothstep(x) - dk.depthDb * duck[f] * (1 - smoothstep(x));
    } else v = baseStory(t) - dk.depthDb * duck[f];
    db[f] = Math.round(Math.max(-90, v + fadeInDb(t)) * 10) / 10;
  }
  return {fps, db, buildUpStart: Number(buildUpStart.toFixed(3)), drop: Number(storySec.toFixed(3)), ducked};
}

/** Map speech segments from source time to the output timeline through the story segments. */
export function speechOnTimeline(speech: [number, number][], segments: {srcIn: number; srcOut: number; start: number}[]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of speech) {
    for (const s of segments) {
      const lo = Math.max(a, s.srcIn);
      const hi = Math.min(b, s.srcOut);
      if (hi > lo) out.push([s.start + (lo - s.srcIn), s.start + (hi - s.srcIn)]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}
