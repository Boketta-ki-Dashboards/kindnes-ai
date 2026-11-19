import path from 'node:path';
import {PATHS, abs} from '../core/paths.js';
import {readJson} from '../core/fsutil.js';
import type {AssetsConfig, OutroSource, OutroVariant} from '../core/config.js';
import type {BeatMap} from '../music/beatmap.js';
import {beatAfter, nearestBeatIndex} from '../music/beatmap.js';
import type {OutroShot} from '../edit/plan-types.js';

/** Subset of the Python video analysis used here. */
export interface VideoAnalysis {
  info: {width: number; height: number; fps: number; durationSec: number};
  cuts: {time: number; score: number}[];
  shots: {start: number; end: number; duration: number; meanMotion: number; meanBrightness: number; focusX: number; warmth: number; cropFit?: number}[];
  blackSegments: {start: number; end: number}[];
  perSecond: {motion: number[]; brightness: number[]; focusX: number[]; sharpness: number[]; warmth: number[]};
  highlights?: {time: number; score: number; features: Record<string, number>}[];
  audio?: {halfSecond: {t: number; rmsDb: number}[]; meanRmsDb: number} | null;
}

export function analysisPathForAsset(assetPath: string): string {
  const base = path.basename(assetPath).replace(/\.[^.]+$/, '');
  return path.join(PATHS.analysis, 'outro', `${base}.video.json`);
}

