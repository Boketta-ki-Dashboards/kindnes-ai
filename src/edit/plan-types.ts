/**
 * Edit plan = everything Remotion needs to render one video, in seconds.
 * Pure data, no Node imports: this file is bundled into the Remotion browser code.
 */

export type Framing = 'cover' | 'fit-blur' | 'fit-black';
export type Grade = 'golden' | 'natural' | 'warm-soft';

export interface StorySegment {
  /** Seconds in the source clip. */
  srcIn: number;
  srcOut: number;
  /** Seconds on the output timeline. */
  start: number;
}

export interface OutroShot {
  src: string;
  srcIn: number;
  srcOut: number;
  start: number;
  duration: number;
  framing: Framing;
  focusX: number;
  zoomFrom: number;
  zoomTo: number;
  sourceId: string;
  /** Curated outros only. */
  act?: 'drop' | 'dynamic' | 'emotional' | 'calm';
  tag?: string;
  focusY?: number;
  baseZoom?: number;
  speed?: number;
  effects?: ('impact' | 'blur-in' | 'light')[];
}

export interface DictionaryOptions {
  anchor: 'bottom' | 'top';
  bodyPx: number;
  /** Seconds after the outro start when the fade-in begins. */
  fadeInAt: number;
  highlightIncludesPeriod: boolean;
}

export interface TextOverlay {
  text: string;
  start: number;
  end: number;
  style: 'hook' | 'caption' | 'subtitle' | 'drop-caption' | 'definition';
}

export interface EditPlan {
  schema: 'kindness-ai/edit-plan';
  version: 1;
  jobId: string;
  candidateId: string;
  createdAt: string;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  music: {
    src: string;
    songStart: number;
    drop: number;
    outroEnd: number;
    songEnd: number;
    gainDb: number;
    fadeInSec: number;
    fadeOutSec: number;
    /** Beat times on the OUTPUT timeline (for beat-reactive effects). */
    beatsOnTimeline: number[];
  };
  story: {
    src: string;
    sourceDuration: number;
    segments: StorySegment[];
    duration: number;
    framing: Framing;
    focusX: number;
    fitZoom: number;
    kenBurns: number;
    audioGain: number;
    audioFadeAtDropSec: number;
    highlight: {srcTime: number; timelineTime: number; source: 'auto' | 'manual'};
  };
  transition: {type: 'hard-cut' | 'flash' | 'dissolve' | 'zoom-punch'; at: number; durationSec: number};
  outro: {
    variantId: string;
    variantName: string;
    start: number;
    end: number;
    fadeOutSec: number;
    grade: Grade;
    overlay: 'none' | 'definition' | 'caption' | 'dictionary';
    dictionary?: DictionaryOptions;
    shots: OutroShot[];
  };
  texts: TextOverlay[];
  warnings: string[];
}

/** TikTok UI safe area for 1080x1920 (pixels kept free of text). */
export const SAFE_AREA = {top: 220, bottom: 420, left: 60, right: 150};
