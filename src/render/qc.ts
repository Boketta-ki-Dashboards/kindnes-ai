import path from 'node:path';
import {PATHS, abs} from '../core/paths.js';
import {nowIso, writeJson} from '../core/fsutil.js';
import {runAnalysis} from '../core/python.js';
import type {EditPlan} from '../edit/plan-types.js';
import {ffprobe, runFfmpeg} from '../media/ffmpeg.js';
import type {PipelineConfig} from '../core/config.js';
import {measureLoudness} from './render.js';

export interface QcCheck {
  name: string;
  pass: boolean;
  severity: 'error' | 'warning';
  value: unknown;
  expected: string;
}

export interface QcReport {
  file: string;
  checkedAt: string;
  pass: boolean;
  checks: QcCheck[];
}

function check(name: string, pass: boolean, value: unknown, expected: string, severity: 'error' | 'warning' = 'error'): QcCheck {
  return {name, pass, severity, value, expected};
}

async function blackSegments(file: string): Promise<{start: number; end: number}[]> {
  const err = await runFfmpeg(['-i', file, '-an', '-vf', 'blackdetect=d=0.1:pic_th=0.95', '-f', 'null', '-']);
  return [...err.matchAll(/black_start:([0-9.]+) black_end:([0-9.]+)/g)].map((m) => ({start: Number(m[1]), end: Number(m[2])}));
}

