#!/usr/bin/env node
/**
 * Kindness AI command line.  Usage:  npm run kai -- <command> [args] [--flags]
 * Run `npm run kai -- help` for the list of commands.
 */
import fs from 'node:fs';
import path from 'node:path';
import {PATHS, abs, rel} from './core/paths.js';
import {readJson, sha256File, writeJson} from './core/fsutil.js';
import {logger} from './core/logger.js';
import {AssetsConfigSchema, loadAssetsConfig, loadMusicConfig, loadPipelineConfig} from './core/config.js';
import {CandidateStore} from './core/store.js';
import {runAnalysis} from './core/python.js';
import {loadBeatMap, type BeatMap} from './music/beatmap.js';
import {buildOutroPreviewPlan} from './outro/preview.js';
import {renderPlan} from './render/render.js';
import {qualityCheck} from './render/qc.js';
import * as P from './pipeline/pipeline.js';
import type {PlanOverrides} from './edit/planner.js';

const log = logger('cli');

function parseArgs(argv: string[]): {cmd: string; pos: string[]; flags: Record<string, string | boolean>} {
  const [cmd = 'help', ...rest] = argv;
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) flags[k] = rest[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return {cmd, pos, flags};
}

const HELP = `Kindness AI – commands (npm run kai -- <command>)

  status                         Overview of all candidates per pipeline state
  list [--state S] [--top N]     List candidates (sorted by score)
  show <id>                      Show one candidate incl. score breakdown

  music:analyze [--force]        Analyse "Meant to Be" (beat map); skipped if unchanged
  music:drop [--set SEC|--clear] Show / override the drop time used for every edit
  references:analyze [--force]   Analyse reference + outro videos (cuts, colour, song position)

  outro:preview [--variant A|B|C|D|all]   Render outro preview videos to output/outro-previews/
  outro:v3 [--skip-render]       Render outro V3 clean + definition + side-by-side comparison with QC
  outro:approve <variant> [--overlay clean|dictionary]   Approved production outro (V3: choose the text version)

  discover [--queries "a;b"] [--adapters youtube,dailymotion] [--limit N]
  score [--ids a,b]              (Re-)score candidates; >=75 -> SHORTLISTED, <75 -> ARCHIVED
  import <file> [--title T]      Import a local video file as candidate (e.g. references/raw-examples/x.mp4)
  import-url <url> [--title T]   Add a TikTok/YouTube/... link as candidate (metadata via oEmbed)
  acquire <id>                   Get the media file (inbox / free-licensed download)
  analyze <id> [--force]         Content analysis of the media file + re-score
  review <id>                    OPTIONAL paid vision review (Claude API, off by default)

  select|favorite|unfavorite|reject|archive|restore <id>
  set <id> --highlight SEC --hook "text" --variant B --in SEC --out SEC --transition flash --story-audio 0.3
  produce <id> [--variant X] [--force] [--allow-duplicate]   plan + render + QC -> REVIEW
  approve <id> | export <id> | retry <id>
  qc <video.mp4> <plan.json>     Run the quality check on a rendered file

  run [--no-discover] [--produce-selected]   Automated run: discover -> score -> (produce selected)
  dashboard [--port 4173]        Local candidate dashboard (http://localhost:4173)
  dashboard:build                Static dashboard snapshot -> dashboard-dist/index.html
  apply-selection <file.json>    Apply decisions exported from the static snapshot
`;

async function ensureBeatmap(force = false): Promise<BeatMap> {
  const music = loadMusicConfig();
  const file = abs(music.beatmap);
  const sha = sha256File(abs(music.track));
  if (!force && fs.existsSync(file)) {
    const bm = readJson<BeatMap>(file);
    if (bm.source.sha256 === sha) return bm;
    log.info('music file changed – re-analysing');
  }
  return runAnalysis<BeatMap>(['music', abs(music.track), '--expected-bpm', '140'], file);
}