interface ShotCandidate {
  sourceId: string;
  src: string;
  start: number;
  end: number;
  quality: number;
  focusX: number;
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** Turn the analysed shots of one source into usable, scored windows. */
export function shotCandidates(source: OutroSource, analysis: VideoAnalysis, framing: OutroVariant['framing'] = 'fit-blur'): ShotCandidate[] {
  const out: ShotCandidate[] = [];
  const shots = analysis.shots.length
    ? analysis.shots
    : [{start: 0, end: analysis.info.durationSec, duration: analysis.info.durationSec, meanMotion: 0, meanBrightness: 0.5, focusX: 0.5, warmth: 0}];
  for (const s of shots) {
    for (const [ra, rb] of source.usableRanges) {
      let a = Math.max(s.start + 0.08, ra);
      let b = Math.min(s.end - 0.04, rb);
      for (const ex of source.excludeRanges) {
        if (overlaps([a, b], ex)) {
          // keep the longer side of the excluded range
          if (ex[0] - a >= b - ex[1]) b = Math.min(b, ex[0]);
          else a = Math.max(a, ex[1]);
        }
      }
      for (const blk of analysis.blackSegments) {
        if (overlaps([a, b], [blk.start, blk.end])) {
          if (blk.start - a >= b - blk.end) b = Math.min(b, blk.start);
          else a = Math.max(a, blk.end);
        }
      }
      if (b - a < 0.35) continue;
      // near-black shots read as black frames on a phone (and fail QC) – skip them
      const secs = analysis.perSecond.brightness.slice(Math.floor(a), Math.max(Math.floor(a) + 1, Math.ceil(b)));
      if (s.meanBrightness < 0.16 || (secs.length && Math.min(...secs) < 0.1)) continue;
      // Prefer bright-but-not-blown, warm, calm-ish shots; longer shots give more choice.
      const bright = 1 - Math.min(1, Math.abs(s.meanBrightness - 0.5) / 0.4);
      const warm = Math.max(0, Math.min(1, s.warmth / 0.25));
      const calm = 1 - Math.min(1, s.meanMotion / 0.12);
      const length = Math.min(1, (b - a) / 3);
      // for full-screen 9:16 crops, prefer shots whose detail fits into the crop window
      const crop = framing === 'cover' ? Math.max(0, Math.min(1, ((s.cropFit ?? 0.5) - 0.3) / 0.4)) : 0;
      out.push({
        sourceId: source.id,
        src: source.path,
        start: a,
        end: b,
        quality: 0.35 * bright + 0.25 * warm + 0.2 * calm + 0.2 * length + 0.6 * crop,
        focusX: s.focusX,
      });
    }
  }
  return out;
}

/** Slot durations (seconds, beat-exact) that fill the outro from the drop to outroEnd. */
export function outroSlots(map: BeatMap, drop: number, outroEnd: number, pattern: number[]): {start: number; end: number}[] {
  const slots: {start: number; end: number}[] = [];
  let t = drop;
  let i = 0;
  while (t < outroEnd - 0.05 && slots.length < 200) {
    const n = pattern[i % pattern.length];
    let end = beatAfter(map, t, n);
    if (end > outroEnd - 0.2) end = outroEnd; // last shot runs to the end
    slots.push({start: t, end});
    t = end;
    i++;
  }
  return slots;
}

export interface OutroPlanResult {
  shots: OutroShot[];
  warnings: string[];
}

/**
 * Build the outro shot list for a variant. Times in `shots[].start` are on the
 * song timeline relative to the drop (0 = drop); callers offset them.
 * Cuts are placed `cutLeadFrames` before the beat (the reference edits cut ~3 frames early).
 */
export function planOutro(opts: {
  assets: AssetsConfig;
  variant: OutroVariant;
  map: BeatMap;
  drop: number;
  outroEnd: number;
  fadeOutSec: number;
  fps: number;
  cutLeadFrames: number;
  analysisLoader?: (assetPath: string) => VideoAnalysis;
}): OutroPlanResult {
  const {assets, variant, map, drop, outroEnd, fps} = opts;
  const loader = opts.analysisLoader ?? ((p: string) => readJson<VideoAnalysis>(analysisPathForAsset(abs(p))));
  const warnings: string[] = [];
  const sources = variant.sources.map((id) => {
    const s = assets.outroSources.find((x) => x.id === id);
    if (!s) throw new Error(`Outro variant ${variant.id} references unknown source ${id}`);
    if (!s.useInOutro) warnings.push(`Outro source ${id} is a third-party edit (style reference) – only use it with permission.`);
    return s;
  });

  const slots = outroSlots(map, drop, outroEnd, variant.beatsPerShot);
  const lead = opts.cutLeadFrames / fps;
  const totalEnd = outroEnd + opts.fadeOutSec;

  // Hand-curated shot list (outro V3): beat-exact slots in the given order.
  if (variant.curated?.length) return planCuratedOutro({...opts, variant, totalEnd, lead, warnings});

  // Already-synced single clip (variant D): play it continuously in sync with the song.
  const synced = sources.length === 1 && sources[0].syncedSongStart !== undefined ? sources[0] : null;
  if (synced) {
    const srcIn = drop - (synced.syncedSongStart as number);
    const usableEnd = synced.usableRanges[0][1];
    const dur = Math.min(totalEnd - drop, usableEnd - srcIn);
    if (dur < totalEnd - drop - 0.05) warnings.push(`Synced outro ${synced.id} is ${(totalEnd - drop - dur).toFixed(2)} s shorter than the outro window.`);
    return {
      shots: [
        {
          src: synced.path,
          srcIn,
          srcOut: srcIn + dur,
          start: 0,
          duration: dur,
          framing: variant.framing,
          focusX: 0.5,
          zoomFrom: variant.zoom[0],
          zoomTo: variant.zoom[1],
          sourceId: synced.id,
        },
      ],
      warnings,
    };
  }

  const pool: ShotCandidate[] = sources.flatMap((s) => shotCandidates(s, loader(s.path), variant.framing));
  if (!pool.length) throw new Error(`No usable outro shots for variant ${variant.id}`);
  // Slot lengths on the final timeline (last slot also covers the fade-out).
  const slotLen = slots.map((s, i) => (i === slots.length - 1 ? totalEnd : s.end) - s.start + lead + 0.05);
  const len = (c: ShotCandidate) => c.end - c.start;
  const candidates = variant.shotOrder === 'chronological' ? pool : [...pool].sort((a, b) => b.quality - a.quality);

  // 1) the final slot gets the best shot that is long enough (it carries the fade-out)
  const lastNeed = slotLen[slotLen.length - 1];
  const finalShot = candidates.find((c) => len(c) >= lastNeed) ?? [...pool].sort((a, b) => len(b) - len(a))[0];
  // 2) the remaining slots: best shots long enough for the longest remaining slot, shown in story order
  const restNeed = Math.max(0, ...slotLen.slice(0, -1));
  let rest = candidates.filter((c) => c !== finalShot && len(c) >= restNeed).slice(0, slots.length - 1);
  if (variant.shotOrder !== 'chronological') rest = orderForArc(rest, variant.sources);
  if (rest.length < slots.length - 1) {
    // fall back to per-slot matching when there are not enough long shots
    rest = [];
    for (let i = 0; i < slots.length - 1; i++) {
      const pick = candidates.find((c) => c !== finalShot && !rest.includes(c) && len(c) >= slotLen[i]);
      if (pick) rest.push(pick);
      else {
        rest.push([...pool].sort((a, b) => len(b) - len(a))[i % pool.length]);
        warnings.push(`Outro variant ${variant.id}: not enough distinct shots, reusing one.`);
      }
    }
  }
  const order = [...rest, finalShot];

  const shots: OutroShot[] = slots.map((slot, i) => {
    const c = order[i];
    // shift cut points slightly ahead of the beat (except the very first = drop)
    const start = i === 0 ? slot.start : slot.start - lead;
    const end = i === slots.length - 1 ? totalEnd : slot.end - lead;
    const duration = end - start;
    const srcIn = c.start;
    return {
      src: c.src,
      srcIn,
      srcOut: Math.min(c.end, srcIn + duration),
      start: start - drop,
      duration,
      framing: variant.framing,
      focusX: c.focusX,
      zoomFrom: variant.zoom[0],
      zoomTo: variant.zoom[1],
      sourceId: c.sourceId,
    };
  });
  // the last shot may need to be longer than its source window: Remotion freezes on the last frame, warn
  for (const s of shots) {
    if (s.srcOut - s.srcIn < s.duration - 0.05) warnings.push(`Outro shot from ${s.sourceId} @${s.srcIn.toFixed(2)} is shorter than its slot (freeze frame).`);
  }
  const nb = nearestBeatIndex(map.beats, drop);
  if (Math.abs(map.beats[nb] - drop) > 0.06) warnings.push(`Drop ${drop.toFixed(3)} s is not on a detected beat.`);
  return {shots, warnings};
}

/** Keep each source's shots in story order, sources in variant order. */
function orderForArc(chosen: ShotCandidate[], sourceOrder: string[]): ShotCandidate[] {
  return [...chosen].sort((a, b) => {
    const sa = sourceOrder.indexOf(a.sourceId);
    const sb = sourceOrder.indexOf(b.sourceId);
    return sa !== sb ? sa - sb : a.start - b.start;
  });
}

/** Finished third-party edits already carry their own text overlays – no extra caption on top. */
export function variantHasOwnText(assets: AssetsConfig, sourceIds: string[]): boolean {
  return sourceIds.some((id) => assets.outroSources.find((s) => s.id === id)?.role === 'style-reference');
}

/**
 * Curated outro: every shot was chosen by looking at the real frames (see
 * config/assets.json -> variant V3). Cuts are placed on the beat grid with the same
 * lead as automatic outros; the last shot carries the fade-out. Source windows are
 * validated against the usable ranges so no black/logo frames slip in.
 */
function planCuratedOutro(o: {
  assets: AssetsConfig;
  variant: OutroVariant;
  map: BeatMap;
  drop: number;
  outroEnd: number;
  fps: number;
  totalEnd: number;
  lead: number;
  warnings: string[];
}): OutroPlanResult {
  const {assets, variant, map, drop, outroEnd, totalEnd, lead, warnings} = o;
  const list = variant.curated!;
  const totalBeats = list.reduce((s, c) => s + c.beats, 0);
  const availableBeats = Math.round((outroEnd - drop) / map.beatPeriodSec);
  if (totalBeats !== availableBeats) warnings.push(`Curated outro has ${totalBeats} beats, the outro window has ${availableBeats}; the last shot absorbs the difference.`);
  const shots: OutroShot[] = [];
  let beatPos = 0;
  list.forEach((c, i) => {
    const src = assets.outroSources.find((s) => s.id === c.source);
    if (!src) throw new Error(`Curated shot ${i + 1}: unknown source ${c.source}`);
    const slotStart = beatAfter(map, drop, beatPos);
    beatPos += c.beats;
    const slotEnd = i === list.length - 1 ? totalEnd : beatAfter(map, drop, beatPos);
    const start = i === 0 ? slotStart : slotStart - lead;
    const end = i === list.length - 1 ? totalEnd : slotEnd - lead;
    const duration = end - start;
    const speed = c.speed ?? 1;
    const srcOut = c.at + duration * speed;
    const inRange = src.usableRanges.some(([a, b]) => c.at >= a - 1e-6 && srcOut <= b + 1e-6);
    const hitsExcluded = src.excludeRanges.some(([a, b]) => c.at < b && srcOut > a);
    if (!inRange) warnings.push(`Curated shot ${i + 1} (${c.source} ${c.at}s, ${duration.toFixed(2)}s @${speed}x) leaves the usable range.`);
    if (hitsExcluded) warnings.push(`Curated shot ${i + 1} (${c.source} ${c.at}s) overlaps an excluded range.`);
    shots.push({
      src: src.path,
      srcIn: c.at,
      srcOut,
      start: start - drop,
      duration,
      framing: variant.framing,
      focusX: c.focusX,
      focusY: c.focusY,
      baseZoom: c.baseZoom,
      zoomFrom: variant.zoom[0],
      zoomTo: variant.zoom[1],
      sourceId: src.id,
      act: c.act,
      tag: c.tag,
      motif: c.motif,
      speed: c.speed,
      effects: c.effects,
    });
  });
  return {shots, warnings};
}
