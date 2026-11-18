import {z} from 'zod';
import {PATHS} from './paths.js';
import {readJson} from './fsutil.js';

export const FramingMode = z.enum(['cover', 'fit-blur', 'fit-black']);
export type FramingMode = z.infer<typeof FramingMode>;

export const PipelineConfigSchema = z.object({
  video: z.object({
    width: z.number().int().default(1080),
    height: z.number().int().default(1920),
    fps: z.number().int().min(12).max(60).default(30),
    crf: z.number().int().min(10).max(35).default(18),
    audioBitrate: z.string().default('192k'),
    x264Preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower']).default('medium'),
  }),
  story: z.object({
    minSec: z.number().default(12),
    maxSec: z.number().default(40),
    reactionHoldSec: z.number().default(2.0),
    framing: FramingMode.default('fit-blur'),
    fitZoom: z.number().default(1.0),
    kenBurns: z.number().default(0.05),
    snapCutsToBeats: z.boolean().default(true),
  }),
  audio: z.object({
    musicGainDb: z.number().default(-7),
    storyAudioGain: z.number().min(0).max(2).default(0.3),
    storyFadeAtDropSec: z.number().default(0.5),
    musicFadeInSec: z.number().default(0.3),
    targetLufs: z.number().default(-14),
  }),
  outro: z.object({
    variant: z.string().default('A'),
    bars: z.number().int().min(1).max(16).default(6),
    fadeOutSec: z.number().default(0.6),
    cutLeadFrames: z.number().int().min(0).max(6).default(2),
  }),
  transition: z.object({
    type: z.enum(['hard-cut', 'flash', 'dissolve', 'zoom-punch']).default('flash'),
    durationFrames: z.number().int().default(8),
  }),
  text: z.object({
    dropCaption: z.string().default('kindness.'),
    showDropCaption: z.boolean().default(true),
    font: z.string().default('Inter'),
  }),
  scoring: z.object({
    threshold: z.number().default(75),
    /** Paid, therefore OFF by default – see src/scoring/vision-review.ts */
    visionReview: z
      .object({
        enabled: z.boolean().default(false),
        model: z.string().default('claude-opus-5-5'),
        frames: z.number().int().min(4).max(24).default(12),
        effort: z.enum(['low', 'medium', 'high']).default('medium'),
        maxPerRun: z.number().int().default(10),
      })
      .default({enabled: false, model: 'claude-opus-5-5', frames: 12, effort: 'medium', maxPerRun: 10}),
  }),
  discovery: z.object({
    maxResultsPerQuery: z.number().int().default(12),
    queriesPerRun: z.number().int().default(10),
    minDurationSec: z.number().default(8),
    maxDurationSec: z.number().default(600),
    adapters: z.record(z.string(), z.object({enabled: z.boolean()})).default({}),
  }),
  acquisition: z.object({
    allowLicensedDownloads: z.boolean().default(true),
    ytDlp: z.object({enabled: z.boolean().default(false), requireCreativeCommons: z.boolean().default(true)}),
    maxDownloadMb: z.number().default(300),
  }),
  render: z.object({
    browserExecutable: z.string().nullable().default(null),
    concurrency: z.number().int().nullable().default(null),
  }),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

export const MusicConfigSchema = z.object({
  track: z.string(),
  title: z.string(),
  beatmap: z.string(),
  drop: z.object({
    auto: z.number(),
    source: z.string(),
    evidence: z.array(z.string()).default([]),
    manualOverride: z.number().nullable().default(null),
  }),
  /** Latest song time a story may start at is drop - story length; earliest is 0. */
  earliestSongStart: z.number().default(0),
});
export type MusicConfig = z.infer<typeof MusicConfigSchema>;

export const OutroSourceSchema = z.object({
  id: z.string(),
  path: z.string(),
  role: z.enum(['source', 'style-reference']),
  description: z.string(),
  usableRanges: z.array(z.tuple([z.number(), z.number()])),
  excludeRanges: z.array(z.tuple([z.number(), z.number()])).default([]),
  useInOutro: z.boolean(),
  /** If this clip is already synced to the song: the song time at clip time 0. */
  syncedSongStart: z.number().optional(),
});
export const OutroVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  sources: z.array(z.string()),
  beatsPerShot: z.array(z.number().int()).min(1),
  framing: FramingMode,
  zoom: z.tuple([z.number(), z.number()]),
  grade: z.enum(['golden', 'natural', 'warm-soft']),
  overlay: z.enum(['none', 'definition', 'caption']).default('none'),
  shotOrder: z.enum(['score', 'chronological']).default('score'),
});
export const AssetsConfigSchema = z.object({
  outroSources: z.array(OutroSourceSchema),
  outroVariants: z.array(OutroVariantSchema),
  approvedOutro: z
    .object({variant: z.string(), approvedAt: z.string(), renderedAsset: z.string().nullable()})
    .nullable()
    .default(null),
});
export type AssetsConfig = z.infer<typeof AssetsConfigSchema>;
export type OutroVariant = z.infer<typeof OutroVariantSchema>;
export type OutroSource = z.infer<typeof OutroSourceSchema>;

export function loadPipelineConfig(file = PATHS.pipelineConfig): PipelineConfig {
  return PipelineConfigSchema.parse(readJson(file));
}
export function loadMusicConfig(file = PATHS.musicConfig): MusicConfig {
  return MusicConfigSchema.parse(readJson(file));
}
export function loadAssetsConfig(file = PATHS.assetsConfig): AssetsConfig {
  return AssetsConfigSchema.parse(readJson(file));
}

/** The drop actually used: manual override wins over the automatic suggestion. */
export function effectiveDrop(m: MusicConfig): number {
  return m.drop.manualOverride ?? m.drop.auto;
}
