import type {AssetsConfig, MusicConfig, PipelineConfig} from '../core/config.js';
import {effectiveDrop} from '../core/config.js';
import {nowIso} from '../core/fsutil.js';
import type {BeatMap} from '../music/beatmap.js';
import {beatsBetween, computeSongWindow, maxStoryBeforeDrop, nearestBeat} from '../music/beatmap.js';
import {planOutro, type VideoAnalysis} from '../outro/outro.js';
import type {EditPlan, Framing, StorySegment, TextOverlay} from './plan-types.js';

export interface PlanOverrides {
  /** Emotional peak in source seconds (otherwise auto-detected). */
  highlightTime?: number;
  storyIn?: number;
  storyOut?: number;
  hookText?: string;
  variant?: string;
  transition?: EditPlan['transition']['type'];
  framing?: Framing;
  /** Subtitles in SOURCE time. */
  subtitles?: {text: string; start: number; end: number}[];
  dropCaption?: string | null;
  /** Volume of the clip's own audio (0 = mute, e.g. when the clip already contains music). */
  storyAudioGain?: number;
}

export interface PlanInput {
  jobId: string;
  candidateId: string;
  storySrc: string;
  analysis: VideoAnalysis;
  config: PipelineConfig;
  music: MusicConfig;
  beatmap: BeatMap;
  assets: AssetsConfig;
  overrides?: PlanOverrides;
  outroAnalysisLoader?: (assetPath: string) => VideoAnalysis;
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Content range of the source without leading/trailing black frames. */
export function contentRange(a: VideoAnalysis): [number, number] {
  const D = a.info.durationSec;
  let s = 0;
  let e = D;
  for (const b of a.blackSegments) {
    if (b.start <= 0.05 && b.end > s) s = b.end;
    if (b.end >= D - 0.1 && b.start < e) e = b.start;
  }
  if (e - s < 1) return [0, D];
  return [s, e];
}

interface ShotScore {
  start: number;
  end: number;
  score: number;
}

/** Interest per analysed shot: motion + loudness (normalised). Used to drop dull passages. */
function shotInterest(a: VideoAnalysis, from: number, to: number): ShotScore[] {
  const motion = a.perSecond.motion;
  const mMax = Math.max(1e-6, ...motion);
  const half = a.audio?.halfSecond ?? [];
  const dbs = half.map((h) => h.rmsDb);
  const dbMin = dbs.length ? Math.min(...dbs) : -60;
  const dbMax = dbs.length ? Math.max(...dbs) : 0;
  const bounds = [from, ...a.cuts.map((c) => c.time).filter((t) => t > from + 0.5 && t < to - 0.5), to];
  const out: ShotScore[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i];
    const e = bounds[i + 1];
    const secs = motion.slice(Math.floor(s), Math.max(Math.floor(s) + 1, Math.ceil(e)));
    const m = secs.reduce((x, y) => x + y, 0) / Math.max(1, secs.length) / mMax;
    const hs = half.filter((h) => h.t >= s && h.t < e).map((h) => (h.rmsDb - dbMin) / Math.max(1e-6, dbMax - dbMin));
    const l = hs.length ? hs.reduce((x, y) => x + y, 0) / hs.length : 0.5;
    out.push({start: s, end: e, score: 0.6 * m + 0.4 * l});
  }
  return out;
}

/**
 * Choose story segments: keep the setup (first shot) and everything from shortly
 * before the emotional peak until the reaction ends; drop the least interesting
 * shots in between until the story fits `maxLen`; trim the start as last resort.
 */
