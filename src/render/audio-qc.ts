/**
 * Audio dramaturgy QC. Renders the music and story stems of a plan separately and
 * measures:
 *  - the gain actually applied to the song over time (music stem ÷ original song at the
 *    same song position) and compares it with the planned envelope,
 *  - that the song plays continuously from the first to the last second (no gap, no
 *    restart, no second track),
 *  - the quiet story start, the smooth build-up and the seamless drop,
 *  - speech-to-music ratio while people speak (intelligibility),
 *  - that a clip already containing the song is muted (no double music).
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {PATHS, abs} from '../core/paths.js';
import {runAnalysis} from '../core/python.js';
import type {PipelineConfig} from '../core/config.js';
import type {EditPlan} from '../edit/plan-types.js';
import type {QcCheck} from './qc.js';
import {renderAudioStem} from './render.js';

const SR = 16000;
const WIN = 0.2; // seconds per analysis window

function decode(file: string, from?: number, dur?: number): Float32Array {
  const args = ['-nostdin', '-v', 'error'];
  if (from !== undefined) args.push('-ss', from.toFixed(3));
  args.push('-i', file);
  if (dur !== undefined) args.push('-t', dur.toFixed(3));
  args.push('-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-');
  const r = spawnSync('ffmpeg', args, {maxBuffer: 512 * 1024 * 1024});
  const b = r.stdout as Buffer;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

/** RMS level (dBFS) per WIN seconds. */
function levels(x: Float32Array): number[] {
  const n = Math.round(WIN * SR);
  const out: number[] = [];
  for (let i = 0; i + n <= x.length; i += n) {
    let s = 0;
    for (let j = i; j < i + n; j++) s += x[j] * x[j];
    out.push(10 * Math.log10(s / n + 1e-12));
  }
  return out;
}

/** Lag (samples, ±0.12 s) that best aligns the 10 ms energy envelopes of a and b. */
function bestLag(a: Float32Array, b: Float32Array, from: number, to: number): number {
  const hop = SR / 100;
  const env = (x: Float32Array, off: number) => {
    const e: number[] = [];
    for (let i = from + off; i + hop <= to + off && i + hop <= x.length; i += hop) {
      let s = 0;
      for (let j = i; j < i + hop; j++) s += x[j] * x[j];
      e.push(Math.sqrt(s / hop));
    }
    return e;
  };
  const ea = env(a, 0);
  let best = 0;
  let bestScore = -Infinity;
  for (let lagHop = -12; lagHop <= 12; lagHop++) {
    const off = lagHop * hop;
    if (from + off < 0) continue;
    const eb = env(b, off);
    const n = Math.min(ea.length, eb.length);
    let sc = 0;
    for (let i = 0; i < n; i++) sc += ea[i] * eb[i];
    sc /= Math.sqrt(ea.slice(0, n).reduce((x, y) => x + y * y, 0) * eb.slice(0, n).reduce((x, y) => x + y * y, 0)) || 1;
    if (sc > bestScore) {
      bestScore = sc;
      best = off;
    }
  }
  return best;
}

