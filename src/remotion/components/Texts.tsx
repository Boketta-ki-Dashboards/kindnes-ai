import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {SAFE_AREA, type TextOverlay} from '../../edit/plan-types';

const shadow = '0 2px 6px rgba(0,0,0,0.85), 0 0 24px rgba(0,0,0,0.45)';

/** One overlay; `frame` is relative to the overlay start. */
const Overlay: React.FC<{t: TextOverlay; font: string; captionTop?: number}> = ({t, font, captionTop = 0.56}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dur = Math.max(1, Math.round((t.end - t.start) * fps));
  const fadeIn = Math.min(8, Math.floor(dur / 3));
  const opacity = interpolate(frame, [0, fadeIn, dur - fadeIn, dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const lift = interpolate(frame, [0, fadeIn], [12, 0], {extrapolateRight: 'clamp'});
  const box: React.CSSProperties = {
    position: 'absolute',
    left: SAFE_AREA.left,
    right: SAFE_AREA.right,
    display: 'flex',
    justifyContent: 'center',
    textAlign: 'center',
    opacity,
    transform: `translateY(${lift}px)`,
    fontFamily: font,
    color: 'white',
    textShadow: shadow,
  };
  if (t.style === 'hook') {
    return (
      <div style={{...box, top: SAFE_AREA.top + 20, fontSize: 64, fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.5}}>
        <span style={{background: 'rgba(0,0,0,0.35)', padding: '14px 26px', borderRadius: 18}}>{t.text}</span>
      </div>
    );
  }
  if (t.style === 'subtitle' || t.style === 'caption') {
    return (
      <div style={{...box, bottom: SAFE_AREA.bottom + 90, fontSize: 52, fontWeight: 700, lineHeight: 1.2}}>
        <span>{t.text}</span>
      </div>
    );
  }
  if (t.style === 'drop-caption') {
    return (
      <div style={{...box, top: 1920 * captionTop, fontSize: 84, fontWeight: 700, letterSpacing: 0.5}}>
        <span>{t.text}</span>
      </div>
    );
  }
  return null;
};

export const Texts: React.FC<{texts: TextOverlay[]; font: string; captionTop?: number}> = ({texts, font, captionTop}) => {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {texts.map((t, i) => {
        const from = Math.round(t.start * fps);
        const to = Math.round(t.end * fps);
        if (frame < from || frame >= to) return null;
        return (
          <FrameShift key={i} offset={from}>
            <Overlay t={t} font={font} captionTop={captionTop} />
          </FrameShift>
        );
      })}
    </AbsoluteFill>
  );
};

/** Lightweight local-time wrapper (Sequence without layout side effects). */
const FrameShift: React.FC<{offset: number; children: React.ReactNode}> = ({offset, children}) => (
  <Sequence from={offset} layout="none">
    {children}
  </Sequence>
);

/** Dictionary-style definition card (own design inspired by the reference edits). */
export const DefinitionCard: React.FC<{font: string; durationFrames: number}> = ({font, durationFrames}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [4, 16, durationFrames - 10, durationFrames], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const words = 'showing care for someone else, expecting nothing in return.'.split(' ');
  const shown = Math.floor(interpolate(frame, [14, 14 + words.length * 3], [0, words.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.62) 68%, rgba(0,0,0,0.62) 82%, rgba(0,0,0,0) 100%)'}} />
    <div
      style={{
        position: 'absolute',
        left: SAFE_AREA.left + 20,
        right: SAFE_AREA.right + 10,
        top: 1920 * 0.6,
        fontFamily: font,
        color: 'white',
        textShadow: shadow,
      }}
    >
      <div style={{display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap'}}>
        <span style={{fontSize: 96, fontWeight: 800, letterSpacing: -1.5}}>kindness</span>
        <span style={{fontSize: 38, opacity: 0.85, fontStyle: 'italic'}}>/ˈkaɪnd.nəs/ · noun</span>
      </div>
      <div style={{fontSize: 54, lineHeight: 1.28, marginTop: 18, fontWeight: 600}}>
        {words.map((w, i) => (
          <span key={i} style={{opacity: i < shown ? 1 : 0.0}}>
            {w}{' '}
          </span>
        ))}
      </div>
    </div>
    </AbsoluteFill>
  );
};