function printCandidate(c: ReturnType<CandidateStore['require']>): void {
  console.log(`${c.id}  [${c.state}]${c.favorite ? ' ★' : ''}\n  ${c.title}\n  ${c.url}`);
  console.log(`  media: ${c.media.status}${c.media.local ? ` (${c.media.local.path}, ${c.media.local.width}x${c.media.local.height}, ${c.media.local.durationSec.toFixed(1)} s)` : ''} ${c.media.reason ?? ''}`);
  if (c.score) {
    const s = c.score;
    console.log(`  score: ${s.total}/100  level=${s.analysisLevel}${s.provisional ? ' (VORLÄUFIG)' : ''}  qualifies=${s.qualifies}`);
    for (const k of ['emotional', 'clarity', 'dropPotential', 'visualQuality', 'originality'] as const) {
      console.log(`    ${k.padEnd(14)} ${String(s[k].points).padStart(4)}/${s[k].max}  ${s[k].reasons.join('; ')}`);
    }
  }
  if (c.lastError) console.log(`  last error (${c.lastError.step}): ${c.lastError.message}`);
}

async function main(): Promise<void> {
  const {cmd, pos, flags} = parseArgs(process.argv.slice(2));
  const store = () => new CandidateStore();
  switch (cmd) {
    case 'help':
    case '--help':
      console.log(HELP);
      return;

    case 'status': {
      const s = store();
      console.log(JSON.stringify(P.summary(s), null, 2));
      console.log(`${s.all().length} candidates, ${s.productions().length} productions`);
      return;
    }
    case 'list': {
      const s = store();
      let list = s.all();
      if (flags.state) list = list.filter((c) => c.state === flags.state);
      list.sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1));
      for (const c of list.slice(0, Number(flags.top ?? 50))) {
        console.log(`${String(c.score?.total ?? '-').padStart(5)}  ${c.score?.provisional ? 'v' : ' '} ${c.state.padEnd(17)} ${c.id.padEnd(22)} ${c.title.slice(0, 70)}`);
      }
      return;
    }
    case 'show':
      printCandidate(store().require(pos[0]));
      return;

    case 'music:analyze': {
      const bm = await ensureBeatmap(!!flags.force);
      console.log(`BPM ${bm.bpm}, ${bm.beats.length} beats, ${bm.downbeats.length} downbeats, loudness ${bm.loudness.integratedLufs} LUFS`);
      console.log('Drop candidates (audio only):', bm.dropCandidates.map((d) => `${d.time}s (${d.score})`).join(', '));
      const m = loadMusicConfig();
      console.log(`Configured drop: ${m.drop.manualOverride ?? m.drop.auto} s (${m.drop.manualOverride !== null ? 'manual override' : m.drop.source})`);
      return;
    }
    case 'music:drop': {
      const m = readJson<Record<string, any>>(PATHS.musicConfig);
      if (flags.set !== undefined) m.drop.manualOverride = Number(flags.set);
      if (flags.clear) m.drop.manualOverride = null;
      if (flags.set !== undefined || flags.clear) writeJson(PATHS.musicConfig, m);
      console.log(`drop: auto=${m.drop.auto} (${m.drop.source}), manualOverride=${m.drop.manualOverride}`);
      return;
    }
    case 'references:analyze': {
      const music = loadMusicConfig();
      const jobs: [string, string][] = [];
      for (const dir of ['references/tiktok-edits', 'assets/outro/sources', 'assets/outro/edits']) {
        for (const f of fs.readdirSync(abs(dir)).filter((x) => /\.(mp4|mov)$/i.test(x))) jobs.push([dir, f]);
      }
      for (const [dir, f] of jobs) {
        const base = f.replace(/\.[^.]+$/, '');
        const outDir = path.join(PATHS.analysis, dir.startsWith('references') ? 'references' : 'outro');
        const vOut = path.join(outDir, `${base}.video.json`);
        const sOut = path.join(outDir, `${base}.songmatch.json`);
        if (flags.force || !fs.existsSync(vOut)) await runAnalysis(['video', abs(path.join(dir, f))], vOut);
        if (!dir.endsWith('sources') && (flags.force || !fs.existsSync(sOut))) await runAnalysis(['locate', abs(path.join(dir, f)), '--song', abs(music.track)], sOut);
        console.log(`analysed ${dir}/${f}`);
      }
      const {summarizeReferences} = await import('./analysis/reference-summary.js');
      console.log(JSON.stringify((summarizeReferences(await ensureBeatmap()) as {consensus: unknown}).consensus));
      return;
    }
    case 'references:summary': {
      const {summarizeReferences} = await import('./analysis/reference-summary.js');
      console.log(JSON.stringify(summarizeReferences(await ensureBeatmap()), null, 2));
      return;
    }

    case 'outro:preview': {
      const cfg = loadPipelineConfig();
      const music = loadMusicConfig();
      const assets = loadAssetsConfig();
      const bm = await ensureBeatmap();
      const v = String(flags.variant ?? 'all');
      const ids = v === 'all' ? assets.outroVariants.map((x) => x.id) : v.split(',');
      for (const id of ids) {
        const plan = buildOutroPreviewPlan({variantId: id, config: cfg, music, beatmap: bm, assets});
        const out = path.join(PATHS.output, 'outro-previews', `outro-${id}.mp4`);
        writeJson(out.replace(/\.mp4$/, '.plan.json'), plan);
        const r = await renderPlan(plan, cfg, out);
        const qc = await qualityCheck(out, plan);
        console.log(`outro ${id} (${plan.outro.variantName}): ${rel(out)}  ${r.seconds.toFixed(0)} s render, QC ${qc.pass ? 'PASS' : 'FAIL'}`);
        for (const w of plan.warnings) console.log(`  warning: ${w}`);
      }
      return;
    }
    case 'outro:v3': {
      const {renderOutroV3, V3_FILES} = await import('./outro/v3.js');
      const {report, pass} = await renderOutroV3({skipRender: !!flags['skip-render']});
      const checks = report.checks as {name: string; pass: boolean; severity: string; value: unknown}[];
      for (const c of checks) console.log(`${c.pass ? 'PASS' : c.severity === 'warning' ? 'WARN' : 'FAIL'}  ${c.name}: ${JSON.stringify(c.value).slice(0, 160)}`);
      console.log(`\nOutro V3 ${pass ? 'PASSED' : 'FAILED'}:\n  ${rel(V3_FILES.clean)}\n  ${rel(V3_FILES.definition)}\n  ${rel(V3_FILES.comparison)}`);
      if (!pass) process.exitCode = 1;
      return;
    }
    case 'outro:approve': {
      const raw = readJson<Record<string, any>>(PATHS.assetsConfig);
      const id = pos[0];
      if (!raw.outroVariants.some((x: {id: string}) => x.id === id)) throw new Error(`unknown variant ${id}`);
      // optional text treatment for production: --overlay clean | dictionary
      if (typeof flags.overlay === 'string') {
        const ov = flags.overlay === 'dictionary' ? 'dictionary' : flags.overlay === 'clean' || flags.overlay === 'caption' ? 'caption' : null;
        if (!ov) throw new Error('--overlay must be "clean" or "dictionary"');
        raw.outroVariants.find((x: {id: string}) => x.id === id).overlay = ov;
      }
      const v3 = id === 'V3' ? path.join(PATHS.output, 'kindness-outro-v3', `kindness-outro-v3-${raw.outroVariants.find((x: {id: string}) => x.id === id).overlay === 'dictionary' ? 'definition' : 'clean'}.mp4`) : null;
      const prev = path.join(PATHS.output, 'outro-previews', `outro-${id}.mp4`);
      raw.approvedOutro = {variant: id, approvedAt: new Date().toISOString(), renderedAsset: v3 && fs.existsSync(v3) ? rel(v3) : fs.existsSync(prev) ? rel(prev) : null};
      AssetsConfigSchema.parse(raw);
      writeJson(PATHS.assetsConfig, raw);
      const cfg = readJson<Record<string, any>>(PATHS.pipelineConfig);
      cfg.outro.variant = id;
      writeJson(PATHS.pipelineConfig, cfg);
      console.log(`Outro variant ${id} approved and set as default for new productions.`);
      return;
    }

    case 'discover': {
      const s = store();
      const cfg = loadPipelineConfig();
      const r = await P.discover(s, cfg, {
        queries: typeof flags.queries === 'string' ? flags.queries.split(';').map((q) => q.trim()).filter(Boolean) : undefined,
        adapters: typeof flags.adapters === 'string' ? flags.adapters.split(',') : undefined,
        limit: flags.limit ? Number(flags.limit) : undefined,
      });
      writeJson(path.join(PATHS.data, 'last-discovery.json'), {at: new Date().toISOString(), ...r});
      console.log(JSON.stringify(r.perAdapter, null, 2));
      console.log(`${r.added.length} new candidates`);
      if (!flags['no-score']) console.log(P.scoreCandidates(s, cfg));
      return;
    }
    case 'score':
      console.log(P.scoreCandidates(store(), loadPipelineConfig(), typeof flags.ids === 'string' ? flags.ids.split(',') : undefined));
      return;
    case 'import': {
      const s = store();
      const c = await P.importLocal(s, pos[0], typeof flags.title === 'string' ? flags.title : undefined, typeof flags.url === 'string' ? flags.url : undefined);
      console.log(`imported as ${c.id}`);
      return;
    }
    case 'import-url': {
      const s = store();
      const c = await P.importUrl(s, pos[0], typeof flags.title === 'string' ? flags.title : undefined);
      printCandidate(c);
      return;
    }
    case 'acquire': {
      const s = store();
      const c = s.require(pos[0]);
      const ok = await P.acquire(s, loadPipelineConfig(), c);
      console.log(ok ? `media available: ${c.media.local?.path}` : `not available: ${c.media.reason}`);
      return;
    }
    case 'analyze': {
      const s = store();
      const c = s.require(pos[0]);
      if (!c.media.local) await P.acquire(s, loadPipelineConfig(), c);
      await P.analyzeContent(s, loadPipelineConfig(), c, !!flags.force);
      printCandidate(c);
      return;
    }
    case 'review': {
      const cfg = loadPipelineConfig();
      const vr = cfg.scoring.visionReview;
      if (!vr.enabled) {
        console.log('Vision review is disabled (paid Claude API). Enable scoring.visionReview.enabled in config/pipeline.json and provide ANTHROPIC_API_KEY.');
        process.exitCode = 1;
        return;
      }
      const s = store();
      const c = s.require(pos[0]);
      if (!c.media.local) await P.acquire(s, cfg, c);
      const a = c.contentAnalysisPath ? readJson<any>(abs(c.contentAnalysisPath)) : await P.analyzeContent(s, cfg, c);
      const {visionReview} = await import('./scoring/vision-review.js');
      const r = await visionReview(c, a, vr);
      console.log(`review by ${r.reviewer}: ${JSON.stringify(r.scores)}`);
      P.scoreCandidates(s, cfg, [c.id]);
      printCandidate(s.require(c.id));
      return;
    }
    case 'select': {
      const s = store();
      P.select(s, s.require(pos[0]));
      console.log(`${pos[0]} -> ${s.require(pos[0]).state}`);
      return;
    }
    case 'favorite':
    case 'unfavorite':
    case 'reject':
    case 'archive':
    case 'restore': {
      const s = store();
      P.setStatus(s, s.require(pos[0]), cmd);
      console.log(`${pos[0]}: ${cmd} -> ${s.require(pos[0]).state}`);
      return;
    }
    case 'set': {
      const s = store();
      const c = s.require(pos[0]);
      const o: PlanOverrides = {...(c.editOverrides as PlanOverrides | undefined)};
      if (flags.highlight !== undefined) o.highlightTime = Number(flags.highlight);
      if (flags.in !== undefined) o.storyIn = Number(flags.in);
      if (flags.out !== undefined) o.storyOut = Number(flags.out);
      if (typeof flags.hook === 'string') o.hookText = flags.hook;
      if (typeof flags.variant === 'string') o.variant = flags.variant;
      if (typeof flags.transition === 'string') o.transition = flags.transition as PlanOverrides['transition'];
      if (typeof flags.caption === 'string') o.dropCaption = flags.caption === 'none' ? null : flags.caption;
      if (flags['story-audio'] !== undefined) o.storyAudioGain = Number(flags['story-audio']);
      c.editOverrides = o as Record<string, unknown>;
      s.save();
      console.log(`${c.id} overrides:`, o);
      return;
    }
    case 'produce': {
      const s = store();
      const c = s.require(pos[0]);
      const r = await P.produce(s, c, {
        overrides: typeof flags.variant === 'string' ? {variant: flags.variant} : undefined,
        force: !!flags.force,
        allowDuplicate: !!flags['allow-duplicate'],
      });
      console.log(`\n${c.id}: ${c.state}  ->  ${rel(r.output)}  (${r.plan.durationSec} s)`);
      for (const q of r.qc.checks) console.log(`  ${q.pass ? 'PASS' : q.severity === 'warning' ? 'WARN' : 'FAIL'}  ${q.name}: ${JSON.stringify(q.value)}`);
      return;
    }
    case 'approve': {
      const s = store();
      P.approve(s, s.require(pos[0]));
      console.log(`${pos[0]} approved`);
      return;
    }
    case 'export': {
      const s = store();
      console.log(`exported to ${rel(P.exportVideo(s, s.require(pos[0])))} (no upload – publish it yourself on TikTok)`);
      return;
    }
    case 'retry': {
      const s = store();
      console.log(`${pos[0]} -> ${P.retry(s, s.require(pos[0])) ?? 'nothing to retry'}`);
      return;
    }
    case 'qc': {
      const plan = readJson<any>(abs(pos[1]));
      const r = await qualityCheck(abs(pos[0]), plan);
      for (const q of r.checks) console.log(`${q.pass ? 'PASS' : q.severity === 'warning' ? 'WARN' : 'FAIL'}  ${q.name}: ${JSON.stringify(q.value)}`);
      return;
    }

    case 'run': {
      const s = store();
      const cfg = loadPipelineConfig();
      await ensureBeatmap();
      if (!flags['no-discover']) {
        const r = await P.discover(s, cfg);
        writeJson(path.join(PATHS.data, 'last-discovery.json'), {at: new Date().toISOString(), ...r});
      }
      console.log('score:', P.scoreCandidates(s, cfg));
      // shortlisted candidates whose media we are allowed to fetch get analysed automatically
      for (const c of s.byState('SHORTLISTED').filter((x) => x.media.status === 'downloadable' || x.media.status === 'available')) {
        if (await P.acquire(s, cfg, c)) await P.analyzeContent(s, cfg, c);
      }
      if (flags['produce-selected']) {
        for (const c of s.byState('SELECTED')) {
          try {
            await P.produce(s, c);
          } catch (e) {
            log.error(`produce ${c.id} failed: ${(e as Error).message}`);
          }
        }
      }
      console.log(JSON.stringify(P.summary(s), null, 2));
      return;
    }
    case 'dashboard': {
      const {startDashboard} = await import('./dashboard/server.js');
      await startDashboard(Number(flags.port ?? 4173));
      return;
    }
    case 'apply-selection': {
      // decisions made in the static dashboard snapshot ("Auswahl exportieren")
      const sel = readJson<{actions: Record<string, {favorite?: boolean; state?: string}>}>(abs(pos[0]));
      const s = store();
      for (const [id, a] of Object.entries(sel.actions)) {
        const c = s.get(id);
        if (!c) continue;
        if (a.favorite !== undefined) P.setStatus(s, c, a.favorite ? 'favorite' : 'unfavorite');
        if (a.state === 'SELECTED') P.select(s, c, 'selected in dashboard snapshot');
        else if (a.state === 'REJECTED') P.setStatus(s, c, 'reject');
        else if (a.state === 'ARCHIVED') P.setStatus(s, c, 'archive');
        else if (a.state === 'SHORTLISTED' && ['ARCHIVED', 'REJECTED'].includes(c.state)) P.setStatus(s, c, 'restore');
        else if (a.state === 'APPROVED' && c.state === 'REVIEW') P.approve(s, c);
        console.log(`${id}: ${c.state}${c.favorite ? ' ★' : ''}`);
      }
      return;
    }
    case 'dashboard:build': {
      const {buildStaticDashboard} = await import('./dashboard/server.js');
      console.log(`written ${rel(buildStaticDashboard())}`);
      return;
    }
    default:
      console.log(`Unknown command "${cmd}".\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`ERROR: ${(e as Error).message}`);
  process.exitCode = 1;
});
