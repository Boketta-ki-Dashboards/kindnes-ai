/** Shared domain types for the Kindness AI pipeline. */

export const PIPELINE_STATES = [
  'DISCOVERED',
  'METADATA_ANALYZED',
  'CONTENT_ANALYZED',
  'SCORED',
  'SHORTLISTED',
  'SELECTED',
  'EDITING',
  'RENDERED',
  'QUALITY_CHECKED',
  'REVIEW',
  'APPROVED',
  'EXPORTED',
] as const;

export const ERROR_STATES = ['MEDIA_UNAVAILABLE', 'ANALYSIS_FAILED', 'RENDER_FAILED', 'QC_FAILED', 'REJECTED', 'ARCHIVED'] as const;

export type PipelineState = (typeof PIPELINE_STATES)[number];
export type ErrorState = (typeof ERROR_STATES)[number];
export type CandidateState = PipelineState | ErrorState;

export type Platform = 'youtube' | 'dailymotion' | 'archive_org' | 'wikimedia' | 'reddit' | 'tiktok' | 'local' | 'other';

/** How much of the clip was really looked at when scoring. */
export type AnalysisLevel =
  /** Only title/description/duration/statistics. Score is PROVISIONAL. */
  | 'METADATA_ONLY'
  /** Media file decoded and measured (resolution, sharpness, motion, audio peaks, cuts). */
  | 'CONTENT_SIGNALS'
  /** Content judged by a vision model or a human reviewer on real frames. */
  | 'CONTENT_REVIEWED';

export interface CriterionScore {
  points: number;
  max: number;
  reasons: string[];
}

export interface ScoreBreakdown {
  total: number;
  emotional: CriterionScore; // A – 35
  clarity: CriterionScore; // B – 25
  dropPotential: CriterionScore; // C – 20
  visualQuality: CriterionScore; // D – 10
  originality: CriterionScore; // E – 10
  analysisLevel: AnalysisLevel;
  provisional: boolean;
  scoredAt: string;
  scorer: string;
  qualifies: boolean; // total >= threshold
}

export interface MediaInfo {
  path: string;
  sha256?: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec?: string;
  audioCodec?: string | null;
  sizeBytes?: number;
  dHash?: string;
}

export interface CandidateHistoryEntry {
  at: string;
  from: CandidateState | null;
  to: CandidateState;
  note?: string;
}

export interface Candidate {
  id: string; // e.g. yt_8x_bSH1A5rA
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
  /** Direct media URL for license-cleared sources (archive.org / Wikimedia). */
  mediaUrl?: string;
  /** Manual edit overrides (highlight time, hook text, variant …). */
  editOverrides?: Record<string, unknown>;
  categories: string[];
  discoveredAt: string;
  updatedAt: string;
  state: CandidateState;
  history: CandidateHistoryEntry[];
  /** Media availability as far as we know. */
  media: {
    status: 'unknown' | 'metadata_only' | 'downloadable' | 'manual_required' | 'available' | 'unavailable';
    reason?: string;
    local?: MediaInfo;
  };
  score?: ScoreBreakdown;
  contentAnalysisPath?: string;
  favorite: boolean;
  isCompilation: boolean;
  titleFingerprint: string;
  notes?: string;
  lastError?: {step: string; message: string; at: string};
  jobId?: string;
}

export interface ProductionRecord {
  candidateId: string;
  jobId: string;
  mediaSha256?: string;
  dHash?: string;
  titleFingerprint?: string;
  renderedAt?: string;
  status: 'planned' | 'rendered' | 'approved' | 'exported';
  output?: string;
}
