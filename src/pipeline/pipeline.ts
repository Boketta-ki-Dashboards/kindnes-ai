import fs from 'node:fs';
import path from 'node:path';
import {PATHS, abs, rel} from '../core/paths.js';
import {ensureDir, nowIso, readJson, writeJson} from '../core/fsutil.js';
import {logger} from '../core/logger.js';
import {loadAssetsConfig, loadMusicConfig, loadPipelineConfig, type PipelineConfig} from '../core/config.js';
import {CandidateStore, newCandidate} from '../core/store.js';
import {isAtLeast, retryTarget} from '../core/state.js';
import type {Candidate, CandidateState} from '../core/types.js';
import {runAnalysis} from '../core/python.js';
import {nextQueries} from '../discovery/queries.js';
import type {SearchAdapter, SearchHit} from '../discovery/adapters/types.js';
import {AdapterBlockedError} from '../discovery/adapters/types.js';
import {youtubeAdapter} from '../discovery/adapters/youtube.js';
import {archiveOrgAdapter, dailymotionAdapter, oembedLookup, redditAdapter, wikimediaAdapter} from '../discovery/adapters/others.js';
import {bestScore, isCompilation, type ScoreContext} from '../scoring/score.js';
import {categoriesOf} from '../scoring/rubric.js';
import {acquireMedia, describeMedia} from '../acquisition/acquire.js';
import {loadBeatMap} from '../music/beatmap.js';
import {buildEditPlan, type PlanOverrides} from '../edit/planner.js';
import type {EditPlan} from '../edit/plan-types.js';
import type {VideoAnalysis} from '../outro/outro.js';
import {renderPlan} from '../render/render.js';
import {qualityCheck, type QcReport} from '../render/qc.js';
import {dHashDistance} from '../media/ffmpeg.js';

const log = logger('pipeline');

export function adaptersFor(cfg: PipelineConfig, only?: string[]): SearchAdapter[] {
  const all: SearchAdapter[] = [youtubeAdapter(), youtubeAdapter({creativeCommonsOnly: true}), dailymotionAdapter(), archiveOrgAdapter(), wikimediaAdapter(), redditAdapter()];
  return all.filter((a) => {
    const key = a.name === 'youtube-cc' ? 'youtube' : a.name;
    if (only?.length) return only.includes(a.name);
    return cfg.discovery.adapters[key]?.enabled !== false;
  });
}

export interface DiscoverReport {
  queries: string[];
  perAdapter: Record<string, {hits: number; added: number; duplicates: number; filtered: number; error?: string; blocked?: boolean}>;
  added: string[];
}

function applyHit(store: CandidateStore, hit: SearchHit, query: string): {added: boolean; candidate: Candidate} {
  const c = newCandidate({...hit, query});
  c.mediaUrl = hit.directMediaUrl;
  c.media = {status: hit.mediaStatus, reason: hit.mediaNote};
  const res = store.add(c);
  if (res.added) {
    const t = `${c.title} ${c.description ?? ''}`.toLowerCase();
    c.categories = categoriesOf(t);
    c.isCompilation = isCompilation(c);
    store.setState(c, 'METADATA_ANALYZED', `metadata from ${hit.platform}`);
  }
  return res;
}

/** Step 1+2: search all enabled platforms with the next batch of rotating queries. */
export async function discover(store: CandidateStore, cfg: PipelineConfig, opts: {queries?: string[]; adapters?: string[]; limit?: number; adapterList?: SearchAdapter[]} = {}): Promise<DiscoverReport> {
  const queries = opts.queries ?? nextQueries(cfg.discovery.queriesPerRun);
  const limit = opts.limit ?? cfg.discovery.maxResultsPerQuery;
  const report: DiscoverReport = {queries, perAdapter: {}, added: []};
  for (const adapter of opts.adapterList ?? adaptersFor(cfg, opts.adapters)) {
    const r = (report.perAdapter[adapter.name] = {hits: 0, added: 0, duplicates: 0, filtered: 0} as DiscoverReport['perAdapter'][string]);
    for (const q of queries) {
      try {
        const hits = await adapter.search(q, limit);
        r.hits += hits.length;
        for (const h of hits) {
          if (h.durationSec !== undefined && (h.durationSec < cfg.discovery.minDurationSec || h.durationSec > cfg.discovery.maxDurationSec)) {
            r.filtered++;
            continue;
          }
          const res = applyHit(store, h, q);
          if (res.added) {
            r.added++;
            report.added.push(res.candidate.id);
          } else r.duplicates++;
        }
      } catch (e) {
        r.error = (e as Error).message.slice(0, 300);
        if (e instanceof AdapterBlockedError) {
          r.blocked = true;
          log.warn(`${adapter.name} blocked: ${r.error}`);
          break; // don't hammer a platform that refuses us
        }
        log.warn(`${adapter.name} query "${q}" failed: ${r.error}`);
      }
    }
    log.info(`${adapter.name}: ${r.hits} hits, ${r.added} new, ${r.duplicates} duplicates, ${r.filtered} filtered${r.blocked ? ' (BLOCKED)' : ''}`);
  }
  store.save();
  return report;
}

