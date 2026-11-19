/**
 * V4 final polish: render + verify
 *   A  kindness-outro-v4-definition.mp4   new V4 outro (dictionary), build-up lead-in
 *   B  kindness-v4-full-audio-test.mp4    real kindness story (TEST material) + continuous song + V4 outro
 *   B2 kindness-v4-speech-ducking-test.mp4 speech clip (public domain, TEST) – ducking / intelligibility
 *   C  kindness-v3-v4-comparison.mp4       V3 definition left, V4 definition right, in sync
 * V4 is NOT approved automatically.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PATHS, abs, rel} from '../core/paths.js';
import {ensureDir, writeJson} from '../core/fsutil.js';
import {logger} from '../core/logger.js';
import {loadAssetsConfig, loadMusicConfig, loadPipelineConfig} from '../core/config.js';
import {CandidateStore} from '../core/store.js';
import {loadBeatMap} from '../music/beatmap.js';
import type {EditPlan} from '../edit/plan-types.js';
import {buildOutroPreviewPlan} from './preview.js';
import {renderPlan, renderStills} from '../render/render.js';
import {qualityCheck, type QcCheck} from '../render/qc.js';
import {runFfmpeg, mediaInfo} from '../media/ffmpeg.js';
import {checkRepetition, describeViolations} from './repetition.js';
import {buildV3Plans, V3_FILES} from './v3.js';
import * as P from '../pipeline/pipeline.js';

const log = logger('outro-v4');

export const V4_DIR = path.join(PATHS.output, 'kindness-v4');
export const V4_FILES = {
  outro: path.join(V4_DIR, 'kindness-outro-v4-definition.mp4'),
  fullAudio: path.join(V4_DIR, 'kindness-v4-full-audio-test.mp4'),
  speech: path.join(V4_DIR, 'kindness-v4-speech-ducking-test.mp4'),
  comparison: path.join(V4_DIR, 'kindness-v3-v4-comparison.mp4'),
};

export const STORY_TEST_ID = 'local_test-input_ref04-story_dog-guides-blind-cat';
const SPEECH_TEST_CANDIDATE = 'wm_Youth_Programs_Interception_-1-_Bad_Sportsmanship_AD_webm';
const SPEECH_TEST_SRC = `media/downloads/${SPEECH_TEST_CANDIDATE}.webm`;
const SPEECH_TEST_FILE = 'media/test-inputs/TEST-SPEECH_cdc-public-domain_classroom.mp4';

export function buildV4OutroPlan(): EditPlan {
  const cfg = loadPipelineConfig();
  const music = loadMusicConfig();
  return buildOutroPreviewPlan({variantId: 'V4', config: cfg, music, beatmap: loadBeatMap(music), assets: loadAssetsConfig(), overlay: 'dictionary', jobId: 'kindness-outro-v4-definition'});
}

const check = (name: string, pass: boolean, value: unknown, expected: string, severity: 'error' | 'warning' = 'error'): QcCheck => ({name, pass, value, expected, severity});

/** Count of bright pixels (text) in an overlay-only PNG. */
function brightPixels(png: string): number {
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {maxBuffer: 64 * 1024 * 1024});
  const b = r.stdout as Buffer;
  let n = 0;
  for (let i = 0; i < b.length; i++) if (b[i] > 60) n++;
  return n;
}

async function psnr(a: string, b: string): Promise<number> {
  const err = await runFfmpeg(['-i', a, '-i', b, '-filter_complex', 'psnr', '-f', 'null', '-']);
  const m = /average:([0-9.]+|inf)/.exec(err)?.[1];
  return m === 'inf' ? 99 : Number(m);
}