export function selectStorySegments(a: VideoAnalysis, start: number, end: number, highlight: number, maxLen: number): {srcIn: number; srcOut: number}[] {
  if (end - start <= maxLen) return [{srcIn: start, srcOut: end}];
  const protectFrom = Math.max(start, highlight - Math.min(10, maxLen * 0.45));
  let shots = shotInterest(a, start, end);
  const total = () => shots.reduce((x, s) => x + (s.end - s.start), 0);
  const isProtected = (s: ShotScore, i: number) => i === 0 || s.end > protectFrom;
  // remove dull middle shots (but keep the first shot = context)
  while (total() > maxLen) {
    const removable = shots
      .map((s, i) => ({s, i}))
      .filter(({s, i}) => !isProtected(s, i) && s.end - s.start <= total() - maxLen + 4);
    if (!removable.length) break;
    removable.sort((x, y) => x.s.score - y.s.score);
    shots = shots.filter((_, i) => i !== removable[0].i);
  }
  // still too long: trim the beginning (the setup gets shorter, the climax stays intact)
  let excess = total() - maxLen;
  while (excess > 1e-3 && shots.length) {
    const first = shots[0];
    const len = first.end - first.start;
    if (len - excess >= 1.5 || shots.length === 1) {
      first.start += Math.min(excess, len - 0.5);
      excess = 0;
    } else {
      shots.shift();
      excess -= len;
    }
  }
  // merge contiguous shots back into segments
  const segs: {srcIn: number; srcOut: number}[] = [];
  for (const s of shots) {
    const last = segs[segs.length - 1];
    if (last && Math.abs(last.srcOut - s.start) < 1e-3) last.srcOut = s.end;
    else segs.push({srcIn: s.start, srcOut: s.end});
  }
  return segs.filter((s) => s.srcOut - s.srcIn >= 0.5);
}

