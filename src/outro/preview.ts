import type {AssetsConfig, MusicConfig, PipelineConfig} from '../core/config.js';
import {effectiveDrop} from '../core/config.js';
import {nowIso} from '../core/fsutil.js';
import type {BeatMap} from '../music/beatmap.js';
import {beatAfter, beatsBetween} from '../music/beatmap.js';
import type {EditPlan} from '../edit/plan-types.js';
import {planOutro, type VideoAnalysis} from './outro.js';

/**
 * Outro-only preview: `leadIn` seconds of music with a placeholder card (where the
 * story would end), then the drop and the full outro variant.
 */
export function buildOutroPreviewPlan(opts: {
  variantId: string;
  config: PipelineConfig;
  music: MusicConfig;
  beatmap: BeatMap;
  assets: AssetsConfig;
  leadInSec?: number;
  analysisLoader?: (p: string) => VideoAnalysis;
}): EditPlan {
  const {config: cfg, music, beatmap, assets} = opts;
  const variant = assets.outroVariants.find((v) => v.id === opts.variantId);
  if (!variant) throw new Error(`Unknown outro variant ${opts.variantId}`);
  const lead = opts.leadInSec ?? 2.5;
  const drop = effectiveDrop(music);
  const outroEnd = beatAfter(beatmap, drop, cfg.outro.bars * beatmap.meter);
  const songStart = drop - lead;
  const songEnd = outroEnd + cfg.outro.fadeOutSec;
  const {shots, warnings} = planOutro({
    assets,
    variant,
    map: beatmap,
    drop,
    outroEnd,
    fadeOutSec: cfg.outro.fadeOutSec,
    fps: cfg.video.fps,
    cutLeadFrames: cfg.outro.cutLeadFrames,
    analysisLoader: opts.analysisLoader,
  });
  const total = songEnd - songStart;
  return {
    schema: 'kindness-ai/edit-plan',
    version: 1,
    jobId: `outro-preview-${variant.id}`,
    candidateId: 'outro-preview',
    createdAt: nowIso(),
    fps: cfg.video.fps,
    width: cfg.video.width,
    height: cfg.video.height,
    durationSec: Number(total.toFixed(3)),
    music: {
      src: music.track,
      songStart,
      drop,
      outroEnd,
      songEnd,
      gainDb: cfg.audio.musicGainDb,
      fadeInSec: 0.2,
      fadeOutSec: cfg.outro.fadeOutSec,
      beatsOnTimeline: beatsBetween(beatmap.beats, songStart, songEnd).map((b) => Number((b - songStart).toFixed(3))),
    },
    story: {
      src: '',
      sourceDuration: 0,
      segments: [],
      duration: lead,
      framing: 'fit-blur',
      focusX: 0.5,
      fitZoom: 1,
      kenBurns: 0,
      audioGain: 0,
      audioFadeAtDropSec: 0.5,
      highlight: {srcTime: 0, timelineTime: lead, source: 'auto'},
    },
    transition: {type: cfg.transition.type, at: lead, durationSec: cfg.transition.durationFrames / cfg.video.fps},
    outro: {
      variantId: variant.id,
      variantName: variant.name,
      start: lead,
      end: total,
      fadeOutSec: cfg.outro.fadeOutSec,
      grade: variant.grade,
      overlay: variant.overlay,
      shots: shots.map((s) => ({...s, start: Number((s.start + lead).toFixed(3))})),
    },
    texts:
      variant.overlay === 'definition' || !cfg.text.showDropCaption
        ? []
        : [{text: cfg.text.dropCaption, start: lead + 0.15, end: lead + (outroEnd - drop), style: 'drop-caption'}],
    warnings,
  };
}