export function scoreContext(store: CandidateStore, cfg: PipelineConfig): ScoreContext {
  const produced = new Set(store.productions().map((p) => p.candidateId));
  return {
    others: store.all(),
    producedCategories: store.all().filter((c) => produced.has(c.id)).flatMap((c) => c.categories),
    threshold: cfg.scoring.threshold,
  };
}

function loadAnalysis(c: Candidate): VideoAnalysis | null {
  return c.contentAnalysisPath && fs.existsSync(abs(c.contentAnalysisPath)) ? readJson<VideoAnalysis>(abs(c.contentAnalysisPath)) : null;
}

/** Step 3: score and sort into shortlist (>= threshold) or archive (< threshold, never deleted). */
export function scoreCandidates(store: CandidateStore, cfg: PipelineConfig, ids?: string[]): {scored: number; shortlisted: number; archived: number} {
  const ctx = scoreContext(store, cfg);
  let scored = 0;
  let shortlisted = 0;
  let archived = 0;
  const targets = store.all().filter((c) => (ids ? ids.includes(c.id) : ['METADATA_ANALYZED', 'CONTENT_ANALYZED', 'SCORED', 'SHORTLISTED', 'ARCHIVED'].includes(c.state)));
  for (const c of targets) {
    // selected / in production / done: refresh the score only, never move the candidate back
    if (['SELECTED', 'REJECTED', 'EXPORTED'].includes(c.state) || isAtLeast(c.state, 'EDITING') || ['MEDIA_UNAVAILABLE', 'RENDER_FAILED', 'QC_FAILED', 'ANALYSIS_FAILED'].includes(c.state)) {
      c.score = bestScore(c, ctx, loadAnalysis(c));
      c.updatedAt = nowIso();
      scored++;
      continue;
    }
    if (c.state === 'ARCHIVED' && c.history.at(-1)?.note?.startsWith('manual')) continue; // respect manual archive
    const s = bestScore(c, ctx, loadAnalysis(c));
    c.score = s;
    c.updatedAt = nowIso();
    if (c.state !== 'SCORED') store.setState(c, 'SCORED', `${s.total} pts (${s.analysisLevel})`);
    scored++;
    if (s.qualifies) {
      store.setState(c, 'SHORTLISTED', `score ${s.total} ≥ ${cfg.scoring.threshold}`);
      shortlisted++;
    } else {
      store.setState(c, 'ARCHIVED', `auto: score ${s.total} < ${cfg.scoring.threshold}`);
      archived++;
    }
  }
  store.save();
  return {scored, shortlisted, archived};
}

/** Step 4: obtain the media file (allowed routes only). */
export async function acquire(store: CandidateStore, cfg: PipelineConfig, c: Candidate): Promise<boolean> {
  try {
    const r = await acquireMedia(c, cfg);
    if (r.ok && r.media) {
      c.media = {status: 'available', local: {...r.media, path: rel(r.media.path)}, reason: `via ${r.method}`};
      store.save();
      return true;
    }
    c.media = {...c.media, status: c.media.status === 'downloadable' ? 'unavailable' : 'manual_required', reason: r.reason};
    c.lastError = {step: 'acquire', message: r.reason ?? 'unknown', at: nowIso()};
    if (c.state === 'SELECTED') store.setState(c, 'MEDIA_UNAVAILABLE', r.reason);
    store.save();
    return false;
  } catch (e) {
    c.media = {...c.media, reason: (e as Error).message};
    c.lastError = {step: 'acquire', message: (e as Error).message, at: nowIso()};
    store.setState(c, 'MEDIA_UNAVAILABLE', (e as Error).message.slice(0, 200));
    store.save();
    return false;
  }
}

