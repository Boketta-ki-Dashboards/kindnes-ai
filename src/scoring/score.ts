import fs from 'node:fs';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {nowIso, readJson} from '../core/fsutil.js';
import type {AnalysisLevel, Candidate, CriterionScore, ScoreBreakdown} from '../core/types.js';
import type {VideoAnalysis} from '../outro/outro.js';
import {jaccard} from '../core/store.js';
import {CRITERIA, DEFAULT_THRESHOLD, LEX, RUBRIC, categoriesOf, clamp, countMatches, type CriterionKey} from './rubric.js';

function crit(key: CriterionKey, points: number, reasons: string[]): CriterionScore {
  return {points: Math.round(clamp(points, 0, RUBRIC[key].max) * 10) / 10, max: RUBRIC[key].max, reasons};
}

export interface ScoreContext {
  /** Other candidates (for originality / near-duplicate checks). */
  others: Candidate[];
  /** Categories of videos already produced (for variety). */
  producedCategories: string[];
  threshold?: number;
}

const text = (c: Candidate) => `${c.title} ${c.description ?? ''}`.toLowerCase();

export function isCompilation(c: Pick<Candidate, 'title' | 'description' | 'durationSec'>): boolean {
  const t = `${c.title} ${c.description ?? ''}`.toLowerCase();
  return countMatches(t, LEX.compilation) > 0 || (c.durationSec ?? 0) > 300;
}

