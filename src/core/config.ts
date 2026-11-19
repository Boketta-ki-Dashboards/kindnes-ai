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
    /** Music level in the outro (from the drop on), before loudness normalisation. */
    musicGainDb: z.number().default(-7),
    /** Music under the story: quiet start, slightly higher body, build-up into the drop. */
    storyMusic: z
      .object({
        startDb: z.number().default(-20),
        bodyDb: z.number().default(-18),
        /** Seconds from the story start until the body level is reached. */
        riseSec: z.number().default(4),
        fadeInSec: z.number().default(0.4),
        /** Build-up length in beats before the drop (6 beats ≈ 2.6 s at 139.7 BPM). */
        buildUpBeats: z.number().int().min(1).max(16).default(6),
      })
      .default({startDb: -20, bodyDb: -18, riseSec: 4, fadeInSec: 0.4, buildUpBeats: 6}),
    /** Automatic ducking of the music while people speak in the story. */
    ducking: z
      .object({
        enabled: z.boolean().default(true),
        depthDb: z.number().default(6),
        attackSec: z.number().default(0.15),
        releaseSec: z.number().default(0.45),
        holdSec: z.number().default(0.15),
      })
      .default({enabled: true, depthDb: 6, attackSec: 0.15, releaseSec: 0.45, holdSec: 0.15}),
    /** Mute the clip's own audio when it already contains "Meant to Be" (avoids double / phase-shifted music). */
    muteStoryIfSongDetected: z.boolean().default(true),
    songDetectSimilarity: z.number().default(0.85),
    storyAudioGain: z.number().min(0).max(2).default(0.9),
    /** 'auto' levels the clip's own sound so speech sits at targetSpeechRmsDb (quiet recordings are raised). */
    storyLevel: z
      .object({
        mode: z.enum(['auto', 'fixed']).default('auto'),
        targetSpeechRmsDb: z.number().default(-20),
        minGainDb: z.number().default(-6),
        maxGainDb: z.number().default(12),
      })
      .default({mode: 'auto', targetSpeechRmsDb: -20, minGainDb: -6, maxGainDb: 12}),
    storyFadeAtDropSec: z.number().default(0.5),
    musicFadeInSec: z.number().default(0.3),
    targetLufs: z.number().default(-14),
    /** Loudness normalisation measures this part and applies one static gain to the whole video. */
    normalizeOn: z.enum(['outro', 'whole']).default('outro'),
  }),
  outro: z.object({
    /** Visual repetition control (python/kindness_analysis/shotsim.py). */
    repetition: z
      .object({
        framesPerShot: z.number().int().min(2).max(12).default(5),
        /** 'error' blocks a production with duplicate shots, 'warning' only reports. */
        severity: z.enum(['error', 'warning']).default('warning'),
        thresholds: z
          .object({
            duplicateSsim: z.number().default(0.72),
            duplicateHash: z.number().default(8),
            similarSsim: z.number().default(0.55),
            similarHash: z.number().default(14),
            similarLayout: z.number().default(0.93),
            sameTakeSec: z.number().default(4),
            minGapShots: z.number().default(3),
            takeSsim: z.number().default(0.4),
            takeHash: z.number().default(20),
            takeLayout: z.number().default(0.8),
          })
          .default({duplicateSsim: 0.72, duplicateHash: 8, similarSsim: 0.55, similarHash: 14, similarLayout: 0.93, sameTakeSec: 4, minGapShots: 3, takeSsim: 0.4, takeHash: 20, takeLayout: 0.8}),
      })
      .default({
        framesPerShot: 5,
        severity: 'warning',
        thresholds: {duplicateSsim: 0.72, duplicateHash: 8, similarSsim: 0.55, similarHash: 14, similarLayout: 0.93, sameTakeSec: 4, minGapShots: 3, takeSsim: 0.4, takeHash: 20, takeLayout: 0.8},
      }),
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
    /** Dictionary-definition overlay (outro V3, version A2). */
    dictionary: z
      .object({
        anchor: z.enum(['bottom', 'top']).default('bottom'),
        bodyPx: z.number().default(36),
        /** Seconds after the drop at which the definition starts fading in (V4: 0.30). */
        fadeInDelaySec: z.number().min(0.05).default(0.3),
        /** Fade-in duration in seconds (V4: 0.25). The fade-out is unchanged. */
        fadeInDurationSec: z.number().min(0.05).default(0.25),
        /** The reference highlight ends right after "rewards" (period not highlighted). */
        highlightIncludesPeriod: z.boolean().default(false),
      })
      .default({anchor: 'bottom', bodyPx: 36, fadeInDelaySec: 0.3, fadeInDurationSec: 0.25, highlightIncludesPeriod: false}),
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
export const ShotEffect = z.enum(['impact', 'blur-in', 'light']);
export const CuratedShotSchema = z.object({
  source: z.string(),
  /** Source time (s) where the shot starts. */
  at: z.number(),
  beats: z.number().int().min(1),
  act: z.enum(['drop', 'dynamic', 'emotional', 'calm']),
  tag: z.string(),
  /** Motif label from viewing the frames; shots with the same motif count as repetitions. */
  motif: z.string().optional(),
  focusX: z.number().min(0).max(1),
  /** Vertical point of interest (0..1); lifted towards the upper half when baseZoom > 1. */
  focusY: z.number().min(0).max(1).optional(),
  baseZoom: z.number().min(1).max(1.5).optional(),
  /** Playback speed (< 1 = slow motion, used for the calm ending). */
  speed: z.number().min(0.5).max(1.5).optional(),
  effects: z.array(ShotEffect).optional(),
  note: z.string().optional(),
});
export type CuratedShot = z.infer<typeof CuratedShotSchema>;

export const OutroVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  sources: z.array(z.string()),
  beatsPerShot: z.array(z.number().int()).min(1),
  framing: FramingMode,
  zoom: z.tuple([z.number(), z.number()]),
  grade: z.enum(['golden', 'natural', 'warm-soft']),
  overlay: z.enum(['none', 'definition', 'caption', 'dictionary']).default('none'),
  shotOrder: z.enum(['score', 'chronological']).default('score'),
  /** Hand-curated shot list (from viewed frames). Overrides automatic shot selection. */
  curated: z.array(CuratedShotSchema).optional(),
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
