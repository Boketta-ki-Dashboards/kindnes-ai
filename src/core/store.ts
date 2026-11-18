import {PATHS} from './paths.js';
import {nowIso, readJson, writeJson} from './fsutil.js';
import type {Candidate, CandidateState, Platform, ProductionRecord} from './types.js';
import {transition} from './state.js';

interface CandidateFile {
  schema: 'kindness-ai/candidates';
  version: 1;
  updatedAt: string;
  candidates: Candidate[];
}

interface ProductionFile {
  schema: 'kindness-ai/productions';
  version: 1;
  productions: ProductionRecord[];
}

const STOP = new Set(
  'the a an of and or to in on for with this that is are was be by at from you your will it its his her their our my me we they he she them who what when how why just most best top new full video videos shorts short clip part official compilation'.split(
    ' ',
  ),
);

/** Normalised word set of a title, used to spot the same story re-uploaded under similar titles. */
export function titleFingerprint(title: string): string {
  const words = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/#\w+/g, ' ')
    .replace(/[^a-z0-9äöüß ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].sort().join(' ');
}

export function jaccard(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const PREFIX: Record<Platform, string> = {
  youtube: 'yt',
  dailymotion: 'dm',
  archive_org: 'ia',
  wikimedia: 'wm',
  reddit: 'rd',
  tiktok: 'tt',
  local: 'local',
  other: 'x',
};

export function candidateId(platform: Platform, platformId: string): string {
  return `${PREFIX[platform]}_${platformId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}`;
}

/** Canonical URL so different spellings of the same link are recognised as one video. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return `youtube:${u.pathname.slice(1)}`;
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v') ?? u.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
      if (v) return `youtube:${v}`;
    }
    if (host.endsWith('dailymotion.com')) {
      const m = u.pathname.match(/\/video\/([a-z0-9]+)/i);
      if (m) return `dailymotion:${m[1]}`;
    }
    if (host === 'dai.ly') return `dailymotion:${u.pathname.slice(1)}`;
    if (host.endsWith('tiktok.com')) {
      const m = u.pathname.match(/\/video\/(\d+)/);
      if (m) return `tiktok:${m[1]}`;
    }
    return `${host}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.trim();
  }
}

export interface DuplicateHit {
  id: string;
  reason: 'same-id' | 'same-url' | 'similar-title' | 'same-media';
}

export class CandidateStore {
  private data: CandidateFile;
  private prod: ProductionFile;

  constructor(
    private file = PATHS.candidates,
    private productionsFile = PATHS.productions,
  ) {
    this.data = readJson<CandidateFile>(file, {schema: 'kindness-ai/candidates', version: 1, updatedAt: nowIso(), candidates: []});
    this.prod = readJson<ProductionFile>(productionsFile, {schema: 'kindness-ai/productions', version: 1, productions: []});
  }

  all(): Candidate[] {
    return this.data.candidates;
  }

  get(id: string): Candidate | undefined {
    return this.data.candidates.find((c) => c.id === id);
  }

  require(id: string): Candidate {
    const c = this.get(id);
    if (!c) throw new Error(`Unknown candidate ${id}`);
    return c;
  }

  byState(...states: CandidateState[]): Candidate[] {
    return this.data.candidates.filter((c) => states.includes(c.state));
  }

  /** Is this video already known (by id, canonical URL or a near-identical title from the same platform family)? */
  findDuplicate(c: Pick<Candidate, 'id' | 'url' | 'titleFingerprint' | 'durationSec'>): DuplicateHit | null {
    const url = canonicalUrl(c.url);
    for (const o of this.data.candidates) {
      if (o.id === c.id) return {id: o.id, reason: 'same-id'};
      if (canonicalUrl(o.url) === url) return {id: o.id, reason: 'same-url'};
    }
    for (const o of this.data.candidates) {
      const sim = jaccard(o.titleFingerprint, c.titleFingerprint);
      const durClose = o.durationSec && c.durationSec ? Math.abs(o.durationSec - c.durationSec) <= 2 : false;
      if (c.titleFingerprint.split(' ').length >= 3 && (sim >= 0.9 || (sim >= 0.7 && durClose))) return {id: o.id, reason: 'similar-title'};
    }
    return null;
  }

  /** Adds a candidate unless it is a duplicate. Returns the stored candidate or the duplicate hit. */
  add(c: Candidate): {added: boolean; candidate: Candidate; duplicate?: DuplicateHit} {
    const dup = this.findDuplicate(c);
    if (dup) return {added: false, candidate: this.require(dup.id), duplicate: dup};
    this.data.candidates.push(c);
    return {added: true, candidate: c};
  }

  setState(c: Candidate, to: CandidateState, note?: string): void {
    transition(c, to, note);
  }

  update(c: Candidate, patch: Partial<Candidate>): void {
    Object.assign(c, patch, {updatedAt: nowIso()});
  }

  save(): void {
    this.data.updatedAt = nowIso();
    writeJson(this.file, this.data);
    writeJson(this.productionsFile, this.prod);
  }

  productions(): ProductionRecord[] {
    return this.prod.productions;
  }

  /** Prevent producing the same story twice (same candidate, same media hash, or same perceptual hash). */
  findProduction(c: Candidate, dHashMatcher?: (a: string, b: string) => boolean): ProductionRecord | undefined {
    return this.prod.productions.find(
      (p) =>
        p.candidateId === c.id ||
        (p.mediaSha256 && c.media.local?.sha256 && p.mediaSha256 === c.media.local.sha256) ||
        (dHashMatcher && p.dHash && c.media.local?.dHash && dHashMatcher(p.dHash, c.media.local.dHash)),
    );
  }

  recordProduction(rec: ProductionRecord): void {
    const i = this.prod.productions.findIndex((p) => p.jobId === rec.jobId);
    if (i >= 0) this.prod.productions[i] = rec;
    else this.prod.productions.push(rec);
  }
}

export function newCandidate(init: {
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
  query?: string;
}): Candidate {
  const at = nowIso();
  return {
    id: candidateId(init.platform, init.platformId),
    ...init,
    categories: [],
    discoveredAt: at,
    updatedAt: at,
    state: 'DISCOVERED',
    history: [{at, from: null, to: 'DISCOVERED', note: init.query ? `query: ${init.query}` : undefined}],
    media: {status: 'unknown'},
    favorite: false,
    isCompilation: false,
    titleFingerprint: titleFingerprint(init.title),
  };
}
