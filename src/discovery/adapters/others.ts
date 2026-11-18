import type {SearchAdapter, SearchHit} from './types.js';
import {AdapterBlockedError, fetchJson} from './types.js';

/** Dailymotion public Data API (no key needed for search). Media download is not offered by the platform. */
export function dailymotionAdapter(): SearchAdapter {
  return {
    platform: 'dailymotion',
    name: 'dailymotion',
    capabilities: 'Dailymotion public API: title, description, duration, views, thumbnail, aspect ratio. Media must be provided manually.',
    async search(query, limit) {
      const fields = 'id,title,description,duration,thumbnail_720_url,url,views_total,created_time,owner.screenname,language,aspect_ratio,height';
      const url = `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}&sort=relevance`;
      const data = await fetchJson<{list: Record<string, unknown>[]}>(url);
      return (data.list ?? []).map((v): SearchHit => {
        const ar = Number(v.aspect_ratio ?? 0);
        const h = Number(v.height ?? 0) || undefined;
        return {
          platform: 'dailymotion',
          platformId: String(v.id),
          url: String(v.url),
          title: String(v.title ?? ''),
          description: String(v.description ?? '').replace(/<br\s*\/?>/g, ' ').slice(0, 1500),
          channel: v['owner.screenname'] ? String(v['owner.screenname']) : undefined,
          durationSec: Number(v.duration ?? 0) || undefined,
          viewCount: Number(v.views_total ?? 0),
          uploadDate: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString().slice(0, 10) : undefined,
          thumbnailUrl: v.thumbnail_720_url ? String(v.thumbnail_720_url) : undefined,
          language: v.language ? String(v.language) : undefined,
          height: h,
          width: h && ar ? Math.round(h * ar) : undefined,
          mediaStatus: 'manual_required',
          mediaNote: 'Dailymotion does not permit downloading; provide the file yourself (with permission) via media/inbox/.',
        };
      });
    },
  };
}

/** Internet Archive: open search API; items carrying a CC / public-domain license can be downloaded. */
export function archiveOrgAdapter(): SearchAdapter {
  return {
    platform: 'archive_org',
    name: 'archive_org',
    capabilities: 'Internet Archive search; items with a Creative Commons or public-domain license are downloadable.',
    async search(query, limit) {
      const q = `(${query}) AND mediatype:movies`;
      const fl = ['identifier', 'title', 'description', 'licenseurl', 'runtime', 'downloads', 'date', 'creator'].map((f) => `fl[]=${f}`).join('&');
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&${fl}&rows=${limit}&output=json&sort[]=downloads+desc`;
      const data = await fetchJson<{response: {docs: Record<string, unknown>[]}}>(url);
      return (data.response?.docs ?? []).map((d): SearchHit => {
        const lic = d.licenseurl ? String(d.licenseurl) : undefined;
        const free = !!lic && /creativecommons\.org|publicdomain/i.test(lic);
        const runtime = String(d.runtime ?? '');
        const parts = runtime.split(':').map(Number);
        const dur = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : undefined;
        const desc = Array.isArray(d.description) ? d.description.join(' ') : String(d.description ?? '');
        return {
          platform: 'archive_org',
          platformId: String(d.identifier),
          url: `https://archive.org/details/${d.identifier}`,
          title: String(Array.isArray(d.title) ? d.title[0] : (d.title ?? d.identifier)),
          description: desc.replace(/<[^>]+>/g, ' ').slice(0, 1500),
          channel: d.creator ? String(Array.isArray(d.creator) ? d.creator[0] : d.creator) : undefined,
          durationSec: dur && !Number.isNaN(dur) ? dur : undefined,
          viewCount: Number(d.downloads ?? 0),
          uploadDate: d.date ? String(d.date).slice(0, 10) : undefined,
          thumbnailUrl: `https://archive.org/services/img/${d.identifier}`,
          license: lic,
          mediaStatus: free ? 'downloadable' : 'manual_required',
          mediaNote: free ? `Free license (${lic}) – downloadable.` : 'No free license stated – ask the rights holder.',
        };
      });
    },
  };
}

