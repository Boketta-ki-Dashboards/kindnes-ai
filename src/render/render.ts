import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {PATHS, abs} from '../core/paths.js';
import {ensureDir, sha1} from '../core/fsutil.js';
import {logger} from '../core/logger.js';
import type {PipelineConfig} from '../core/config.js';
import type {EditPlan} from '../edit/plan-types.js';
import {detectLetterbox, makeProxy, runFfmpeg} from '../media/ffmpeg.js';

const log = logger('render');

const BROWSER_CANDIDATES = [
  process.env.KAI_BROWSER,
  '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
];

export function findBrowser(cfg: PipelineConfig): string | null {
  for (const c of [cfg.render.browserExecutable, ...BROWSER_CANDIDATES]) {
    if (c && fs.existsSync(c)) return c;
  }
  return null; // let Remotion download its own headless shell
}

const MIME: Record<string, string> = {'.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav'};

/** Minimal static file server with HTTP Range support, restricted to an allow-list of files. */
export async function startMediaServer(files: Map<string, string>): Promise<{base: string; close: () => Promise<void>}> {
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1));
    const file = files.get(key);
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = req.headers.range;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.writeHead(206, {'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`});
      if (req.method === 'HEAD') return void res.end();
      fs.createReadStream(file, {start, end}).pipe(res);
    } else {
      res.writeHead(200, {'Content-Type': type, 'Content-Length': size});
      if (req.method === 'HEAD') return void res.end();
      fs.createReadStream(file).pipe(res);
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const {port} = server.address() as AddressInfo;
  return {base: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(() => r()))};
}

let bundleCache: string | null = null;

async function getBundle(): Promise<string> {
  if (bundleCache && fs.existsSync(bundleCache)) return bundleCache;
  const {bundle} = await import('@remotion/bundler');
  log.info('bundling Remotion project');
  bundleCache = await bundle({entryPoint: PATHS.remotionEntry, onProgress: () => undefined});
  return bundleCache;
}

/**
 * Create H.264/CFR proxies for every video used by the plan; returns src -> proxy file.
 * For 'fit-blur' framing the blurred 9:16 background is pre-composited with FFmpeg
 * (boxblur is ~10x faster than a CSS blur in the headless browser); the plan is then
 * rewritten to show that proxy with 'cover' framing.
 */
export async function prepareMedia(plan: EditPlan): Promise<{files: Map<string, string>; plan: EditPlan}> {
  const map = new Map<string, string>();
  const out: EditPlan = JSON.parse(JSON.stringify(plan));
  const fitBlur = (src: string) => `${src}#fitblur`;
  const uses: {src: string; framing: string}[] = [
    ...(plan.story.segments.length ? [{src: plan.story.src, framing: plan.story.framing}] : []),
    ...plan.outro.shots.map((s) => ({src: s.src, framing: s.framing})),
  ];
  for (const u of uses) {
    const key = u.framing === 'fit-blur' ? fitBlur(u.src) : u.src;
    if (map.has(key)) continue;
    const input = abs(u.src);
    if (u.framing === 'fit-blur') {
      const proxy = path.join(PATHS.cache, 'proxies', `${sha1(input + ':fitblur:' + plan.width + 'x' + plan.height + ':' + plan.fps)}.mp4`);
      log.info(`fit-blur proxy ${u.src}`);
      await makeFitBlurProxy(input, proxy, plan.width, plan.height, plan.fps);
      map.set(key, proxy);
    } else {
      const proxy = path.join(PATHS.cache, 'proxies', `${sha1(input + ':' + plan.fps)}.mp4`);
      log.info(`proxy ${u.src}`);
      await makeProxy(input, proxy, plan.fps);
      map.set(key, proxy);
    }
  }
  if (out.story.framing === 'fit-blur' && out.story.segments.length) {
    out.story.src = fitBlur(out.story.src);
    out.story.framing = 'cover';
    out.story.focusX = 0.5;
  }
  for (const s of out.outro.shots) {
    if (s.framing === 'fit-blur') {
      s.src = fitBlur(s.src);
      s.framing = 'cover';
      s.focusX = 0.5;
    }
  }
  map.set(plan.music.src, abs(plan.music.src));
  return {files: map, plan: out};
}

