import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {MediaInfo} from '../core/types.js';
import {ensureDir} from '../core/fsutil.js';

export interface ProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  side_data_list?: {rotation?: number}[];
}
export interface ProbeResult {
  streams: ProbeStream[];
  format: {duration?: string; size?: string; bit_rate?: string; format_name?: string};
}

export function toolAvailable(cmd: string): boolean {
  const r = spawnSync(cmd, ['-version'], {encoding: 'utf8'});
  return r.status === 0;
}

export function ffprobe(file: string): ProbeResult {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr?.slice(0, 400)}`);
  return JSON.parse(r.stdout) as ProbeResult;
}

function parseRate(rate?: string): number {
  if (!rate) return 0;
  const [n, d] = rate.split('/').map(Number);
  return d ? n / d : n;
}

export function mediaInfo(file: string): MediaInfo {
  const p = ffprobe(file);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  let width = v?.width ?? 0;
  let height = v?.height ?? 0;
  const rot = v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0;
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [width, height] = [height, width];
  return {
    path: file,
    durationSec: Number(p.format.duration ?? v?.duration ?? 0),
    width,
    height,
    fps: parseRate(v?.avg_frame_rate) || parseRate(v?.r_frame_rate),
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name ?? null,
    sizeBytes: Number(p.format.size ?? 0),
  };
}

/** Run ffmpeg; resolves with stderr text, rejects on non-zero exit. */
export function runFfmpeg(args: string[], opts: {timeoutMs?: number} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-nostdin', '-hide_banner', ...args], {stdio: ['ignore', 'ignore', 'pipe']});
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 2_000_000) err = err.slice(-1_000_000);
    });
    const timer = opts.timeoutMs ? setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs) : null;
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg exited with ${code}: ${err.slice(-800)}`));
    });
  });
}

/**
 * Normalise any input into an editing proxy: H.264, constant frame rate, short
 * GOP (frame-accurate seeking in Remotion), AAC stereo 48 kHz. Keeps the native
 * resolution (capped at 1920 on the long side), so no quality is lost before the
 * final render. Cached by output path.
 */
/**
 * Detect constant black bars (letterbox / pillarbox) with ffmpeg's cropdetect over
 * ~40 frames spread across the clip. Returns an ffmpeg crop expression, or null if the
 * picture is (almost) full-frame or the result is not consistent (e.g. dark scenes).
 */
export function detectLetterbox(input: string): string | null {
  const info = mediaInfo(input);
  if (!info.durationSec || !info.width) return null;
  const every = Math.max(1, Math.round((info.durationSec * (info.fps || 30)) / 40));
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'info', '-i', input, '-an', '-vf', `select='not(mod(n\\,${every}))',cropdetect=limit=24:round=2:reset=1`, '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const crops = [...(r.stderr ?? '').matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => m.slice(1).map(Number));
  if (crops.length < 5) return null;
  const counts = new Map<string, number>();
  for (const c of crops) counts.set(c.join(':'), (counts.get(c.join(':')) ?? 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [w, h, x, y] = best.split(':').map(Number);
  // cropdetect works on the coded size; ignore rotation edge cases
  const area = (w * h) / (info.width * info.height);
  if (n / crops.length < 0.6 || area > 0.94 || area < 0.3 || w < 64 || h < 64) return null;
  return `crop=${w}:${h}:${x}:${y}`;
}

export async function makeProxy(input: string, output: string, fps: number, force = false): Promise<string> {
  if (!force && fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(input).mtimeMs) return output;
  ensureDir(path.dirname(output));
  const info = mediaInfo(input);
  const crop = detectLetterbox(input);
  const longSide = Math.max(info.width, info.height);
  const scale =
    longSide > 1920
      ? info.width >= info.height
        ? 'scale=1920:-2:flags=lanczos'
        : 'scale=-2:1920:flags=lanczos'
      : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const args = ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `${crop ? crop + ',' : ''}${scale},fps=${fps},format=yuv420p`];
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-g', String(fps / 2), '-bf', '0');
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output);
  await runFfmpeg(args);
  return output;
}

/** Perceptual difference hash over 8 evenly spaced frames – used for duplicate detection. */
export function videoDHash(file: string, durationSec: number): string {
  const frames = 8;
  const hashes: string[] = [];
  for (let i = 0; i < frames; i++) {
    const t = ((i + 0.5) / frames) * durationSec;
    const r = spawnSync(
      'ffmpeg',
      ['-nostdin', '-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'],
      {maxBuffer: 1024 * 1024},
    );
    const buf = r.stdout as Buffer;
    if (!buf || buf.length < 72) {
      hashes.push('0000000000000000');
      continue;
    }
    let bits = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (buf[y * 9 + x] > buf[y * 9 + x + 1] ? 1n : 0n);
    hashes.push(bits.toString(16).padStart(16, '0'));
  }
  return hashes.join('');
}

/** Hamming distance between two dHash strings (lower = more similar). */
export function dHashDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i += 16) {
    let x = BigInt('0x' + a.slice(i, i + 16)) ^ BigInt('0x' + b.slice(i, i + 16));
    while (x) {
      d += Number(x & 1n);
      x >>= 1n;
    }
  }
  return d;
}

export async function extractFrame(input: string, t: number, output: string, width = 360): Promise<void> {
  ensureDir(path.dirname(output));
  await runFfmpeg(['-y', '-ss', t.toFixed(3), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', output]);
}

export async function contactSheet(input: string, output: string, cols = 6, rows = 5, height = 240): Promise<void> {
  const info = mediaInfo(input);
  const n = cols * rows;
  const fps = n / Math.max(info.durationSec, 0.1);
  ensureDir(path.dirname(output));
  await runFfmpeg([
    '-y',
    '-i',
    input,
    '-vf',
    `fps=${fps},scale=-2:${height},drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='%{pts\\:hms}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=${cols}x${rows}`,
    '-frames:v',
    '1',
    output,
  ]);
}
