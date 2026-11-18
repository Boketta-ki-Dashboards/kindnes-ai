import type {Platform} from '../../core/types.js';

export interface SearchHit {
  platform: Platform;
  platformId: string;
  url: string;
  title: string;
  description?: string;
  channel?: string;
  durationSec?: number;
  viewCount?: number;
  uploadDate?: string;
  thumbnailUrl?: string;
  license?: string;
  language?: string;
  width?: number;
  height?: number;
  /** What we know about getting the actual media file. */
  mediaStatus: 'metadata_only' | 'downloadable' | 'manual_required';
  mediaNote?: string;
  /** For license-cleared sources: a direct media URL. */
  directMediaUrl?: string;
}

export interface SearchAdapter {
  platform: Platform;
  name: string;
  /** Short human-readable description of what this adapter can and cannot do. */
  capabilities: string;
  search(query: string, limit: number): Promise<SearchHit[]>;
}

export class AdapterBlockedError extends Error {
  constructor(
    public platform: Platform,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {'User-Agent': 'kindness-ai-research/0.1 (personal research tool)', Accept: 'application/json', ...(init.headers ?? {})},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