/** 9:16 proxy: blurred, darkened full-bleed copy behind the whole (fitted) image. */
export async function makeFitBlurProxy(input: string, output: string, W: number, H: number, fps: number): Promise<string> {
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(input).mtimeMs) return output;
  ensureDir(path.dirname(output));
  const crop = detectLetterbox(input);
  const filter =
    `[0:v]${crop ? crop + ',' : ''}fps=${fps},split[a][b];` +
    `[a]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase:flags=bilinear,crop=${W / 4}:${H / 4},boxblur=12:3,eq=brightness=-0.10:saturation=1.15,scale=${W}:${H}:flags=bicubic[bg];` +
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`;
  await runFfmpeg(['-y', '-i', input, '-filter_complex', filter, '-map', '[v]', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-g', String(fps / 2), '-bf', '0', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output]);
  return output;
}

export interface RenderResult {
  output: string;
  rawOutput: string;
  seconds: number;
}

/** Render a plan to MP4 (H.264 + AAC, 1080x1920), then loudness-normalise the audio. */
/** Bundled OFL fonts (licence files: assets/fonts/google-sans/OFL.txt, assets/fonts/noto-sans/OFL.txt). */
export const FONT_FILES = {
  googleSans: path.join(PATHS.root, 'assets', 'fonts', 'google-sans', 'GoogleSans-latin.woff2'),
  notoIpa: path.join(PATHS.root, 'assets', 'fonts', 'noto-sans', 'NotoSans-ipa.woff2'),
};

interface Served {
  inputProps: Record<string, unknown>;
  close: () => Promise<void>;
}

/** Prepare proxies, start the media server and build the Remotion input props. */
async function serve(plan: EditPlan, cfg: PipelineConfig, extra: Record<string, unknown> = {}): Promise<Served> {
  const prepared = await prepareMedia(plan);
  const keyed = new Map<string, string>();
  const media: Record<string, string> = {};
  let i = 0;
  for (const [src, file] of prepared.files) {
    const key = `m${i++}${path.extname(file)}`;
    keyed.set(key, file);
    media[src] = key;
  }
  keyed.set('font-google-sans.woff2', FONT_FILES.googleSans);
  keyed.set('font-noto-ipa.woff2', FONT_FILES.notoIpa);
  const server = await startMediaServer(keyed);
  for (const k of Object.keys(media)) media[k] = server.base + media[k];
  const fonts = {
    googleSans: fs.existsSync(FONT_FILES.googleSans) ? server.base + 'font-google-sans.woff2' : undefined,
    notoIpa: fs.existsSync(FONT_FILES.notoIpa) ? server.base + 'font-noto-ipa.woff2' : undefined,
  };
  return {inputProps: {plan: prepared.plan, media, font: cfg.text.font, fonts, ...extra}, close: server.close};
}

/** Render single frames as PNG (screenshots / overlay-only safe-area measurement). */
export async function renderStills(plan: EditPlan, cfg: PipelineConfig, frames: {frame: number; out: string}[], extra: Record<string, unknown> = {}): Promise<void> {
  const s = await serve(plan, cfg, extra);
  try {
    const {renderStill, selectComposition} = await import('@remotion/renderer');
    const serveUrl = await getBundle();
    const browserExecutable = findBrowser(cfg);
    const composition = await selectComposition({serveUrl, id: 'KindnessEdit', inputProps: s.inputProps, browserExecutable, logLevel: 'error'});
    for (const f of frames) {
      ensureDir(path.dirname(f.out));
      await renderStill({composition, serveUrl, inputProps: s.inputProps, frame: f.frame, output: f.out, imageFormat: 'png', browserExecutable, logLevel: 'error'});
    }
  } finally {
    await s.close();
  }
}

export async function renderPlan(plan: EditPlan, cfg: PipelineConfig, outFile: string, onProgress?: (p: number) => void, extra: Record<string, unknown> = {}): Promise<RenderResult> {
  const t0 = Date.now();
  ensureDir(path.dirname(outFile));
  const served = await serve(plan, cfg, extra);
  const server = {close: served.close};
  try {
    const {renderMedia, selectComposition} = await import('@remotion/renderer');
    const serveUrl = await getBundle();
    const browserExecutable = findBrowser(cfg);
    const inputProps = served.inputProps;
    const composition = await selectComposition({serveUrl, id: 'KindnessEdit', inputProps, browserExecutable, logLevel: 'error'});
    const rawOutput = outFile.replace(/\.mp4$/, '.raw.mp4');
    let lastLogged = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: rawOutput,
      inputProps,
      browserExecutable,
      crf: cfg.video.crf,
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      audioBitrate: cfg.video.audioBitrate as `${number}k`,
      x264Preset: cfg.video.x264Preset,
      concurrency: cfg.render.concurrency ?? undefined,
      logLevel: 'error',
      chromiumOptions: {gl: 'swangle'},
      onProgress: ({progress}) => {
        onProgress?.(progress);
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== lastLogged) {
          lastLogged = pct;
          log.info(`render ${plan.jobId}: ${pct}%`);
        }
      },
    });
    const window = cfg.audio.normalizeOn === 'outro' && plan.outro.shots.length ? {from: plan.outro.start, to: Math.max(plan.outro.start + 1, plan.durationSec - plan.outro.fadeOutSec)} : {};
    await loudnessNormalize(rawOutput, outFile, cfg.audio.targetLufs, window);
    return {output: outFile, rawOutput, seconds: (Date.now() - t0) / 1000};
  } finally {
    await server.close();
  }
}

/** Two-pass EBU R128 loudness normalisation of the audio track (video stream copied untouched). */
/** Integrated loudness (LUFS) of a time window of a file. */
export async function measureLoudness(input: string, from?: number, to?: number): Promise<{i: number; tp: number}> {
  const args = [];
  if (from !== undefined) args.push('-ss', from.toFixed(3));
  if (to !== undefined) args.push('-to', to.toFixed(3));
  const err = await runFfmpeg([...args, '-i', input, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
  const summary = err.slice(err.lastIndexOf('Summary:'));
  return {i: Number(/I:\s+(-?[0-9.]+) LUFS/.exec(summary)?.[1]), tp: Number(/Peak:\s+(-?[0-9.]+) dBFS/.exec(summary)?.[1])};
}

/**
 * Loudness normalisation with ONE static gain for the whole video, so the intended
 * dynamics (quiet story, build-up, loud outro) survive unchanged. The gain is derived
 * from the measured window (default: the outro, from the drop to the start of the final
 * fade) so the outro keeps its previous level; a peak limiter (no auto-level) only
 * catches peaks above -1.5 dBFS.
 */
export async function loudnessNormalize(input: string, output: string, targetLufs: number, window: {from?: number; to?: number} = {}): Promise<{measuredLufs: number; gainDb: number}> {
  const m = await measureLoudness(input, window.from, window.to);
  const gainDb = Number.isFinite(m.i) ? Math.max(-30, Math.min(30, targetLufs - m.i)) : 0;
  const filter = `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.84:attack=5:release=50:level=0,aresample=48000`;
  await runFfmpeg(['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', filter, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output]);
  log.info(`loudness: measured ${m.i} LUFS on ${window.from !== undefined ? `${window.from.toFixed(2)}–${window.to?.toFixed(2)} s` : 'whole file'}, static gain ${gainDb.toFixed(2)} dB`);
  return {measuredLufs: m.i, gainDb};
}

/**
 * Render one audio stem (WAV) of a plan: 'music' = song only (clip muted),
 * 'story' = clip audio only. Used by the QC to measure the mix objectively.
 */
export async function renderAudioStem(plan: EditPlan, cfg: PipelineConfig, stem: 'music' | 'story', outFile: string): Promise<string> {
  ensureDir(path.dirname(outFile));
  const served = await serve(plan, cfg, {stem});
  try {
    const {renderMedia, selectComposition} = await import('@remotion/renderer');
    const serveUrl = await getBundle();
    const browserExecutable = findBrowser(cfg);
    const composition = await selectComposition({serveUrl, id: 'KindnessEdit', inputProps: served.inputProps, browserExecutable, logLevel: 'error'});
    await renderMedia({composition, serveUrl, codec: 'wav', outputLocation: outFile, inputProps: served.inputProps, browserExecutable, logLevel: 'error'});
    return outFile;
  } finally {
    await served.close();
  }
}
