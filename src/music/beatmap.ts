import {abs} from '../core/paths.js';
import {readJson} from '../core/fsutil.js';
import {effectiveDrop, type MusicConfig} from '../core/config.js';

export interface DropCandidate {
  time: number;
  score: number;
  rmsJumpDb: number;
  lowJumpDb: number;
  onsetStrength: number;
}

export interface BeatMap {
  schema: string;
  analysisVersion: number;
  source: {path: string; sha256: string};
  durationSec: number;
  bpm: number;
  beatPeriodSec: number;
  meter: number;
  beats: number[];
  downbeats: number[];
  strongOnsets: number[];
  sections: {index: number; start: number; end: number; meanRmsDb: number; energy: string}[];
  dropCandidates: DropCandidate[];
  loudness: {integratedLufs: number | null; loudnessRangeLu: number | null; truePeakDbfs: number | null};
}

export function loadBeatMap(music: MusicConfig): BeatMap {
  return readJson<BeatMap>(abs(music.beatmap));
}

/** Index of the beat closest to t. */
export function nearestBeatIndex(beats: number[], t: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(beats[lo - 1] - t) <= Math.abs(beats[lo] - t)) return lo - 1;
  return lo;
}

export function nearestBeat(beats: number[], t: number): number {
  const i = nearestBeatIndex(beats, t);
  return i < 0 ? t : beats[i];
}

/** Snap t to the closest beat if it is within `tolerance` seconds, otherwise keep t. */
export function snapToBeat(beats: number[], t: number, tolerance: number): number {
  const b = nearestBeat(beats, t);
  return Math.abs(b - t) <= tolerance ? b : t;
}

/** Beat times in [from, to). */
export function beatsBetween(beats: number[], from: number, to: number): number[] {
  return beats.filter((b) => b >= from - 1e-6 && b < to - 1e-6);
}

/**
 * The beat `n` beats after `t` (t itself snapped to the grid first). Falls back
 * to extrapolating with the beat period past the end of the analysed grid.
 */
export function beatAfter(map: BeatMap, t: number, n: number): number {
  const i = nearestBeatIndex(map.beats, t);
  const target = i + n;
  if (target < map.beats.length) return map.beats[target];
  const last = map.beats[map.beats.length - 1];
  return last + (target - (map.beats.length - 1)) * map.beatPeriodSec;
}

export interface SongWindow {
  /** Song time where playback starts (aligned so the drop lands at the story end). */
  songStart: number;
  /** Song time of the drop (= transition to the outro). */
  drop: number;
  /** Song time where the outro's last shot ends (a downbeat). */
  outroEnd: number;
  /** Song time where audio/video fade out is complete. */
  songEnd: number;
  storyDuration: number;
  outroDuration: number;
  totalDuration: number;
}

/**
 * Align the music so the drop lands exactly at the end of the story.
 * Throws if the story is longer than the time available before the drop –
 * the planner then trims the story and tries again.
 */
export function computeSongWindow(
  map: BeatMap,
  music: MusicConfig,
  storyDuration: number,
  outroBars: number,
  fadeOutSec: number,
): SongWindow {
  const drop = effectiveDrop(music);
  const songStart = drop - storyDuration;
  if (songStart < music.earliestSongStart - 1e-6) {
    throw new RangeError(
      `Story (${storyDuration.toFixed(2)} s) is longer than the music before the drop (${(drop - music.earliestSongStart).toFixed(2)} s).`,
    );
  }
  const outroEnd = beatAfter(map, drop, outroBars * map.meter);
  const songEnd = Math.min(outroEnd + fadeOutSec, map.durationSec);
  return {
    songStart,
    drop,
    outroEnd,
    songEnd,
    storyDuration,
    outroDuration: songEnd - drop,
    totalDuration: songEnd - songStart,
  };
}

/** Max story length that still fits before the drop. */
export function maxStoryBeforeDrop(music: MusicConfig): number {
  return effectiveDrop(music) - music.earliestSongStart;
}