function concatSilence(n: number, x: Float32Array): Float32Array {
  const out = new Float32Array(n + x.length);
  out.set(x, n);
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const chk = (name: string, pass: boolean, value: unknown, expected: string, severity: 'error' | 'warning' = 'error'): QcCheck => ({name, pass, value, expected, severity});

export interface AudioQcResult {
  checks: QcCheck[];
  /** Measured gain curve (dB per 0.2 s) – useful for plots/debugging. */
  measuredGainDb: (number | null)[];
  plannedGainDb: number[];
}

export async function audioDramaturgyChecks(plan: EditPlan, cfg: PipelineConfig): Promise<AudioQcResult> {
  const env = plan.music.envelope;
  const checks: QcCheck[] = [];
  if (!env) return {checks: [chk('music envelope present', false, 'none', 'plan.music.envelope')], measuredGainDb: [], plannedGainDb: []};
  const dir = path.join(PATHS.cache, 'qc', 'stems');
  const musicWav = await renderAudioStem(plan, cfg, 'music', path.join(dir, `${plan.jobId}-music.wav`));
  const storyAudible = plan.story.segments.length > 0 && plan.story.audioGain > 0.01;
  const storyWav = storyAudible ? await renderAudioStem(plan, cfg, 'story', path.join(dir, `${plan.jobId}-story.wav`)) : null;

  const total = plan.durationSec;
  const drop = plan.outro.start;
  const fadeEnd = total - plan.music.fadeOutSec;
  const musicPcm = decode(musicWav);
  let songPcm = decode(abs(plan.music.src), plan.music.songStart, total + 0.2);
  // align the reference song with the stem (renderer/decoder offsets of a few ms would
  // otherwise show up as fake level jumps at drum transients)
  const lag = bestLag(musicPcm, songPcm, Math.round((plan.outro.start + 0.5) * SR), Math.round(Math.min(total - 1, plan.outro.start + 6) * SR));
  if (lag > 0) songPcm = songPcm.subarray(lag);
  const music = levels(musicPcm);
  const song = levels(lag < 0 ? concatSilence(-lag, songPcm) : songPcm);
  const nW = Math.min(music.length, song.length);

  // measured gain = music stem − original song (only where the song is not near-silent)
  const measured: (number | null)[] = [];
  const planned: number[] = [];
  for (let w = 0; w < nW; w++) {
    const tc = (w + 0.5) * WIN;
    planned.push(env.db[Math.min(env.db.length - 1, Math.round(tc * env.fps))]);
    // skip near-silent song passages, the fade-in and the final fade (ratio not meaningful there)
    measured.push(song[w] > -45 && tc < fadeEnd && tc > cfg.audio.storyMusic.fadeInSec + 0.05 ? r1(music[w] - song[w]) : null);
  }
  const at = (t0: number, t1: number) => measured.slice(Math.floor(t0 / WIN), Math.ceil(t1 / WIN)).filter((x): x is number => x !== null);

  // 1. planned vs measured envelope
  const dev = measured.map((m, i) => (m === null ? null : Math.abs(m - planned[i]))).filter((x): x is number => x !== null);
  checks.push(chk('music gain follows the planned envelope', median(dev) <= 1.0 && Math.max(...dev) <= 3, {medianDevDb: r1(median(dev)), maxDevDb: r1(Math.max(...dev))}, 'median ≤ 1 dB, max ≤ 3 dB'));

  // 2. continuous music: no gaps in the music stem between fade-in and final fade
  const fadeIn = cfg.audio.storyMusic.fadeInSec;
  const gaps = music.slice(Math.ceil((fadeIn + 0.1) / WIN), Math.floor(fadeEnd / WIN)).filter((x) => x < -60).length;
  checks.push(chk('music plays without interruption from the start to the end', gaps === 0, `${gaps} silent windows`, '0 windows below -60 dBFS'));

  // 3. one song, never restarted, no second track: locate the song in the music stem
  const loc = await runAnalysis<{segments: {mediaStart: number; mediaEnd: number; offset: number}[]}>(
    ['locate', musicWav, '--song', abs(plan.music.src), '--threshold', '0.75'],
    path.join(dir, `${plan.jobId}-music.songmatch.json`),
  );
  const offsets = loc.segments.map((s) => s.offset);
  const wrong = loc.segments.filter((s) => Math.abs(s.offset - plan.music.songStart) > 0.08);
  const covered = loc.segments.filter((s) => Math.abs(s.offset - plan.music.songStart) <= 0.08).reduce((x, s) => x + (s.mediaEnd - s.mediaStart), 0);
  checks.push(
    chk(
      'single continuous song (no restart at the drop, no second track)',
      wrong.length === 0 && covered >= 0.85 * (total - 1),
      {offsets: offsets.map(r1), coveredSec: r1(covered)},
      `every match at song offset ${plan.music.songStart.toFixed(2)} s, ≥ 85 % covered`,
    ),
  );

  if (plan.story.duration > 0) {
    // 4. quiet story start vs. outro
    const startLvl = mean(at(fadeIn, Math.min(fadeIn + 2.5, env.buildUpStart)));
    const outroLvl = mean(at(drop + 0.3, Math.min(drop + 3, fadeEnd)));
    if (env.buildUpStart > fadeIn + 0.5) {
      checks.push(chk('story starts with quiet music (≥ 10 dB below the outro)', outroLvl - startLvl >= 10, {storyStartDb: r1(startLvl), outroDb: r1(outroLvl)}, '≥ 10 dB difference'));
    }
    // 5. build-up: rising, smooth, reaches the outro level at the drop
    const bu = measured.slice(Math.floor(env.buildUpStart / WIN), Math.floor(drop / WIN)).filter((x): x is number => x !== null);
    const steps = bu.slice(1).map((x, i) => x - bu[i]);
    const rise = bu.length ? mean(bu.slice(-3)) - mean(bu.slice(0, 3)) : 0;
    checks.push(
      chk(
        'smooth build-up before the drop (rising, no jumps)',
        rise >= 6 && Math.max(...steps) <= 3 && Math.min(...steps) >= -1.5,
        {buildUpSec: r1(drop - env.buildUpStart), riseDb: r1(rise), maxStepDb: r1(Math.max(...steps)), minStepDb: r1(Math.min(...steps))},
        'rise ≥ 6 dB, steps between −1.5 and +3 dB per 0.2 s',
      ),
    );
    // 6. seamless drop: gain just before vs. just after the drop
    const pre = mean(at(drop - 0.3, drop));
    const post = mean(at(drop, drop + 0.3));
    checks.push(chk('no audio jump at the drop (music already at outro level)', Math.abs(post - pre) <= 2, {beforeDb: r1(pre), afterDb: r1(post)}, '|after − before| ≤ 2 dB'));
  }

  // 7. speech intelligibility while people speak
  const speech = plan.story.speech ?? [];
  if (storyWav && speech.length) {
    const st = levels(decode(storyWav));
    const smr: number[] = [];
    for (const [a, b] of speech) {
      for (let w = Math.floor(a / WIN); w < Math.min(Math.ceil(b / WIN), st.length, music.length); w++) {
        if ((w + 0.5) * WIN < drop - 0.5 && st[w] > -50) smr.push(st[w] - music[w]);
      }
    }
    checks.push(chk('speech clearly above the music (speech-to-music ratio)', median(smr) >= 8, {medianSmrDb: r1(median(smr)), windows: smr.length}, 'median ≥ 8 dB'));
  } else if (plan.story.segments.length) {
    checks.push(chk('speech intelligibility', true, plan.story.songInClip ? 'clip audio muted (contains the song)' : 'no speech detected in the story', 'n/a', 'warning'));
  }

  // 8. no double music
  if (plan.story.songInClip !== undefined && plan.story.segments.length) {
    checks.push(chk('no double music (clip containing the song is muted)', !plan.story.songInClip || plan.story.audioGain === 0, {songInClip: plan.story.songInClip, storyAudioGain: plan.story.audioGain}, 'gain 0 when the song is in the clip'));
  }
  return {checks, measuredGainDb: measured, plannedGainDb: planned};
}