export async function renderV4(opts: {skip?: ('outro' | 'full' | 'speech')[]} = {}): Promise<{pass: boolean; report: Record<string, unknown>}> {
  const cfg = loadPipelineConfig();
  ensureDir(V4_DIR);
  const shotDir = path.join(V4_DIR, 'screenshots');
  ensureDir(shotDir);
  const checks: QcCheck[] = [];
  const sections: Record<string, unknown> = {};

  // ---------- A: V4 outro (dictionary) ----------
  const plan = buildV4OutroPlan();
  writeJson(path.join(V4_DIR, 'plan-outro-v4.json'), plan);
  if (!opts.skip?.includes('outro') || !fs.existsSync(V4_FILES.outro)) await renderPlan(plan, cfg, V4_FILES.outro);
  const qcA = await qualityCheck(V4_FILES.outro, plan, {cfg, audioDramaturgy: true, repetition: true});
  checks.push(...qcA.checks.map((c) => ({...c, name: `[A outro] ${c.name}`})));
  if (fs.existsSync(V4_FILES.outro.replace(/\.mp4$/, '.shots.png'))) fs.copyFileSync(V4_FILES.outro.replace(/\.mp4$/, '.shots.png'), path.join(V4_DIR, 'v4-shot-overview.png'));

  // V3 shot overview for the record (shows the repetitions V4 removes)
  const v3 = buildV3Plans(cfg).definition;
  const repV3 = await checkRepetition(v3, cfg, {contactSheet: path.join(V4_DIR, 'v3-shot-overview.png'), title: 'V3 – Shot-Übersicht (Wiederholungskontrolle)', name: 'v3-for-v4'});
  sections.v3Repetition = {pass: repV3.pass, violations: describeViolations(repV3)};
  checks.push(check('[A outro] Thorfinn on the drop', !!plan.outro.shots[0]?.tag?.startsWith('thorfinn') && Math.abs(plan.outro.shots[0].start - plan.outro.start) < 1e-3, plan.outro.shots[0]?.motif, 'thorfinn-* exactly at the drop'));
  const last3 = plan.outro.shots.slice(-3);
  checks.push(check('[A outro] calm manga ending kept (silhouette, field + tree, Thorfinn)', last3.map((s) => s.motif).join(',') === 'father-child-silhouette,field-rock-tree,adult-trees-final', last3.map((s) => s.motif), 'same 3 final motifs as V3'));
  const motifs = plan.outro.shots.map((s) => s.motif);
  checks.push(check('[A outro] every shot a different motif', new Set(motifs).size === motifs.length, `${new Set(motifs).size}/${motifs.length} distinct`, 'all distinct'));

  // dictionary timing + unchanged design (overlay-only renders, measured in pixels)
  const fps = plan.fps;
  const drop = plan.outro.start;
  const dict = plan.outro.dictionary!;
  const f = (t: number) => Math.round((drop + t) * fps);
  const ovDir = path.join(PATHS.cache, 'qc', 'v4-overlay');
  const times = {before: dict.fadeInAt - 0.04, mid: dict.fadeInAt + (dict.fadeInDur ?? 0.25) / 2, full: dict.fadeInAt + (dict.fadeInDur ?? 0.25) + 0.05, late: 5};
  await renderStills(plan, cfg, Object.entries(times).map(([k, t]) => ({frame: f(t), out: path.join(ovDir, `${k}.png`)})), {overlayOnly: true});
  const px = Object.fromEntries(Object.keys(times).map((k) => [k, brightPixels(path.join(ovDir, `${k}.png`))]));
  checks.push(
    check(
      '[A outro] definition fades in 0.30 s after the drop, fully visible after 0.55 s',
      px.before === 0 && px.mid > 0 && Math.abs(px.full - px.late) / Math.max(1, px.late) < 0.02,
      {fadeInAt: dict.fadeInAt, fadeInDur: dict.fadeInDur, pixels: px},
      'no text before 0.30 s, full text from 0.55 s',
    ),
  );
  // unchanged text design: compare with V3 at the same outro time (both fully visible)
  const v3Overlay = path.join(ovDir, 'v3-late.png');
  await renderStills(v3, cfg, [{frame: Math.round((v3.outro.start + 5) * fps), out: v3Overlay}], {overlayOnly: true});
  const designPsnr = await psnr(v3Overlay, path.join(ovDir, 'late.png'));
  checks.push(check('[A outro] text design identical to V3 (pixel comparison of the card)', designPsnr >= 45, `PSNR ${designPsnr} dB`, '≥ 45 dB (identical)'));

  // screenshots of the new definition timing
  await renderStills(
    plan,
    cfg,
    [0.0, 0.3, 0.42, 0.55, 2.0, 4.6, 7.6, 9.6].map((t) => ({frame: f(t), out: path.join(shotDir, `outro-v4_drop+${t.toFixed(2)}s.png`)})),
  );

  // ---------- B: full audio test with a real kindness story ----------
  const store = new CandidateStore();
  if (!opts.skip?.includes('full')) {
    const c = await ensureStoryTestInput(store);
    log.info('full audio test: story + continuous song + V4 outro');
    const r = await P.produce(store, c, {overrides: {variant: 'V4', outroOverlay: 'dictionary', storyAudioGain: undefined}, force: true, allowDuplicate: true});
    fs.copyFileSync(r.output, V4_FILES.fullAudio);
    for (const ext of ['.qc.json', '.audio-envelope.json', '.audio-envelope.png', '.shots.png']) {
      const src = r.output.replace(/\.mp4$/, ext);
      if (fs.existsSync(src)) fs.copyFileSync(src, V4_FILES.fullAudio.replace(/\.mp4$/, ext));
    }
    writeJson(path.join(V4_DIR, 'plan-full-audio-test.json'), r.plan);
    checks.push(...r.qc.checks.map((x) => ({...x, name: `[B full audio] ${x.name}`})));
    sections.fullAudio = {jobId: r.jobId, story: r.plan.story.duration, songInClip: r.plan.story.songInClip, storyAudioGain: r.plan.story.audioGain, buildUpStart: r.plan.music.envelope?.buildUpStart};
  }

  // ---------- B2: speech / ducking test (public-domain clip with speech) ----------
  if (!opts.skip?.includes('speech')) {
    const missing = await ensureSpeechTestInput(store);
    if (missing) {
      // external, rate-limited source: report clearly instead of aborting A/B/C
      log.warn(`speech test skipped: ${missing}`);
      checks.push(check('[B2 speech] public-domain speech test clip available', false, missing, 'clip downloaded (Wikimedia)', 'warning'));
      sections.speech = {skipped: missing};
    } else {
      const sc = await P.importLocal(store, SPEECH_TEST_FILE, 'TEST (speech ducking): CDC public-domain classroom clip – not a kindness story');
      const st = new CandidateStore();
      const c2 = st.require(sc.id);
      const r2 = await P.produce(st, c2, {overrides: {variant: 'V4', outroOverlay: 'dictionary', highlightTime: 16}, force: true, allowDuplicate: true});
      fs.copyFileSync(r2.output, V4_FILES.speech);
      for (const ext of ['.qc.json', '.audio-envelope.json', '.audio-envelope.png']) {
        const src = r2.output.replace(/\.mp4$/, ext);
        if (fs.existsSync(src)) fs.copyFileSync(src, V4_FILES.speech.replace(/\.mp4$/, ext));
      }
      writeJson(path.join(V4_DIR, 'plan-speech-test.json'), r2.plan);
      checks.push(...r2.qc.checks.map((x) => ({...x, name: `[B2 speech] ${x.name}`})));
      sections.speech = {jobId: r2.jobId, speechSegments: r2.plan.story.speech, ducked: r2.plan.music.envelope?.ducked};
    }
  }

  // ---------- C: V3 vs V4 side by side ----------
  if (!fs.existsSync(V3_FILES.definition)) throw new Error('V3 definition render missing – run `npm run kai -- outro:v3` first');
  await runFfmpeg([
    '-y', '-i', V3_FILES.definition, '-i', V4_FILES.outro,
    '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]', '-map', '[v]', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', V4_FILES.comparison,
  ]);
  const i3 = mediaInfo(V3_FILES.definition);
  const i4 = mediaInfo(V4_FILES.outro);
  const ic = mediaInfo(V4_FILES.comparison);
  checks.push(check('[C comparison] V3 left / V4 right, same length, 2160x1920', ic.width === 2160 && ic.height === 1920 && Math.abs(i3.durationSec - i4.durationSec) < 0.05, `${ic.width}x${ic.height}, V3 ${i3.durationSec}s / V4 ${i4.durationSec}s`, 'equal durations'));

  // contact sheets
  for (const [name, file] of [['outro-v4', V4_FILES.outro], ['full-audio-test', V4_FILES.fullAudio]] as const) {
    if (!fs.existsSync(file)) continue;
    await runFfmpeg(['-y', '-i', file, '-vf', 'fps=2,scale=200:-2,tile=10x6', '-frames:v', '1', path.join(shotDir, `${name}_contact-sheet.jpg`)]);
  }
  for (const png of fs.readdirSync(shotDir).filter((x) => x.endsWith('.png'))) {
    await runFfmpeg(['-y', '-i', path.join(shotDir, png), '-q:v', '3', path.join(shotDir, png.replace(/\.png$/, '.jpg'))]);
    fs.rmSync(path.join(shotDir, png));
  }

  const pass = checks.every((c) => c.pass || c.severity === 'warning');
  const report = {
    createdAt: new Date().toISOString(),
    pass,
    approved: false,
    note: 'V4 is not approved automatically – review the videos, then run: npm run kai -- outro:approve V4 --overlay dictionary',
    files: Object.fromEntries(Object.entries(V4_FILES).filter(([, v]) => fs.existsSync(v)).map(([k, v]) => [k, {path: rel(v), sizeBytes: fs.statSync(v).size}])),
    shotListV4: plan.outro.shots.map((s) => ({act: s.act, motif: s.motif, source: s.sourceId, srcIn: s.srcIn, duration: Number(s.duration.toFixed(3)), speed: s.speed ?? 1})),
    ...sections,
    checks,
  };
  writeJson(path.join(V4_DIR, 'qc-report.json'), report);
  fs.writeFileSync(
    path.join(V4_DIR, 'QC_REPORT.md'),
    `# V4 – QC\n\nErgebnis: **${pass ? 'BESTANDEN' : 'NICHT BESTANDEN'}** (${checks.filter((c) => c.pass).length}/${checks.length}) · V4 ist **nicht** automatisch freigegeben.\n\n` +
      '| Prüfung | Ergebnis | Wert |\n|---|---|---|\n' +
      checks.map((c) => `| ${c.name} | ${c.pass ? '✅' : c.severity === 'warning' ? '⚠️' : '❌'} | \`${JSON.stringify(c.value).slice(0, 160).replace(/\|/g, '/')}\` |`).join('\n') +
      '\n',
  );
  return {pass, report};
}