/** Step 5: real content analysis on the media file, then re-score. */
export async function analyzeContent(store: CandidateStore, cfg: PipelineConfig, c: Candidate, force = false): Promise<VideoAnalysis | null> {
  if (!c.media.local?.path) throw new Error(`${c.id}: no local media – run acquire first`);
  const out = path.join(PATHS.analysis, 'candidates', `${c.id}.video.json`);
  try {
    let a: VideoAnalysis;
    if (!force && fs.existsSync(out) && c.contentAnalysisPath) a = readJson<VideoAnalysis>(out);
    else a = await runAnalysis<VideoAnalysis>(['video', abs(c.media.local.path)], out);
    c.contentAnalysisPath = rel(out);
    const keep = c.state;
    if (isAtLeast(keep, 'EDITING')) {
      store.save();
      return a; // production already running – keep its state
    }
    if (['METADATA_ANALYZED', 'SCORED', 'SHORTLISTED', 'SELECTED', 'ARCHIVED', 'MEDIA_UNAVAILABLE', 'ANALYSIS_FAILED'].includes(keep) && keep !== 'CONTENT_ANALYZED') {
      if (keep === 'ARCHIVED' || keep === 'MEDIA_UNAVAILABLE' || keep === 'ANALYSIS_FAILED') store.setState(c, 'SCORED', 'resume for content analysis');
      store.setState(c, 'CONTENT_ANALYZED', `${a.info.width}x${a.info.height}, ${a.info.durationSec}s, ${a.cuts.length} cuts`);
    }
    const ctx = scoreContext(store, cfg);
    c.score = bestScore(c, ctx, a);
    store.setState(c, 'SCORED', `${c.score.total} pts (${c.score.analysisLevel})`);
    if (keep === 'SELECTED') {
      store.setState(c, 'SHORTLISTED', 'content analysed');
      store.setState(c, 'SELECTED', 'keep selection after analysis');
    } else if (c.score.qualifies) store.setState(c, 'SHORTLISTED', `score ${c.score.total}`);
    else store.setState(c, 'ARCHIVED', `auto: score ${c.score.total} < ${cfg.scoring.threshold}`);
    store.save();
    return a;
  } catch (e) {
    c.lastError = {step: 'analyze', message: (e as Error).message, at: nowIso()};
    store.setState(c, 'ANALYSIS_FAILED', (e as Error).message.slice(0, 200));
    store.save();
    return null;
  }
}

/** Import a file you already have (e.g. references/raw-examples/clip.mp4) as a candidate. */
export async function importLocal(store: CandidateStore, file: string, title?: string, sourceUrl?: string): Promise<Candidate> {
  const p = abs(file);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${file}`);
  const media = describeMedia(p);
  const id = path.basename(p).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const c = newCandidate({
    platform: 'local',
    platformId: id,
    url: sourceUrl ?? `file://${rel(p)}`,
    title: title ?? id.replace(/[-_]+/g, ' '),
    durationSec: media.durationSec,
    width: media.width,
    height: media.height,
  });
  c.media = {status: 'available', local: {...media, path: rel(p)}, reason: 'imported local file'};
  const res = store.add(c);
  if (!res.added) {
    log.info(`already known as ${res.candidate.id} (${res.duplicate?.reason})`);
    return res.candidate;
  }
  c.categories = categoriesOf(c.title.toLowerCase());
  store.setState(c, 'METADATA_ANALYZED', 'local import');
  store.save();
  return c;
}

/** Add a candidate from a pasted URL (TikTok / YouTube / other) using official oEmbed metadata. */
export async function importUrl(store: CandidateStore, url: string, title?: string): Promise<Candidate> {
  const meta = await oembedLookup(url);
  const host = new URL(url).hostname;
  const platform = host.includes('tiktok') ? 'tiktok' : host.includes('youtu') ? 'youtube' : host.includes('dailymotion') ? 'dailymotion' : 'other';
  const idMatch = url.match(/video\/(\d+)/)?.[1] ?? url.match(/[?&]v=([\w-]{6,})/)?.[1] ?? url.match(/shorts\/([\w-]{6,})/)?.[1] ?? Buffer.from(url).toString('base64url').slice(-16);
  const c = newCandidate({platform, platformId: idMatch, url, title: title ?? meta?.title ?? url, channel: meta?.author, thumbnailUrl: meta?.thumbnail});
  c.media = {status: 'manual_required', reason: 'Pasted link – place the video file in media/inbox/ (only with permission).'};
  const res = store.add(c);
  if (!res.added) return res.candidate;
  c.categories = categoriesOf(c.title.toLowerCase());
  c.isCompilation = isCompilation(c);
  store.setState(c, 'METADATA_ANALYZED', 'manual URL import');
  store.save();
  return c;
}

