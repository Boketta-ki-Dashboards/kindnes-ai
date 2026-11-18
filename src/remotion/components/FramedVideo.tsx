import React from 'react';
import {AbsoluteFill, OffthreadVideo} from 'remotion';
import type {Framing} from '../../edit/plan-types';

/** Where a lifted face should end up (fraction of frame height, upper half). */
const FACE_TARGET_Y = 0.42;

/**
 * Places any source (16:9, square, 9:16) into the 1080x1920 frame.
 *  - cover:     fill the frame, crop around focusX (horizontal point of interest);
 *               with scale > 1 and focusY the face is lifted towards the upper half
 *               (never far enough to reveal an edge)
 *  - fit-blur:  whole image visible, blurred + darkened copy fills the background
 *  - fit-black: whole image visible on black
 */
export const FramedVideo: React.FC<{
  src: string;
  trimBefore: number; // frames
  framing: Framing;
  focusX: number;
  focusY?: number;
  scale: number;
  fitZoom?: number;
  volume?: number | ((f: number) => number);
  muted?: boolean;
  filter?: string;
  playbackRate?: number;
}> = ({src, trimBefore, framing, focusX, focusY, scale, fitZoom = 1, volume, muted, filter, playbackRate}) => {
  const objectPosition = `${Math.round(Math.min(1, Math.max(0, focusX)) * 100)}% 50%`;
  const common = {src, trimBefore, pauseWhenBuffering: false, playbackRate: playbackRate ?? 1} as const;
  if (framing === 'cover') {
    // vertical lift: after scaling about the centre, move focusY towards FACE_TARGET_Y,
    // limited to the extra height gained by the zoom so no edge ever becomes visible
    let ty = 0;
    if (focusY !== undefined && scale > 1) {
      const after = 0.5 + (focusY - 0.5) * scale;
      const max = (scale - 1) / 2;
      ty = Math.max(-max, Math.min(max, FACE_TARGET_Y - after)) * 100;
    }
    return (
      <AbsoluteFill style={{overflow: 'hidden', filter}}>
        <OffthreadVideo
          {...common}
          muted={muted}
          volume={volume}
          style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition, transform: `translateY(${ty}%) scale(${scale})`}}
        />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: 'black', filter}}>
      {framing === 'fit-blur' ? (
        <AbsoluteFill style={{transform: 'scale(1.25)', filter: 'blur(38px) brightness(0.55) saturate(1.15)'}}>
          <OffthreadVideo {...common} muted style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition}} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{transform: `scale(${scale * fitZoom})`}}>
        <OffthreadVideo {...common} muted={muted} volume={volume} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
