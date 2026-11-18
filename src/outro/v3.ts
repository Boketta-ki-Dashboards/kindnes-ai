/**
 * Outro V3: one curated Thorfinn cut rendered twice – A1 "clean" (white "kindness.")
 * and A2 "definition" (dictionary card) – plus a side-by-side comparison and a QC report.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PATHS, rel} from '../core/paths.js';
import {ensureDir, writeJson} from '../core/fsutil.js';
import {logger} from '../core/logger.js';
import {loadAssetsConfig, loadMusicConfig, loadPipelineConfig, type PipelineConfig} from '../core/config.js';
import {loadBeatMap, nearestBeat} from '../music/beatmap.js';
import type {EditPlan} from '../edit/plan-types.js';
import {SAFE_AREA} from '../edit/plan-types.js';
import {buildOutroPreviewPlan} from './preview.js';
import {renderPlan, renderStills} from '../render/render.js';
import {qualityCheck, type QcCheck} from '../render/qc.js';
import {runFfmpeg, mediaInfo} from '../media/ffmpeg.js';
import {DICTIONARY, dictionaryLines, highlightedText, linesToText} from './dictionary-text.js';

const log = logger('outro-v3');

export const V3_DIR = path.join(PATHS.output, 'kindness-outro-v3');
export const V3_FILES = {
  clean: path.join(V3_DIR, 'kindness-outro-v3-clean.mp4'),
  definition: path.join(V3_DIR, 'kindness-outro-v3-definition.mp4'),
  comparison: path.join(V3_DIR, 'kindness-outro-v3-comparison.mp4'),
};

export function buildV3Plans(cfg: PipelineConfig = loadPipelineConfig()): {clean: EditPlan; definition: EditPlan} {
  const music = loadMusicConfig();
  const assets = loadAssetsConfig();
  const beatmap = loadBeatMap(music);
  const base = {variantId: 'V3', config: cfg, music, beatmap, assets};
  return {
    clean: buildOutroPreviewPlan({...base, overlay: 'caption', jobId: 'kindness-outro-v3-clean'}),
    definition: buildOutroPreviewPlan({...base, overlay: 'dictionary', jobId: 'kindness-outro-v3-definition'}),
  };
}

const check = (name: string, pass: boolean, value: unknown, expected: string, severity: 'error' | 'warning' = 'error'): QcCheck => ({name, pass, value, expected, severity});

/** Bounding box of bright pixels in a PNG (overlay-only render on black). */
function brightBBox(png: string): {x0: number; y0: number; x1: number; y1: number} | null {
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {maxBuffer: 64 * 1024 * 1024});
  const buf = r.stdout as Buffer;
  const W = 1080;
  const H = Math.floor(buf.length / W);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (buf[y * W + x] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : {x0, y0, x1, y1};
}

/** Mean/min PSNR of the picture area both versions must share (above every text/dim layer). */
async function sharedPicturePsnr(a: string, b: string, height: number): Promise<{avg: number; min: number}> {
  const err = await runFfmpeg(['-i', a, '-i', b, '-filter_complex', `[0:v]crop=1080:${height}:0:0[x];[1:v]crop=1080:${height}:0:0[y];[x][y]psnr=stats_file=-`, '-f', 'null', '-']);
  const avg = Number(/average:([0-9.]+|inf)/.exec(err)?.[1] === 'inf' ? 99 : /average:([0-9.]+)/.exec(err)?.[1]);
  const min = Number(/min:([0-9.]+|inf)/.exec(err)?.[1] === 'inf' ? 99 : /min:([0-9.]+)/.exec(err)?.[1]);
  return {avg, min};
}