/** Wikimedia Commons: all files are freely licensed (attribution required). */
export function wikimediaAdapter(): SearchAdapter {
  return {
    platform: 'wikimedia',
    name: 'wikimedia',
    capabilities: 'Wikimedia Commons video search; every file is freely licensed and downloadable.',
    async search(query, limit) {
      const url =
        'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6' +
        `&gsrsearch=${encodeURIComponent(query + ' filetype:video')}&gsrlimit=${limit}` +
        '&prop=imageinfo&iiprop=url|size|mediatype|extmetadata&iiextmetadatafilter=LicenseShortName|ImageDescription|Artist&iiurlwidth=640';
      let data: {query?: {pages?: Record<string, {title: string; imageinfo?: Record<string, unknown>[]}>}};
      try {
        data = await fetchJson(url);
      } catch (e) {
        if (/HTTP (403|429)/.test(String(e))) throw new AdapterBlockedError('wikimedia', `Wikimedia refused the request (${String(e)})`);
        throw e;
      }
      return Object.values(data.query?.pages ?? {}).map((p): SearchHit => {
        const ii = (p.imageinfo?.[0] ?? {}) as Record<string, unknown>;
        const meta = (ii.extmetadata ?? {}) as Record<string, {value?: string}>;
        const strip = (s?: string) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return {
          platform: 'wikimedia',
          platformId: p.title.replace(/^File:/, ''),
          url: String(ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`),
          title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
          description: strip(meta.ImageDescription?.value).slice(0, 1500),
          channel: strip(meta.Artist?.value) || undefined,
          durationSec: ii.duration ? Number(ii.duration) : undefined,
          width: ii.width ? Number(ii.width) : undefined,
          height: ii.height ? Number(ii.height) : undefined,
          thumbnailUrl: ii.thumburl ? String(ii.thumburl) : undefined,
          license: meta.LicenseShortName?.value,
          mediaStatus: 'downloadable',
          directMediaUrl: ii.url ? String(ii.url) : undefined,
          mediaNote: `Free license (${meta.LicenseShortName?.value ?? 'see file page'}) – attribution required.`,
        };
      });
    },
  };
}

const REDDIT_SUBS = ['HumansBeingBros', 'MadeMeSmile', 'wholesome', 'nextfuckinglevel', 'BeAmazed'];

/**
 * Reddit search. Uses OAuth (app-only) when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set
 * (free "script" app), otherwise the public JSON endpoint, which Reddit blocks for many
 * cloud IPs. Media from v.redd.it must be provided manually.
 */
export function redditAdapter(): SearchAdapter {
  let token: string | null = null;
  async function auth(): Promise<string | null> {
    const id = process.env.REDDIT_CLIENT_ID;
    const secret = process.env.REDDIT_CLIENT_SECRET;
    if (!id || !secret) return null;
    if (token) return token;
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'kindness-ai-research/0.1'},
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new AdapterBlockedError('reddit', `Reddit OAuth failed: HTTP ${res.status}`);
    token = ((await res.json()) as {access_token: string}).access_token;
    return token;
  }
  return {
    platform: 'reddit',
    name: 'reddit',
    capabilities: `Reddit search in r/${REDDIT_SUBS.join(', r/')} (video posts only).`,
    async search(query, limit) {
      const tok = await auth();
      const base = tok ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
      const headers: Record<string, string> = tok ? {Authorization: `Bearer ${tok}`} : {};
      const url = `${base}/r/${REDDIT_SUBS.join('+')}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=year&limit=${limit}`;
      let data: {data?: {children?: {data: Record<string, unknown>}[]}};
      try {
        data = await fetchJson(url, {headers});
      } catch (e) {
        if (/HTTP (401|403|429)/.test(String(e))) throw new AdapterBlockedError('reddit', `Reddit refused the request (${String(e)}). Set REDDIT_CLIENT_ID/SECRET for OAuth access.`);
        throw e;
      }
      return (data.data?.children ?? [])
        .map((c) => c.data)
        .filter((d) => d.is_video)
        .map((d): SearchHit => {
          const media = (d.media as {reddit_video?: {duration?: number; height?: number; width?: number}} | null)?.reddit_video;
          return {
            platform: 'reddit',
            platformId: String(d.id),
            url: `https://www.reddit.com${d.permalink}`,
            title: String(d.title ?? ''),
            description: String(d.selftext ?? '').slice(0, 1500),
            channel: `r/${d.subreddit}`,
            durationSec: media?.duration,
            width: media?.width,
            height: media?.height,
            viewCount: Number(d.ups ?? 0),
            uploadDate: d.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString().slice(0, 10) : undefined,
            thumbnailUrl: typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : undefined,
            mediaStatus: 'manual_required',
            mediaNote: 'Reddit-hosted video; usually re-uploaded from elsewhere – provide the file yourself (with permission).',
          };
        });
    },
  };
}

/** oEmbed lookups for manually pasted links (TikTok/YouTube). Official, metadata-only endpoints. */
export async function oembedLookup(url: string): Promise<{title?: string; author?: string; thumbnail?: string; width?: number; height?: number} | null> {
  const host = new URL(url).hostname;
  const endpoint = host.includes('tiktok.com')
    ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
    : host.includes('youtube.com') || host === 'youtu.be'
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : null;
  if (!endpoint) return null;
  try {
    const d = await fetchJson<Record<string, unknown>>(endpoint);
    return {
      title: d.title ? String(d.title) : undefined,
      author: d.author_name ? String(d.author_name) : undefined,
      thumbnail: d.thumbnail_url ? String(d.thumbnail_url) : undefined,
      width: d.thumbnail_width ? Number(d.thumbnail_width) : undefined,
      height: d.thumbnail_height ? Number(d.thumbnail_height) : undefined,
    };
  } catch {
    return null;
  }
}
