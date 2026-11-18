import React from 'react';
import {AbsoluteFill, OffthreadVideo} from 'remotion';
import type {Framing} from '../../edit/plan-types';

/**
 * Places any source (16:9, square, 9:16) into the 1080x1920 frame.
 *  - cover:     fill the frame, crop around focusX (horizontal point of interest)
 *  - fit-blur:  whole image visible, blurred + darkened copy fills the background
 *  - fit-black: whole image visible on black
 */
export const FramedVideo: React.FC<{
  src: string;
  trimBefore: number; // frames
  framing: Framing;
  focusX: number;
  scale: number;
  fitZoom?: number;
  volume?: number | ((f: number) => number);
  muted?: boolean;
  filter?: string;
}> = ({src, trimBefore, framing, focusX, scale, fitZoom = 1, volume, muted, filter}) => {
  const objectPosition = `${Math.round(Math.min(1, Math.max(0, focusX)) * 100)}% 50%`;
  const common = {src, trimBefore, pauseWhenBuffering: false} as const;
  if (framing === 'cover') {
    return (
      <AbsoluteFill style={{overflow: 'hidden', filter}}>
        <OffthreadVideo
          {...common}
          muted={muted}
          volume={volume}
          style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition, transform: `scale(${scale})`}}
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
