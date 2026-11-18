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
export async function renderPlan(plan: EditPlan, cfg: PipelineConfig, outFile: string, onProgress?: (p: number) => void): Promise<RenderResult> {
  const t0 = Date.now();
  ensureDir(path.dirname(outFile));
  const prepared = await prepareMedia(plan);
  const files = prepared.files;
  const renderedPlan = prepared.plan;
  const keyed = new Map<string, string>();
  const media: Record<string, string> = {};
  let i = 0;
  for (const [src, file] of files) {
    const key = `m${i++}${path.extname(file)}`;
    keyed.set(key, file);
    media[src] = key; // base URL filled in below
  }
  const server = await startMediaServer(keyed);
  try {
    for (const k of Object.keys(media)) media[k] = server.base + media[k];
    const {renderMedia, selectComposition} = await import('@remotion/renderer');
    const serveUrl = await getBundle();
    const browserExecutable = findBrowser(cfg);
    const inputProps = {plan: renderedPlan, media, font: cfg.text.font};
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
    await loudnessNormalize(rawOutput, outFile, cfg.audio.targetLufs);
    return {output: outFile, rawOutput, seconds: (Date.now() - t0) / 1000};
  } finally {
    await server.close();
  }
}

/** Two-pass EBU R128 loudness normalisation of the audio track (video stream copied untouched). */
export async function loudnessNormalize(input: string, output: string, targetLufs: number): Promise<void> {
  const tp = -1.5;
  const lra = 11;
  const first = await runFfmpeg(['-i', input, '-vn', '-af', `loudnorm=I=${targetLufs}:TP=${tp}:LRA=${lra}:print_format=json`, '-f', 'null', '-']);
  const json = first.slice(first.lastIndexOf('{'), first.lastIndexOf('}') + 1);
  const m = JSON.parse(json) as Record<string, string>;
  const filter =
    `loudnorm=I=${targetLufs}:TP=${tp}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
    `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
  await runFfmpeg(['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', `${filter},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output]);
}