/** Provisional score from title, description, duration and public statistics only. */
export function scoreFromMetadata(c: Candidate, ctx: ScoreContext): ScoreBreakdown {
  const t = text(c);
  const title = c.title.toLowerCase();
  const emo = countMatches(t, LEX.emotional);
  const kind = countMatches(t, LEX.kindness);
  const climax = countMatches(t, LEX.climax);
  const comp = isCompilation(c);
  const off = countMatches(title, LEX.offTopic);
  const cats = categoriesOf(t);
  const dur = c.durationSec;

  // A – emotional peak (35)
  const aR: string[] = [];
  let a = 8;
  if (emo) (a += Math.min(15, emo * 5), aR.push(`${emo} emotion keyword group(s) in title/description`));
  if (kind) (a += Math.min(9, kind * 3), aR.push(`${kind} kindness keyword group(s)`));
  if (c.viewCount !== undefined && c.viewCount > 0) {
    const pts = clamp((Math.log10(c.viewCount) - 2) * 1.5, 0, 6);
    a += pts;
    aR.push(`${c.viewCount.toLocaleString('en')} views → +${pts.toFixed(1)} (audience response)`);
  } else {
    a += 2;
    aR.push('no view count – neutral');
  }
  if (off) (a -= 8, aR.push('looks off-topic (music/trailer/prank/staged …)'));
  aR.push('metadata only – emotional impact NOT verified on the video');

  // B – clarity (25)
  const bR: string[] = [];
  let b = 4;
  if (dur === undefined) (b += 6, bR.push('duration unknown'));
  else if (dur >= 10 && dur <= 90) (b += 12, bR.push(`${Math.round(dur)} s – ideal single-story length`));
  else if (dur > 90 && dur <= 180) (b += 9, bR.push(`${Math.round(dur)} s – needs trimming`));
  else if (dur > 180 && dur <= 600) (b += 4, bR.push(`${Math.round(dur)} s – long, story must be extracted`));
  else if (dur < 10) (b += 3, bR.push(`${Math.round(dur)} s – very short`));
  else bR.push(`${Math.round(dur)} s – too long for one story`);
  if (kind && cats.length) (b += 5, bR.push(`clear subject (${cats.join(', ')}) + action`));
  if (c.title.replace(/#\S+/g, '').trim().split(/\s+/).length >= 4) (b += 3, bR.push('descriptive title'));
  if ((c.description ?? '').length > 40) (b += 2, bR.push('has description'));
  if (comp) (b -= 10, bR.push('compilation – several stories in one video'));
  if (off) b -= 6;

  // C – music drop potential (20)
  const cR: string[] = [];
  let cc = 4;
  if (climax) (cc += Math.min(8, climax * 4), cR.push(`${climax} climax/reaction keyword group(s)`));
  if (emo) (cc += 4, cR.push('emotional peak likely'));
  if (dur !== undefined && dur >= 12 && dur <= 75) (cc += 4, cR.push('length fits a story before the 48 s drop'));
  if (cats.some((x) => ['sports', 'military', 'animals'].includes(x))) (cc += 2, cR.push('category with clear climax moments'));
  if (comp) (cc -= 6, cR.push('compilation – no single climax'));

  // D – visual quality (10)
  const dR: string[] = [];
  let d: number;
  if (c.width && c.height) {
    const short = Math.min(c.width, c.height);
    d = short >= 1080 ? 6 : short >= 720 ? 4.5 : short >= 480 ? 3 : 1;
    dR.push(`${c.width}x${c.height} (reported)`);
    if (c.height / c.width > 1.2) (d += 3, dR.push('vertical – fits 9:16'));
    else (d += 1.5, dR.push('landscape – needs fit/crop'));
  } else {
    d = 4;
    dR.push('resolution unknown – neutral');
  }

  // E – originality (10)
  const eR: string[] = [];
  let e = 6;
  const maxSim = Math.max(0, ...ctx.others.filter((o) => o.id !== c.id).map((o) => jaccard(o.titleFingerprint, c.titleFingerprint)));
  if (maxSim > 0.6) (e -= 3, eR.push(`similar to another candidate (title overlap ${(maxSim * 100).toFixed(0)} %)`));
  if (c.viewCount && c.viewCount > 20_000_000) (e -= 2, eR.push('extremely viral – likely already seen'));
  if (c.viewCount !== undefined && c.viewCount < 5_000) (e += 1, eR.push('rarely seen'));
  const fresh = cats.filter((x) => !ctx.producedCategories.includes(x));
  if (fresh.length) (e += 2, eR.push(`category not produced yet: ${fresh.join(', ')}`));
  if (/\b(prank|staged|scripted|skit)\b/.test(t)) (e -= 3, eR.push('possibly staged'));

  return finalize(c, {emotional: crit('emotional', a, aR), clarity: crit('clarity', b, bR), dropPotential: crit('dropPotential', cc, cR), visualQuality: crit('visualQuality', d, dR), originality: crit('originality', e, eR)}, 'METADATA_ONLY', 'metadata-heuristic-v1', ctx);
}

/**
 * Score using measured signals from the actual media (python video analysis).
 * Visual quality is fully measured; clarity/drop potential mix measurements with
 * metadata; the emotional criterion still relies on proxies (audio reaction peak).
 */
export function scoreFromContent(c: Candidate, an: VideoAnalysis, ctx: ScoreContext): ScoreBreakdown {
  const meta = scoreFromMetadata(c, ctx);
  const D = an.info.durationSec;
  const hl = an.highlights?.[0];
  const cutsPerMin = (an.cuts.length / Math.max(1, D)) * 60;

  // D – measured visual quality
  const dR: string[] = [];
  const short = Math.min(an.info.width, an.info.height);
  let d = short >= 1080 ? 5 : short >= 720 ? 4 : short >= 480 ? 2.5 : 1;
  dR.push(`measured ${an.info.width}x${an.info.height} @ ${an.info.fps} fps`);
  const sharp = an.perSecond.sharpness.reduce((x, y) => x + y, 0) / Math.max(1, an.perSecond.sharpness.length);
  const sharpPts = clamp(sharp / 0.06, 0, 1) * 2;
  d += sharpPts;
  dR.push(`detail/sharpness ${sharp.toFixed(3)} → +${sharpPts.toFixed(1)}`);
  const m = an.perSecond.motion;
  const jitter = m.length > 2 ? m.slice(1).reduce((s, x, i) => s + Math.abs(x - m[i]), 0) / (m.length - 1) : 0;
  const stable = jitter < 0.02 ? 1.5 : jitter < 0.04 ? 0.8 : 0;
  d += stable;
  dR.push(`stability (motion jitter ${jitter.toFixed(3)}) → +${stable}`);
  const aspect = an.info.height / an.info.width;
  d += aspect > 1.2 ? 1.5 : 0.5;
  dR.push(aspect > 1.2 ? 'vertical source' : 'landscape source (fit with blurred background)');

  // B – clarity: measured length and cut structure
  const bR = [...meta.clarity.reasons.filter((r) => !/duration unknown|s – /.test(r))];
  let b = meta.clarity.points;
  if (cutsPerMin > 25) (b -= 4, bR.push(`${cutsPerMin.toFixed(0)} cuts/min – fragmented`));
  else if (cutsPerMin < 8) (b += 2, bR.push(`${cutsPerMin.toFixed(0)} cuts/min – calm, easy to follow`));
  if (an.blackSegments.length > 2) (b -= 3, bR.push(`${an.blackSegments.length} black segments – possibly several clips`));

  // C – drop potential: is there a clear measurable peak in the 2nd half?
  const cR = [...meta.dropPotential.reasons];
  let cc = meta.dropPotential.points * 0.6;
  if (hl) {
    const pos = hl.time / Math.max(1, D);
    const strength = clamp((hl.features.loudnessRiseZ ?? 0) * 2 + (hl.features.loudnessZ ?? 0) * 1.5 + (hl.features.motionZ ?? 0), 0, 6);
    cc += strength;
    cR.push(`measured peak at ${hl.time.toFixed(1)} s (${(pos * 100).toFixed(0)} %), strength +${strength.toFixed(1)}`);
    if (pos > 0.35 && pos < 0.95) (cc += 2, cR.push('peak in the second half – good build-up'));
  } else cR.push('no measurable peak');

  // A – emotional: metadata + audio reaction proxy
  const aR = [...meta.emotional.reasons.filter((r) => !r.startsWith('metadata only'))];
  let a = meta.emotional.points;
  if (hl && (hl.features.loudnessRiseZ ?? 0) > 1) (a += 3, aR.push('audible reaction at the peak (loudness rise)'));
  aR.push('content signals only – emotional meaning not judged by a reviewer yet');

  return finalize(
    c,
    {emotional: crit('emotional', a, aR), clarity: crit('clarity', b, bR), dropPotential: crit('dropPotential', cc, cR), visualQuality: crit('visualQuality', d, dR), originality: meta.originality},
    'CONTENT_SIGNALS',
    'content-signals-v1',
    ctx,
  );
}

export interface ReviewFile {
  candidateId: string;
  reviewer: string; // e.g. "human", "claude-code-session", "claude-api"
  reviewedAt: string;
  /** What was looked at, e.g. "30-frame contact sheet + audio" – required. */
  basis: string;
  scores: Record<CriterionKey, {points: number; reasons: string[]}>;
}

export function reviewPath(id: string): string {
  return path.join(PATHS.data, 'reviews', `${id}.json`);
}

/** A content review (human or vision model) on real frames: the only fully content-based score. */
export function scoreFromReview(c: Candidate, ctx: ScoreContext, file = reviewPath(c.id)): ScoreBreakdown | null {
  if (!fs.existsSync(file)) return null;
  const r = readJson<ReviewFile>(file);
  const parts = Object.fromEntries(CRITERIA.map((k) => [k, crit(k, r.scores[k].points, [...r.scores[k].reasons, `reviewed by ${r.reviewer} (${r.basis})`])])) as Record<CriterionKey, CriterionScore>;
  return finalize(c, parts, 'CONTENT_REVIEWED', `review:${r.reviewer}`, ctx);
}

function finalize(c: Candidate, p: Record<CriterionKey, CriterionScore>, level: AnalysisLevel, scorer: string, ctx: ScoreContext): ScoreBreakdown {
  const total = Math.round(CRITERIA.reduce((s, k) => s + p[k].points, 0) * 10) / 10;
  const threshold = ctx.threshold ?? DEFAULT_THRESHOLD;
  return {
    total,
    ...p,
    analysisLevel: level,
    provisional: level === 'METADATA_ONLY',
    scoredAt: nowIso(),
    scorer,
    qualifies: total >= threshold,
  } as ScoreBreakdown;
}

/** Best available score: review > content signals > metadata. */
export function bestScore(c: Candidate, ctx: ScoreContext, analysis?: VideoAnalysis | null): ScoreBreakdown {
  return scoreFromReview(c, ctx) ?? (analysis ? scoreFromContent(c, analysis, ctx) : scoreFromMetadata(c, ctx));
}