export function buildEditPlan(input: PlanInput): EditPlan {
  const {analysis: a, config: cfg, music, beatmap, assets} = input;
  const ov = input.overrides ?? {};
  const warnings: string[] = [];
  const fps = cfg.video.fps;
  const [c0, c1] = contentRange(a);

  // 1) emotional peak
  const autoPeak = a.highlights?.[0]?.time;
  const highlight = ov.highlightTime ?? autoPeak ?? c0 + (c1 - c0) * 0.7;
  if (ov.highlightTime === undefined && autoPeak === undefined) warnings.push('No highlight detected – using 70 % of the clip.');

  // 2) story end = reaction after the peak, preferably on a nearby cut
  let end = ov.storyOut ?? Math.min(c1, highlight + cfg.story.reactionHoldSec);
  if (ov.storyOut === undefined) {
    const cut = a.cuts.find((c) => c.time > end - 0.4 && c.time < end + 0.6 && c.time <= c1);
    if (cut) end = cut.time;
  }
  // 3) story length limits
  const maxLen = Math.min(cfg.story.maxSec, maxStoryBeforeDrop(music));
  let start = ov.storyIn ?? c0;
  if (end - start < cfg.story.minSec) {
    end = Math.min(c1, start + cfg.story.minSec);
    if (end - start < cfg.story.minSec) warnings.push(`Story only ${(end - start).toFixed(1)} s long (min ${cfg.story.minSec} s).`);
  }
  const rawSegs = ov.storyIn !== undefined ? [{srcIn: start, srcOut: Math.min(end, start + maxLen)}] : selectStorySegments(a, start, end, highlight, maxLen);
  start = rawSegs[0].srcIn;

  // 4) lay segments on the timeline
  const segments: StorySegment[] = [];
  let t = 0;
  for (const s of rawSegs) {
    segments.push({srcIn: s.srcIn, srcOut: s.srcOut, start: t});
    t += s.srcOut - s.srcIn;
  }
  const storyDuration = t;
  const win = computeSongWindow(beatmap, music, storyDuration, cfg.outro.bars, cfg.outro.fadeOutSec);

  // 5) put internal jump cuts on the beat (keeps total length, so the drop stays put)
  if (cfg.story.snapCutsToBeats && segments.length > 1) {
    for (let k = 1; k < segments.length; k++) {
      const songT = win.songStart + segments[k].start;
      const b = nearestBeat(beatmap.beats, songT);
      const delta = b - songT;
      const prev = segments[k - 1];
      const cur = segments[k];
      if (Math.abs(delta) <= 0.2 && prev.srcOut + delta > prev.srcIn + 0.3 && cur.srcIn + delta < cur.srcOut - 0.3) {
        prev.srcOut += delta;
        cur.srcIn += delta;
        cur.start += delta;
      }
    }
  }
  const hlSeg = segments.find((s) => highlight >= s.srcIn && highlight <= s.srcOut);
  const highlightTimeline = hlSeg ? hlSeg.start + (highlight - hlSeg.srcIn) : storyDuration - cfg.story.reactionHoldSec;
  if (!hlSeg) warnings.push('Highlight lies outside the selected story segments.');

  // 6) outro
  const variantId = ov.variant ?? cfg.outro.variant;
  const variant = assets.outroVariants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Unknown outro variant ${variantId}`);
  const outro = planOutro({
    assets,
    variant,
    map: beatmap,
    drop: win.drop,
    outroEnd: win.outroEnd,
    fadeOutSec: cfg.outro.fadeOutSec,
    fps,
    cutLeadFrames: cfg.outro.cutLeadFrames,
    analysisLoader: input.outroAnalysisLoader,
  });
  warnings.push(...outro.warnings);
  const shots = outro.shots.map((s) => ({...s, start: round(s.start + storyDuration)}));
  const total = storyDuration + (win.songEnd - win.drop);

  // 7) framing: vertical sources fill the frame, everything else is fitted on a blurred copy
  const aspect = a.info.width / Math.max(1, a.info.height);
  const framing: Framing = ov.framing ?? (aspect < 0.7 ? 'cover' : cfg.story.framing);
  const fx = a.perSecond.focusX.slice(Math.floor(start), Math.ceil(end));
  const focusX = fx.length ? [...fx].sort((x, y) => x - y)[Math.floor(fx.length / 2)] : 0.5;
  if (Math.min(a.info.width, a.info.height) < 540) warnings.push(`Low source resolution ${a.info.width}x${a.info.height}.`);

  // 8) texts
  const texts: TextOverlay[] = [];
  if (ov.hookText) texts.push({text: ov.hookText, start: 0.2, end: Math.min(4.0, storyDuration - 0.5), style: 'hook'});
  for (const sub of ov.subtitles ?? []) {
    const seg = segments.find((s) => sub.start >= s.srcIn && sub.start < s.srcOut);
    if (!seg) continue;
    const st = seg.start + (sub.start - seg.srcIn);
    texts.push({text: sub.text, start: round(st), end: round(Math.min(st + (sub.end - sub.start), seg.start + (seg.srcOut - seg.srcIn))), style: 'subtitle'});
  }
  const caption = ov.dropCaption === undefined ? (cfg.text.showDropCaption ? cfg.text.dropCaption : null) : ov.dropCaption;
  if (caption && variant.overlay !== 'definition') {
    texts.push({text: caption, start: round(storyDuration + 0.15), end: round(storyDuration + (win.outroEnd - win.drop)), style: 'drop-caption'});
  }

  const beatsOnTimeline = beatsBetween(beatmap.beats, win.songStart, win.songEnd).map((b) => round(b - win.songStart));
  if (Math.abs(effectiveDrop(music) - win.drop) > 1e-6) warnings.push('Drop mismatch.');

  return {
    schema: 'kindness-ai/edit-plan',
    version: 1,
    jobId: input.jobId,
    candidateId: input.candidateId,
    createdAt: nowIso(),
    fps,
    width: cfg.video.width,
    height: cfg.video.height,
    durationSec: round(total),
    music: {
      src: music.track,
      songStart: round(win.songStart),
      drop: round(win.drop),
      outroEnd: round(win.outroEnd),
      songEnd: round(win.songEnd),
      gainDb: cfg.audio.musicGainDb,
      fadeInSec: win.songStart > 0.5 ? cfg.audio.musicFadeInSec : 0,
      fadeOutSec: cfg.outro.fadeOutSec,
      beatsOnTimeline,
    },
    story: {
      src: input.storySrc,
      sourceDuration: a.info.durationSec,
      segments: segments.map((s) => ({srcIn: round(s.srcIn), srcOut: round(s.srcOut), start: round(s.start)})),
      duration: round(storyDuration),
      framing,
      focusX: round(focusX),
      fitZoom: cfg.story.fitZoom,
      kenBurns: cfg.story.kenBurns,
      audioGain: ov.storyAudioGain ?? cfg.audio.storyAudioGain,
      audioFadeAtDropSec: cfg.audio.storyFadeAtDropSec,
      highlight: {srcTime: round(highlight), timelineTime: round(highlightTimeline), source: ov.highlightTime !== undefined ? 'manual' : 'auto'},
    },
    transition: {type: ov.transition ?? cfg.transition.type, at: round(storyDuration), durationSec: round(cfg.transition.durationFrames / fps)},
    outro: {
      variantId: variant.id,
      variantName: variant.name,
      start: round(storyDuration),
      end: round(total),
      fadeOutSec: cfg.outro.fadeOutSec,
      grade: variant.grade,
      overlay: variant.overlay,
      shots,
    },
    texts,
    warnings,
  };
}