/**
 * The TEST speech clip (CDC, public domain, 20 s from 2.2 s). Downloaded via the permitted
 * Wikimedia route if missing (fresh checkout). Returns null when ready, otherwise the reason.
 */
export async function ensureSpeechTestInput(store: CandidateStore): Promise<string | null> {
  if (fs.existsSync(abs(SPEECH_TEST_FILE))) return null;
  let srcFile = abs(SPEECH_TEST_SRC);
  if (!fs.existsSync(srcFile)) {
    const src = store.require(SPEECH_TEST_CANDIDATE);
    src.media = {status: 'downloadable'};
    const ok = await P.acquire(store, loadPipelineConfig(), src);
    if (!ok || !src.media.local?.path) return `speech test clip unavailable: ${src.media.reason ?? src.lastError?.message ?? 'unknown reason'}`;
    srcFile = abs(src.media.local.path);
  }
  ensureDir(path.dirname(abs(SPEECH_TEST_FILE)));
  await runFfmpeg(['-y', '-ss', '2.2', '-i', srcFile, '-t', '20', '-c:v', 'libx264', '-crf', '17', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', abs(SPEECH_TEST_FILE)]);
  return null;
}

/**
 * The TEST story (story part of reference 4, TikTok frame cropped away). Re-created from
 * the committed reference if missing (fresh checkout), with the same ffmpeg parameters.
 */
async function ensureStoryTestInput(store: CandidateStore) {
  const file = abs('media/test-inputs/TEST-INPUT_ref04-story_dog-guides-blind-cat.mp4');
  if (!fs.existsSync(file)) {
    ensureDir(path.dirname(file));
    await runFfmpeg(['-y', '-i', abs('references/tiktok-edits/ref-04_dog-guides-blind-cat_dbl28pno.mp4'), '-t', '19.2', '-vf', 'crop=574:616:2:246,scale=574:616', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', file]);
  }
  const c = store.get(STORY_TEST_ID) ?? (await P.importLocal(store, rel(file), 'TEST: Dog guides blind cat across the path (story part of ref-04)'));
  return c;
}
