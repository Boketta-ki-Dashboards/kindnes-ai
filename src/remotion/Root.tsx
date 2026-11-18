import React from 'react';
import {Composition, type CalculateMetadataFunction} from 'remotion';
import {KindnessEdit, type KindnessEditProps} from './KindnessEdit';
import type {EditPlan} from '../edit/plan-types';

/** Minimal placeholder plan so Remotion Studio can open the composition without a job. */
const placeholder: EditPlan = {
  schema: 'kindness-ai/edit-plan',
  version: 1,
  jobId: 'placeholder',
  candidateId: 'placeholder',
  createdAt: '1970-01-01T00:00:00Z',
  fps: 30,
  width: 1080,
  height: 1920,
  durationSec: 4,
  music: {src: '', songStart: 46.2, drop: 48.216, outroEnd: 50, songEnd: 50.2, gainDb: -7, fadeInSec: 0, fadeOutSec: 0.2, beatsOnTimeline: []},
  story: {
    src: '',
    sourceDuration: 0,
    segments: [],
    duration: 2,
    framing: 'fit-blur',
    focusX: 0.5,
    fitZoom: 1,
    kenBurns: 0.05,
    audioGain: 0,
    audioFadeAtDropSec: 0.5,
    highlight: {srcTime: 0, timelineTime: 1, source: 'auto'},
  },
  transition: {type: 'flash', at: 2, durationSec: 0.27},
  outro: {variantId: 'none', variantName: 'none', start: 2, end: 4, fadeOutSec: 0.2, grade: 'golden', overlay: 'none', shots: []},
  texts: [],
  warnings: [],
};

const calculateMetadata: CalculateMetadataFunction<KindnessEditProps> = ({props}) => ({
  durationInFrames: Math.max(1, Math.round(props.plan.durationSec * props.plan.fps)),
  fps: props.plan.fps,
  width: props.plan.width,
  height: props.plan.height,
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id="KindnessEdit"
    component={KindnessEdit}
    durationInFrames={120}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{plan: placeholder, media: {}, font: 'Inter'}}
    calculateMetadata={calculateMetadata}
  />
);