export async function renderOutroV3(opts: {skipRender?: boolean} = {}): Promise<{report: Record<string, unknown>; pass: boolean}> {
  const cfg = loadPipelineConfig();
  const {clean, definition} = buildV3Plans(cfg);
  ensureDir(V3_DIR);
  writeJson(path.join(V3_DIR, 'plan-clean.json'), clean);
  writeJson(path.join(V3_DIR, 'plan-definition.json'), definition);
  for (const w of [...clean.warnings, ...definition.warnings]) log.warn(w);

  if (!opts.skipRender || !fs.existsSync(V3_FILES.clean)) {
    log.info('rendering A1 clean');
    await renderPlan(clean, cfg, V3_FILES.clean);
  }
  if (!opts.skipRender || !fs.existsSync(V3_FILES.definition)) {
    log.info('rendering A2 definition');
    await renderPlan(definition, cfg, V3_FILES.definition);
  }
  log.info('building side-by-side comparison');
  await runFfmpeg([
    '-y', '-i', V3_FILES.clean, '-i', V3_FILES.definition,
    '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]', '-map', '[v]', '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', V3_FILES.comparison,
  ]);

  const qcClean = await qualityCheck(V3_FILES.clean, clean);
  const qcDef = await qualityCheck(V3_FILES.definition, definition);
  const checks: QcCheck[] = [];
  const fps = clean.fps;
  const drop = clean.outro.start;
  const shots = clean.outro.shots;

  // picture / dramaturgy (based on the curated shot list – chosen from viewed frames)
  checks.push(check('Thorfinn on the drop (first shot = Thorfinn close-up, starts exactly at the drop)', !!shots[0]?.tag?.startsWith('thorfinn') && Math.abs(shots[0].start - drop) < 1 / fps, `${shots[0]?.tag} @ ${shots[0]?.start}s (drop ${drop}s)`, 'thorfinn-* at the drop'));
  const firstBeats = shots.filter((s) => s.start < drop + 6 * 0.4296);
  checks.push(check('first 6 beats show only Thorfinn', firstBeats.every((s) => s.tag?.startsWith('thorfinn')), firstBeats.map((s) => s.tag), 'all thorfinn-*'));
  const landscape = shots.filter((s) => !s.tag?.startsWith('thorfinn'));
  checks.push(check('no long empty landscape shots', landscape.every((s) => s.duration <= 1.0) && landscape.length <= 2, landscape.map((s) => `${s.tag} ${s.duration.toFixed(2)}s`), '≤ 2 non-Thorfinn shots, each ≤ 1.0 s'));
  const last3 = shots.slice(-3);
  checks.push(check('emotional, calm ending (last 3 shots in act "calm")', last3.every((s) => s.act === 'calm'), last3.map((s) => `${s.act}:${s.tag}`), 'calm'));
  checks.push(check('final shot is Thorfinn', !!shots.at(-1)?.tag?.startsWith('thorfinn'), shots.at(-1)?.tag, 'thorfinn-*'));
  const bm = loadBeatMap(loadMusicConfig());
  const offBeat = shots.slice(1).map((s) => {
    const songT = clean.music.songStart + s.start;
    return Number((nearestBeat(bm.beats, songT) - songT).toFixed(3));
  });
  checks.push(check('every cut sits 2 frames before a beat', offBeat.every((d) => Math.abs(d - cfg.outro.cutLeadFrames / fps) < 0.01), offBeat, `${(cfg.outro.cutLeadFrames / fps).toFixed(3)} s`));
  checks.push(check('drop stays at song time 48.216 s', Math.abs(clean.music.drop - 48.216) < 1e-6 && Math.abs(definition.music.drop - 48.216) < 1e-6, clean.music.drop, '48.216'));

  // identical picture in both versions
  checks.push(check('both versions use the identical cut (plan)', JSON.stringify(clean.outro.shots) === JSON.stringify(definition.outro.shots) && clean.music.songStart === definition.music.songStart, `${shots.length} shots`, 'deep-equal shot lists'));
  const ic = mediaInfo(V3_FILES.clean);
  const id = mediaInfo(V3_FILES.definition);
  const cmp = mediaInfo(V3_FILES.comparison);
  checks.push(check('identical duration of both versions', Math.abs(ic.durationSec - id.durationSec) < 1 / fps, `${ic.durationSec} / ${id.durationSec}`, 'equal'));
  const psnr = await sharedPicturePsnr(V3_FILES.clean, V3_FILES.definition, 700);
  checks.push(check('identical frames in the shared picture area (top 700 px, above all text)', psnr.avg >= 40 && psnr.min >= 35, psnr, 'PSNR avg ≥ 40 dB, min ≥ 35 dB'));
  checks.push(check('comparison is 2160x1920 side by side', cmp.width === 2160 && cmp.height === 1920 && Math.abs(cmp.durationSec - ic.durationSec) < 0.1, `${cmp.width}x${cmp.height} ${cmp.durationSec}s`, '2160x1920, same duration'));

  // text checks
  const lines = dictionaryLines(cfg.text.dictionary.highlightIncludesPeriod);
  checks.push(check('definition text word-for-word', linesToText(lines) === DICTIONARY.text, linesToText(lines).length, 'exact match'));
  const hl = highlightedText(lines);
  checks.push(check('blue highlight = "the quality … rewards" only', hl === DICTIONARY.highlight + (cfg.text.dictionary.highlightIncludesPeriod ? '.' : ''), hl, DICTIONARY.highlight));
  checks.push(check('"Kindness is" not highlighted, highlight ends after "rewards"', lines[0][0].text === 'Kindness is ' && !lines[0][0].highlight && lines[2][1].text.startsWith(cfg.text.dictionary.highlightIncludesPeriod ? ' It' : '. It'), lines[2].map((s) => `${s.highlight ? '[HL]' : ''}${s.text}`), 'Kindness is | [HL] … rewards | . It reduces'));
  checks.push(check('no double text (clean: caption only, definition: card only)', clean.outro.overlay === 'none' && clean.texts.length === 1 && definition.outro.overlay === 'dictionary' && definition.texts.length === 0, {clean: clean.texts.map((t) => t.text), definition: definition.texts.map((t) => t.text)}, 'one text treatment each'));
  checks.push(check('definition only appears after the drop', (definition.outro.dictionary?.fadeInAt ?? -1) > 0, `${definition.outro.dictionary?.fadeInAt}s after the drop`, '> 0'));

  // safe areas: overlay-only stills measured in pixels
  const shotDir = path.join(V3_DIR, 'screenshots');
  ensureDir(shotDir);
  const midFrame = Math.round((drop + 5) * fps);
  const ovDef = path.join(PATHS.cache, 'qc', 'v3-overlay-definition.png');
  const ovClean = path.join(PATHS.cache, 'qc', 'v3-overlay-clean.png');
  await renderStills(definition, cfg, [{frame: midFrame, out: ovDef}], {overlayOnly: true});
  await renderStills(clean, cfg, [{frame: midFrame, out: ovClean}], {overlayOnly: true});
  for (const [name, png] of [['definition', ovDef], ['clean', ovClean]] as const) {
    const bb = brightBBox(png);
    const ok = !!bb && bb.x0 >= SAFE_AREA.left && bb.x1 <= 1080 - SAFE_AREA.right && bb.y0 >= SAFE_AREA.top && bb.y1 <= 1920 - SAFE_AREA.bottom;
    checks.push(check(`text inside TikTok safe area (${name})`, ok, bb, `x ${SAFE_AREA.left}–${1080 - SAFE_AREA.right}, y ${SAFE_AREA.top}–${1920 - SAFE_AREA.bottom}`));
  }

  // screenshots of the definition version (and clean for reference)
  const times = [0.1, 1.2, 2.4, 3.8, 5.2, 6.6, 8.0, 9.4];
  const frames = times.map((t) => ({frame: Math.round((drop + t) * fps), out: path.join(shotDir, `definition_drop+${t.toFixed(1)}s.png`)}));
  await renderStills(definition, cfg, frames);
  await renderStills(clean, cfg, [2.4, 8.0].map((t) => ({frame: Math.round((drop + t) * fps), out: path.join(shotDir, `clean_drop+${t.toFixed(1)}s.png`)})));
  for (const f of fs.readdirSync(shotDir).filter((x) => x.endsWith('.png'))) {
    const png = path.join(shotDir, f);
    await runFfmpeg(['-y', '-i', png, '-q:v', '3', png.replace(/\.png$/, '.jpg')]);
    fs.rmSync(png);
  }
  await runFfmpeg(['-y', '-i', V3_FILES.definition, '-vf', `select='gte(t\\,${drop})',fps=2,scale=270:-2,tile=8x3`, '-frames:v', '1', path.join(shotDir, 'definition_contact-sheet.jpg')]);
  await runFfmpeg(['-y', '-i', V3_FILES.clean, '-vf', `select='gte(t\\,${drop})',fps=2,scale=270:-2,tile=8x3`, '-frames:v', '1', path.join(shotDir, 'clean_contact-sheet.jpg')]);

  const allChecks = [
    ...qcClean.checks.map((c) => ({...c, name: `[clean] ${c.name}`})),
    ...qcDef.checks.map((c) => ({...c, name: `[definition] ${c.name}`})),
    ...checks,
  ];
  const pass = allChecks.every((c) => c.pass || c.severity === 'warning');
  const report = {
    createdAt: new Date().toISOString(),
    pass,
    files: Object.fromEntries(Object.entries(V3_FILES).map(([k, v]) => [k, {path: rel(v), sizeBytes: fs.statSync(v).size}])),
    shotList: shots.map((s) => ({act: s.act, tag: s.tag, source: s.sourceId, srcIn: s.srcIn, startOnTimeline: s.start, duration: Number(s.duration.toFixed(3)), speed: s.speed ?? 1, effects: s.effects ?? []})),
    checks: allChecks,
  };
  writeJson(path.join(V3_DIR, 'qc-report.json'), report);
  fs.writeFileSync(
    path.join(V3_DIR, 'QC_REPORT.md'),
    `# Outro V3 – QC\n\nErgebnis: **${pass ? 'BESTANDEN' : 'NICHT BESTANDEN'}** (${allChecks.filter((c) => c.pass).length}/${allChecks.length})\n\n` +
      '| Prüfung | Ergebnis | Wert |\n|---|---|---|\n' +
      allChecks.map((c) => `| ${c.name} | ${c.pass ? '✅' : c.severity === 'warning' ? '⚠️' : '❌'} | \`${JSON.stringify(c.value).slice(0, 140).replace(/\|/g, '/')}\` |`).join('\n') +
      '\n',
  );
  return {report, pass};
}
