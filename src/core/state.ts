import type {Candidate, CandidateState} from './types.js';
import {nowIso} from './fsutil.js';

/**
 * Allowed transitions. Error states can be entered from (almost) anywhere and
 * left again via an explicit retry, so a failed step never forces a full restart.
 */
const FORWARD: Record<CandidateState, CandidateState[]> = {
  DISCOVERED: ['METADATA_ANALYZED'],
  METADATA_ANALYZED: ['CONTENT_ANALYZED', 'SCORED'],
  CONTENT_ANALYZED: ['SCORED'],
  SCORED: ['SHORTLISTED', 'CONTENT_ANALYZED', 'SCORED'],
  SHORTLISTED: ['SELECTED', 'CONTENT_ANALYZED', 'SCORED'],
  SELECTED: ['EDITING', 'CONTENT_ANALYZED', 'SCORED'],
  // EDITING/RENDERED/QUALITY_CHECKED -> SELECTED: resume an interrupted production
  EDITING: ['RENDERED', 'SELECTED'],
  RENDERED: ['QUALITY_CHECKED', 'SELECTED'],
  QUALITY_CHECKED: ['REVIEW', 'SELECTED'],
  REVIEW: ['APPROVED', 'SELECTED'],
  APPROVED: ['EXPORTED', 'SELECTED'],
  EXPORTED: [],
  MEDIA_UNAVAILABLE: ['METADATA_ANALYZED', 'CONTENT_ANALYZED', 'SCORED', 'SELECTED'],
  ANALYSIS_FAILED: ['METADATA_ANALYZED', 'CONTENT_ANALYZED', 'SCORED'],
  RENDER_FAILED: ['SELECTED', 'EDITING'],
  QC_FAILED: ['SELECTED', 'EDITING'],
  REJECTED: ['SCORED', 'SHORTLISTED', 'ARCHIVED'],
  ARCHIVED: ['SCORED', 'SHORTLISTED'],
};

const ERROR_ENTRY: CandidateState[] = ['MEDIA_UNAVAILABLE', 'ANALYSIS_FAILED', 'RENDER_FAILED', 'QC_FAILED', 'REJECTED', 'ARCHIVED'];

const ORDER: CandidateState[] = [
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
];

export class TransitionError extends Error {}

export function canTransition(from: CandidateState, to: CandidateState): boolean {
  if (from === to) return to === 'SCORED'; // re-scoring is allowed
  if (ERROR_ENTRY.includes(to) && from !== 'EXPORTED') return true;
  return FORWARD[from]?.includes(to) ?? false;
}

export function transition(c: Candidate, to: CandidateState, note?: string): Candidate {
  if (!canTransition(c.state, to)) {
    throw new TransitionError(`Invalid transition ${c.state} -> ${to} for ${c.id}`);
  }
  const at = nowIso();
  c.history.push({at, from: c.state, to, note});
  c.state = to;
  c.updatedAt = at;
  return c;
}

/** Position in the happy path (error states return -1). Used to skip already-done steps on resume. */
export function stageIndex(state: CandidateState): number {
  return ORDER.indexOf(state);
}

export function isAtLeast(state: CandidateState, target: CandidateState): boolean {
  const a = stageIndex(state);
  const b = stageIndex(target);
  return a >= 0 && b >= 0 && a >= b;
}

/** The state to return to when retrying after an error state. */
export function retryTarget(c: Candidate): CandidateState | null {
  const lastOk = [...c.history].reverse().find((h) => h.from && stageIndex(h.from) >= 0 && ERROR_ENTRY.includes(h.to));
  if (!lastOk?.from) return null;
  switch (c.state) {
    case 'RENDER_FAILED':
    case 'QC_FAILED':
      return 'SELECTED';
    case 'MEDIA_UNAVAILABLE':
    case 'ANALYSIS_FAILED': {
      const prev = lastOk.from;
      return stageIndex(prev) >= stageIndex('SCORED') ? 'SCORED' : 'METADATA_ANALYZED';
    }
    case 'REJECTED':
    case 'ARCHIVED':
      return 'SCORED';
    default:
      return null;
  }
}