export function select(store: CandidateStore, c: Candidate, note = 'manual selection'): void {
  if (c.state === 'SELECTED') return;
  if (c.state === 'ARCHIVED' || c.state === 'REJECTED') store.setState(c, 'SCORED', 'restored for selection');
  if (c.state === 'METADATA_ANALYZED' || c.state === 'CONTENT_ANALYZED') {
    c.score = bestScore(c, scoreContext(store, loadPipelineConfig()), loadAnalysis(c));
    store.setState(c, 'SCORED', `${c.score.total} pts`);
  }
  if (c.state === 'SCORED') store.setState(c, 'SHORTLISTED', 'manual');
  // SHORTLISTED, failed states and later production states (resume / re-edit) all go back to SELECTED
  store.setState(c, 'SELECTED', note);
  store.save();
}

export interface ProduceResult {
  jobId: string;
  plan: EditPlan;
  output: string;
  qc: QcReport;
  renderSeconds: number;
}

export function jobIdFor(c: Candidate, variant: string): string {
  return `${new Date().toISOString().slice(0, 10)}_${c.id}_${variant}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * Steps 6-9: plan -> render -> QC -> REVIEW. Resumable: an existing render for the
 * same job is reused unless `force` is set; failures move the candidate into
 * RENDER_FAILED / QC_FAILED and can be retried with `retry`.
 */
export async function produce(store: CandidateStore, c: Candidate, opts: {overrides?: PlanOverrides; force?: boolean; allowDuplicate?: boolean} = {}): Promise<ProduceResult> {
  const cfg = loadPipelineConfig();
  const music = loadMusicConfig();
  const assets = loadAssetsConfig();
  const beatmap = loadBeatMap(music);
  if (c.state !== 'SELECTED') select(store, c, 'start production');
  if (!c.media.local?.path) {
    const ok = await acquire(store, cfg, c);
    if (!ok) throw new Error(c.media.reason ?? 'media unavailable');
  }
  const prev = store.findProduction(c, (a, b) => dHashDistance(a, b) <= 40);
  if (prev && prev.candidateId !== c.id && !opts.allowDuplicate) {
    throw new Error(`Duplicate: this video was already produced as ${prev.jobId} (candidate ${prev.candidateId}). Use --allow-duplicate to override.`);
  }
  let analysis = loadAnalysis(c);
  if (!analysis) analysis = await analyzeContent(store, cfg, c);
  if (!analysis) throw new Error(`content analysis failed: ${c.lastError?.message}`);
  if (c.state !== 'SELECTED') select(store, c, 'continue production');
  analysis = await ensureSpeech(c, analysis);
  const songInClip = await detectSongInClip(c, cfg);

  const overrides: PlanOverrides = {...(c.editOverrides as PlanOverrides | undefined), ...opts.overrides};
  const variant = overrides.variant ?? cfg.outro.variant;
  // resume: keep the previous job id for the same variant so an existing render is reused
  const jobId = !opts.force && c.jobId?.endsWith(`_${variant}`) ? c.jobId : jobIdFor(c, variant);
  const jobDir = path.join(PATHS.jobs, jobId);
  const outFile = path.join(PATHS.output, jobId, 'final.mp4');
  store.setState(c, 'EDITING', jobId);
  c.jobId = jobId;
  store.save();

  let plan: EditPlan;
  try {
    plan = buildEditPlan({jobId, candidateId: c.id, storySrc: c.media.local!.path, analysis, config: cfg, music, beatmap, assets, overrides, songInClip});
    writeJson(path.join(jobDir, 'plan.json'), plan);
    for (const w of plan.warnings) log.warn(w, {candidateId: c.id});
  } catch (e) {
    c.lastError = {step: 'plan', message: (e as Error).message, at: nowIso()};
    store.setState(c, 'RENDER_FAILED', `plan: ${(e as Error).message.slice(0, 160)}`);
    store.save();
    throw e;
  }

  let renderSeconds = 0;
  try {
    if (opts.force || !fs.existsSync(outFile)) {
      const r = await renderPlan(plan, cfg, outFile);
      renderSeconds = r.seconds;
    }
    store.setState(c, 'RENDERED', rel(outFile));
    store.recordProduction({candidateId: c.id, jobId, mediaSha256: c.media.local?.sha256, dHash: c.media.local?.dHash, titleFingerprint: c.titleFingerprint, renderedAt: nowIso(), status: 'rendered', output: rel(outFile)});
    store.save();
  } catch (e) {
    c.lastError = {step: 'render', message: (e as Error).message, at: nowIso()};
    store.setState(c, 'RENDER_FAILED', (e as Error).message.slice(0, 200));
    store.save();
    throw e;
  }

  const qc = await qualityCheck(outFile, plan, {cfg, audioDramaturgy: true, repetition: true});
  writeJson(path.join(jobDir, 'qc.json'), qc);
  if (!qc.pass) {
    c.lastError = {step: 'qc', message: qc.checks.filter((x) => !x.pass && x.severity === 'error').map((x) => x.name).join(', '), at: nowIso()};
    store.setState(c, 'QC_FAILED', c.lastError.message);
    store.save();
    return {jobId, plan, output: outFile, qc, renderSeconds};
  }
  store.setState(c, 'QUALITY_CHECKED', `${qc.checks.filter((x) => x.pass).length}/${qc.checks.length} checks passed`);
  store.setState(c, 'REVIEW', 'waiting for your approval');
  store.save();
  return {jobId, plan, output: outFile, qc, renderSeconds};
}

export function approve(store: CandidateStore, c: Candidate): void {
  store.setState(c, 'APPROVED', 'approved by user');
  const p = store.productions().find((x) => x.jobId === c.jobId);
  if (p) p.status = 'approved';
  store.save();
}

/** Copy the approved video to output/export/ (no automatic upload anywhere). */
export function exportVideo(store: CandidateStore, c: Candidate): string {
  if (c.state !== 'APPROVED') throw new Error(`${c.id} must be APPROVED before export (is ${c.state})`);
  const p = store.productions().find((x) => x.jobId === c.jobId);
  if (!p?.output) throw new Error('no rendered output recorded');
  const dest = path.join(PATHS.output, 'export', `${c.jobId}.mp4`);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(abs(p.output), dest);
  p.status = 'exported';
  store.setState(c, 'EXPORTED', rel(dest));
  store.save();
  return dest;
}

export function retry(store: CandidateStore, c: Candidate): CandidateState | null {
  const t = retryTarget(c);
  if (!t) return null;
  store.setState(c, t, 'retry');
  c.lastError = undefined;
  store.save();
  return t;
}

export function setStatus(store: CandidateStore, c: Candidate, action: 'favorite' | 'unfavorite' | 'reject' | 'archive' | 'restore'): void {
  if (action === 'favorite') c.favorite = true;
  else if (action === 'unfavorite') c.favorite = false;
  else if (action === 'reject') store.setState(c, 'REJECTED', 'manual reject');
  else if (action === 'archive') store.setState(c, 'ARCHIVED', 'manual archive');
  else if (action === 'restore') {
    store.setState(c, 'SCORED', 'manual restore');
    store.setState(c, 'SHORTLISTED', 'manual restore');
  }
  c.updatedAt = nowIso();
  store.save();
}

export function summary(store: CandidateStore): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of store.all()) out[c.state] = (out[c.state] ?? 0) + 1;
  return out;
}

/** Older analyses have no speech detection yet – add it once (cached in the analysis file). */
export async function ensureSpeech(c: Candidate, analysis: VideoAnalysis): Promise<VideoAnalysis> {
  const a = analysis as VideoAnalysis & {speech?: unknown};
  if (a.speech || !c.media.local?.path || !c.contentAnalysisPath) return analysis;
  const speech = await runAnalysis<{segments: [number, number][]}>(['speech', abs(c.media.local.path)], path.join(PATHS.cache, 'speech', `${c.id}.json`));
  const merged = {...analysis, speech};
  writeJson(abs(c.contentAnalysisPath), merged);
  return merged;
}

/**
 * Does the clip itself already contain "Meant to Be"? (e.g. a clip taken from a finished
 * TikTok). Then its own audio is muted, otherwise the song would play twice, shifted.
 */
export async function detectSongInClip(c: Candidate, cfg: PipelineConfig): Promise<boolean> {
  if (!c.media.local?.path) return false;
  const out = path.join(PATHS.analysis, 'candidates', `${c.id}.songmatch.json`);
  const music = loadMusicConfig();
  const r = fs.existsSync(out)
    ? readJson<{segments: {mediaStart: number; mediaEnd: number; meanSimilarity: number}[]}>(out)
    : await runAnalysis<{segments: {mediaStart: number; mediaEnd: number; meanSimilarity: number}[]}>(['locate', abs(c.media.local.path), '--song', abs(music.track)], out);
  const found = r.segments.filter((s) => s.meanSimilarity >= cfg.audio.songDetectSimilarity && s.mediaEnd - s.mediaStart >= 3);
  if (found.length) log.info(`song detected inside the clip (${found.length} segment(s)) – clip audio will be muted`, {candidateId: c.id});
  return found.length > 0;
}