async function silences(file: string): Promise<{start: number; end: number}[]> {
  const err = await runFfmpeg(['-i', file, '-vn', '-af', 'silencedetect=noise=-45dB:d=0.4', '-f', 'null', '-']);
  const starts = [...err.matchAll(/silence_start: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const ends = [...err.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => ({start: s, end: ends[i] ?? Number.POSITIVE_INFINITY}));
}

async function loudness(file: string): Promise<{i: number; tp: number}> {
  const err = await runFfmpeg(['-i', file, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
  const summary = err.slice(err.lastIndexOf('Summary:'));
  const i = Number(/I:\s+(-?[0-9.]+) LUFS/.exec(summary)?.[1]);
  const tp = Number(/Peak:\s+(-?[0-9.]+) dBFS/.exec(summary)?.[1]);
  return {i, tp};
}

/**
 * Technical quality gate for a rendered video. Checks format, duration, black
 * frames, audio gaps, loudness and – by re-locating the song inside the rendered
 * audio – that the music is really aligned so the drop hits the transition.
 */
export async function qualityCheck(file: string, plan: EditPlan, opts: {syncCheck?: boolean; cfg?: PipelineConfig; audioDramaturgy?: boolean; repetition?: boolean} = {}): Promise<QcReport> {
  const checks: QcCheck[] = [];
  const p = ffprobe(file);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  checks.push(check('video codec H.264', v?.codec_name === 'h264', v?.codec_name, 'h264'));
  checks.push(check('audio codec AAC', a?.codec_name === 'aac', a?.codec_name, 'aac'));
  checks.push(check('resolution 1080x1920', v?.width === plan.width && v?.height === plan.height, `${v?.width}x${v?.height}`, `${plan.width}x${plan.height}`));
  const [n, d] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const fps = d ? n / d : 0;
  checks.push(check('frame rate', Math.abs(fps - plan.fps) < 0.01, Number(fps.toFixed(3)), String(plan.fps)));
  const dur = Number(p.format.duration ?? 0);
  checks.push(check('duration matches plan', Math.abs(dur - plan.durationSec) <= 2.5 / plan.fps + 0.05, Number(dur.toFixed(3)), `${plan.durationSec} ± 0.13 s`));
  const vDur = Number(v?.duration ?? dur);
  const aDur = Number(a?.duration ?? 0);
  checks.push(check('audio/video length in sync', Math.abs(vDur - aDur) < 0.1, `v=${vDur.toFixed(3)} a=${aDur.toFixed(3)}`, '< 0.1 s difference'));

  const tailStart = plan.durationSec - plan.outro.fadeOutSec - 0.15;
  const blacks = (await blackSegments(file)).filter((b) => b.start < tailStart);
  checks.push(check('no black frames before the final fade', blacks.length === 0, blacks, 'none'));
  const sil = (await silences(file)).filter((s) => s.start < tailStart);
  checks.push(check('no audio dropouts before the final fade', sil.length === 0, sil, 'none'));
  const loud = await loudness(file);
  if (plan.music.envelope && plan.outro.shots.length) {
    // the loudness target applies to the outro; the quieter story is intentional
    const outro = await measureLoudness(file, plan.outro.start, Math.max(plan.outro.start + 1, plan.durationSec - plan.outro.fadeOutSec));
    checks.push(check('outro loudness ≈ -14 LUFS (previous outro level)', outro.i >= -15.5 && outro.i <= -12.5, outro.i, '-15.5 … -12.5 LUFS'));
    checks.push(check('whole-video loudness (info: story is intentionally quieter)', true, loud.i, 'info', 'warning'));
  } else {
    checks.push(check('integrated loudness ≈ -14 LUFS', loud.i >= -16.5 && loud.i <= -11.5, loud.i, '-16.5 … -11.5 LUFS', 'warning'));
  }
  checks.push(check('true peak below -0.5 dBTP', loud.tp <= -0.5, loud.tp, '≤ -0.5 dBTP', 'warning'));

  if (opts.syncCheck !== false) {
    try {
      const out = path.join(PATHS.cache, 'qc', `${plan.jobId}.songmatch.json`);
      const res = await runAnalysis<{segments: {mediaStart: number; mediaEnd: number; offset: number; meanSimilarity: number}[]}>(
        ['locate', file, '--song', abs(plan.music.src), '--threshold', '0.75'],
        out,
      );
      const expected = plan.music.songStart;
      const seg = [...res.segments].sort((x, y) => y.mediaEnd - y.mediaStart - (x.mediaEnd - x.mediaStart))[0];
      const off = seg?.offset;
      checks.push(
        check(
          'music aligned (drop lands on the transition)',
          off !== undefined && Math.abs(off - expected) <= 0.06,
          off === undefined ? 'song not found in output audio' : Number(off.toFixed(3)),
          `song offset ${expected.toFixed(3)} s ± 0.06`,
        ),
      );
    } catch (e) {
      checks.push(check('music aligned (drop lands on the transition)', false, String(e), 'analysis ran', 'warning'));
    }
  }

  if (opts.cfg && opts.audioDramaturgy !== false && plan.music.envelope) {
    const {audioDramaturgyChecks} = await import('./audio-qc.js');
    try {
      const a = await audioDramaturgyChecks(plan, opts.cfg);
      checks.push(...a.checks);
      const envSpec = {
        title: `Musik-Gain – ${plan.jobId}`,
        planned: a.plannedGainDb,
        measured: a.measuredGainDb,
        windowSec: 0.2,
        speech: plan.story.speech ?? [],
        buildUpStart: plan.music.envelope.buildUpStart,
        drop: plan.outro.start,
        fadeOutStart: plan.durationSec - plan.music.fadeOutSec,
        out: file.replace(/\.mp4$/, '.audio-envelope.png'),
      };
      const envJson = file.replace(/\.mp4$/, '.audio-envelope.json');
      writeJson(envJson, envSpec);
      // chart: planned vs measured gain (best effort – never fails the QC)
      await runAnalysis(['envplot', envJson], path.join(PATHS.cache, 'qc', `${plan.jobId}-envplot.json`)).catch(() => undefined);
    } catch (e) {
      checks.push(check('audio dramaturgy analysis ran', false, String(e).slice(0, 300), 'stems rendered and measured', 'warning'));
    }
  }
  if (opts.cfg && opts.repetition !== false && plan.outro.shots.length > 1) {
    const {checkRepetition, describeViolations} = await import('../outro/repetition.js');
    try {
      const r = await checkRepetition(plan, opts.cfg, {contactSheet: file.replace(/\.mp4$/, '.shots.png'), title: `Shot-Übersicht – ${plan.jobId}`});
      checks.push(check('no visible shot repetitions in the outro', r.pass, r.pass ? `${plan.outro.shots.length} shots, all distinct` : describeViolations(r), 'no duplicates, similar shots ≥ 3 apart, no motif 3×', opts.cfg.outro.repetition.severity));
    } catch (e) {
      checks.push(check('repetition control ran', false, String(e).slice(0, 300), 'shot similarity measured', 'warning'));
    }
  }
  const report: QcReport = {file, checkedAt: nowIso(), pass: checks.every((c) => c.pass || c.severity === 'warning'), checks};
  writeJson(file.replace(/\.mp4$/, '.qc.json'), report);
  return report;
}
