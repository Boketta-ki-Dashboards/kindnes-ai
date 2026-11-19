/**
 * Visual repetition control for an outro (see python/kindness_analysis/shotsim.py).
 * Used by `outro:check`, by the V4 render and as a QC step of every production.
 */
import fs from 'node:fs';
import path from 'node:path';
import {PATHS, abs} from '../core/paths.js';
import {ensureDir, readJson, writeJson} from '../core/fsutil.js';
import {runAnalysis} from '../core/python.js';
import type {PipelineConfig} from '../core/config.js';
import type {EditPlan} from '../edit/plan-types.js';
import {analysisPathForAsset, type VideoAnalysis} from './outro.js';

export interface RepetitionPair {
  a: number;
  b: number;
  level: 'duplicate' | 'similar';
  reasons: string[];
  ssim: number;
  phashDistance: number;
  layout: number;
  faceDistance: number | null;
  sameTake: boolean;
  shotGap: number;
  secondsApart: number;
}

export interface RepetitionReport {
  shots: number;
  framesPerShot: number;
  thresholds: Record<string, number>;
  pairs: RepetitionPair[];
  clusters: number[][];
  violations: {rule: string; shots: number[]; detail: string[]}[];
  pass: boolean;
  contactSheet?: string;
}

export async function checkRepetition(plan: EditPlan, cfg: PipelineConfig, opts: {contactSheet?: string; title?: string; name?: string} = {}): Promise<RepetitionReport> {
  const rc = cfg.outro.repetition;
  const cutsCache = new Map<string, number[]>();
  const cutsFor = (src: string) => {
    if (!cutsCache.has(src)) {
      const f = analysisPathForAsset(abs(src));
      cutsCache.set(src, fs.existsSync(f) ? readJson<VideoAnalysis>(f).cuts.map((c) => c.time) : []);
    }
    return cutsCache.get(src)!;
  };
  const spec = {
    title: opts.title ?? `Shot overview – ${plan.outro.variantId}`,
    framesPerShot: rc.framesPerShot,
    thresholds: rc.thresholds,
    contactSheet: opts.contactSheet,
    shots: plan.outro.shots.map((s) => ({
      path: abs(s.src.replace(/#fitblur$/, '')),
      sourceId: s.sourceId,
      srcIn: s.srcIn,
      srcOut: s.srcOut,
      start: s.start,
      duration: s.duration,
      focusX: s.focusX,
      focusY: s.focusY ?? null,
      baseZoom: s.baseZoom ?? 1,
      tag: s.tag ?? '',
      motif: s.motif ?? '',
      act: s.act ?? '',
      cuts: cutsFor(s.src.replace(/#fitblur$/, '')),
    })),
  };
  const dir = path.join(PATHS.cache, 'repetition');
  ensureDir(dir);
  const name = opts.name ?? plan.jobId;
  const specFile = path.join(dir, `${name}.spec.json`);
  writeJson(specFile, spec);
  return runAnalysis<RepetitionReport>(['shotsim', specFile], path.join(dir, `${name}.report.json`), 10 * 60_000);
}

export function describeViolations(r: RepetitionReport): string[] {
  return r.violations.map((v) => `${v.rule}: shots ${v.shots.map((i) => `#${i + 1}`).join(', ')} (${v.detail.join('; ')})`);
}
