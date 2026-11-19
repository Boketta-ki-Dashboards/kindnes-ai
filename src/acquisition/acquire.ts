import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PATHS} from '../core/paths.js';
import {ensureDir, sha256File} from '../core/fsutil.js';
import {logger} from '../core/logger.js';
import type {PipelineConfig} from '../core/config.js';
import type {Candidate, MediaInfo} from '../core/types.js';
import {fetchJson} from '../discovery/adapters/types.js';
import {mediaInfo, videoDHash} from '../media/ffmpeg.js';

const log = logger('acquire');
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

export interface AcquireResult {
  ok: boolean;
  media?: MediaInfo;
  method?: 'inbox' | 'already-local' | 'archive_org' | 'wikimedia' | 'yt-dlp';
  reason?: string;
}

/** Look for a user-provided file: media/inbox/<candidateId>.* or a file containing the platform id. */
export function findInInbox(c: Candidate, inbox = PATHS.inbox): string | null {
  if (!fs.existsSync(inbox)) return null;
  const files = fs.readdirSync(inbox).filter((f) => VIDEO_EXT.test(f));
  const hit = files.find((f) => f.replace(VIDEO_EXT, '') === c.id) ?? files.find((f) => c.platformId.length >= 6 && f.includes(c.platformId));
  return hit ? path.join(inbox, hit) : null;
}

async function download(url: string, dest: string, maxMb: number): Promise<void> {
  const res = await fetch(url, {headers: {'User-Agent': 'kindness-ai-research/0.1 (personal research tool)'}});
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxMb * 1024 * 1024) throw new Error(`file too large (${(len / 1e6).toFixed(0)} MB > ${maxMb} MB)`);
  ensureDir(path.dirname(dest));
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    got += value.length;
    if (got > maxMb * 1024 * 1024) {
      out.destroy();
      fs.rmSync(tmp, {force: true});
      throw new Error(`download exceeded ${maxMb} MB`);
    }
    out.write(value);
  }
  await new Promise<void>((r) => out.end(r));
  fs.renameSync(tmp, dest);
}

/**
 * Original file first, then Wikimedia's standard transcodes (the sizes Wikimedia asks
 * automated clients to use when originals are rate-limited).
 */
export function wikimediaVideoUrls(mediaUrl: string): string[] {
  const u = new URL(mediaUrl);
  const m = u.pathname.match(/^\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+\.(?:webm|ogv))$/i);
  const original = `${u.origin}${u.pathname}`;
  if (!m) return [original];
  const [, a, ab, name] = m;
  return [original, ...['720p', '480p'].map((q) => `${u.origin}/wikipedia/commons/transcoded/${a}/${ab}/${name}/${name}.${q}.vp9.webm`)];
}

/** archive.org: pick the best MP4 derivative of a free-licensed item. */
async function archiveMediaUrl(identifier: string): Promise<string | null> {
  const meta = await fetchJson<{files?: {name: string; format?: string; size?: string; height?: string}[]}>(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const mp4 = (meta.files ?? []).filter((f) => /\.mp4$/i.test(f.name)).sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0) || Number(b.size ?? 0) - Number(a.size ?? 0));
  return mp4[0] ? `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(mp4[0].name)}` : null;
}

function ytDlpDownload(url: string, destBase: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-f', 'bv*[height<=1920]+ba/b', '--merge-output-format', 'mp4', '-o', `${destBase}.%(ext)s`, '--no-playlist', url];
    const p = spawn(process.env.KAI_YTDLP ?? 'yt-dlp', args, {stdio: ['ignore', 'ignore', 'pipe']});
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => (code === 0 ? resolve(`${destBase}.mp4`) : reject(new Error(err.trim().split('\n').slice(-2).join(' | ')))));
  });
}

export function describeMedia(file: string): MediaInfo {
  const info = mediaInfo(file);
  return {...info, sha256: sha256File(file), dHash: videoDHash(file, info.durationSec)};
}

/**
 * Get a processable media file for a candidate – only through allowed routes:
 * 1. a file the user placed in media/inbox/ (or an already imported local file),
 * 2. a direct download for free-licensed sources (archive.org with CC/PD license, Wikimedia Commons),
 * 3. yt-dlp ONLY if explicitly enabled in config and (by default) only for Creative-Commons videos.
 * Platform protections (logins, rate limits, bot checks) are never bypassed.
 */
export async function acquireMedia(c: Candidate, cfg: PipelineConfig): Promise<AcquireResult> {
  if (c.media.local?.path && fs.existsSync(c.media.local.path)) return {ok: true, media: c.media.local, method: 'already-local'};
  const inbox = findInInbox(c);
  if (inbox) {
    log.info(`using inbox file ${path.basename(inbox)}`, {candidateId: c.id});
    return {ok: true, media: describeMedia(inbox), method: 'inbox'};
  }
  const dest = path.join(PATHS.downloads, `${c.id}.mp4`);
  if (cfg.acquisition.allowLicensedDownloads) {
    if (c.platform === 'archive_org' && c.license && /creativecommons|publicdomain/i.test(c.license)) {
      const url = await archiveMediaUrl(c.platformId);
      if (!url) return {ok: false, reason: 'archive.org item has no MP4 file'};
      await download(url, dest, cfg.acquisition.maxDownloadMb);
      return {ok: true, media: describeMedia(dest), method: 'archive_org'};
    }
    if (c.platform === 'wikimedia' && c.mediaUrl) {
      // Wikimedia rate-limits original files for automated clients (HTTP 429) and asks them
      // to use its standard transcoded sizes instead – fall back to those, never hammer.
      const errors: string[] = [];
      for (const url of wikimediaVideoUrls(c.mediaUrl)) {
        const ext = path.extname(new URL(url).pathname) || '.webm';
        const file = dest.replace(/\.mp4$/, ext);
        try {
          await download(url, file, cfg.acquisition.maxDownloadMb);
          return {ok: true, media: describeMedia(file), method: 'wikimedia'};
        } catch (e) {
          errors.push(`${url.includes('/transcoded/') ? path.basename(new URL(url).pathname).split('.').slice(-3, -1).join('.') : 'original'}: ${(e as Error).message}`);
          if (!/HTTP (429|403|404)/.test((e as Error).message)) break; // only fall back on rate limit / missing size
        }
      }
      return {ok: false, reason: `Wikimedia download failed (${errors.join('; ')})`};
    }
  }
  if (cfg.acquisition.ytDlp.enabled && (c.platform === 'youtube' || c.platform === 'dailymotion')) {
    if (cfg.acquisition.ytDlp.requireCreativeCommons && !(c.license ?? '').toLowerCase().includes('cc')) {
      return {ok: false, reason: 'yt-dlp is enabled only for Creative-Commons videos (acquisition.ytDlp.requireCreativeCommons)'};
    }
    try {
      const file = await ytDlpDownload(c.url, dest.replace(/\.mp4$/, ''));
      return {ok: true, media: describeMedia(file), method: 'yt-dlp'};
    } catch (e) {
      return {ok: false, reason: `yt-dlp failed: ${(e as Error).message}`};
    }
  }
  return {
    ok: false,
    reason: `No permitted automatic download for ${c.platform}. Place the video as media/inbox/${c.id}.mp4 (only with permission) and run "npm run kai -- acquire ${c.id}".`,
  };
}
