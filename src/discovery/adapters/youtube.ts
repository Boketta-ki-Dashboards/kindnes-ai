import {spawn} from 'node:child_process';
import type {SearchAdapter, SearchHit} from './types.js';
import {AdapterBlockedError} from './types.js';

interface YtFlatEntry {
  id: string;
  title?: string;
  description?: string | null;
  duration?: number | null;
  view_count?: number | null;
  channel?: string | null;
  uploader?: string | null;
  url?: string;
  thumbnails?: {url: string; height?: number; width?: number}[];
}

function runYtDlp(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.KAI_YTDLP ?? 'yt-dlp', args, {stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(-2).join(' | ') || `yt-dlp exited ${code}`));
    });
  });
}

/**
 * YouTube search via yt-dlp's *flat* search: only the public search result page is
 * read (title, duration, views, channel). No video page is opened and nothing is
 * downloaded here. Downloading YouTube videos is not allowed by YouTube's terms,
 * so hits are marked `manual_required` unless they came from the Creative Commons filter.
 */
export function youtubeAdapter(opts: {creativeCommonsOnly?: boolean} = {}): SearchAdapter {
  const cc = !!opts.creativeCommonsOnly;
  return {
    platform: 'youtube',
    name: cc ? 'youtube-cc' : 'youtube',
    capabilities: cc
      ? 'YouTube search restricted to Creative-Commons (CC BY) videos – metadata via search results.'
      : 'YouTube search results (title, duration, views, channel, thumbnail). Media must be provided manually.',
    async search(query: string, limit: number): Promise<SearchHit[]> {
      const target = cc
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIwAQ%253D%253D`
        : `ytsearch${limit}:${query}`;
      let raw: string;
      try {
        raw = await runYtDlp(['--flat-playlist', '-J', '--playlist-end', String(limit), '--no-warnings', target]);
      } catch (e) {
        const msg = String((e as Error).message);
        if (/429|Too Many Requests|Sign in to confirm/i.test(msg)) throw new AdapterBlockedError('youtube', `YouTube blocked the request: ${msg}`);
        throw e;
      }
      const data = JSON.parse(raw) as {entries?: YtFlatEntry[]};
      return (data.entries ?? [])
        .filter((e) => e.id && e.title)
        .map((e) => {
          const isShort = (e.url ?? '').includes('/shorts/');
          return {
            platform: 'youtube' as const,
            platformId: e.id,
            url: `https://www.youtube.com/watch?v=${e.id}`,
            title: e.title ?? '',
            description: e.description ?? undefined,
            channel: e.channel ?? e.uploader ?? undefined,
            durationSec: e.duration ?? undefined,
            viewCount: e.view_count ?? undefined,
            thumbnailUrl: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
            license: cc ? 'CC BY (YouTube Creative Commons filter)' : undefined,
            // shorts are vertical by definition
            width: isShort ? 1080 : undefined,
            height: isShort ? 1920 : undefined,
            mediaStatus: 'manual_required' as const,
            mediaNote: cc
              ? 'Creative Commons licensed – reuse allowed with attribution; download needs yt-dlp opt-in (config acquisition.ytDlp).'
              : 'YouTube terms do not allow downloading. Provide the file yourself (with permission) via media/inbox/.',
          };
        });
    },
  };
}
