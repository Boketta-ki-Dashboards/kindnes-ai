import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {DictionaryOptions} from '../../edit/plan-types';
import {SAFE_AREA} from '../../edit/plan-types';
import {DICTIONARY, dictionaryLines} from '../../outro/dictionary-text';

/**
 * Dictionary-definition card, rebuilt from references/typography/*.webp
 * (Google search dictionary look). All proportions are derived from the measured
 * reference (body 30 px → circle 75 px, title ≈ 1.31×, phonetic ≈ 0.62×,
 * line pitch ≈ 1.76×, highlight box 1.23 em high) and scaled to `bodyPx`.
 * Colours sampled from the reference: highlight #203D95, button #ACC7F5.
 */
export const DICT_STYLE = {
  highlight: '#203D95',
  button: '#ACC7F5',
  icon: '#1F2A37',
  text: '#F5F5F5',
  phonetic: 'rgba(222, 222, 222, 0.82)',
  // all sizes relative to the body font size, measured on dictionary-ref-1_closeup.webp
  circle: 2.12, // 75 px button at a 35.3 px body
  title: 1.24, // "kindness" is ~5 % wider than "Kindness is"
  phoneticSize: 0.75, // pronunciation is ~0.75 × the title width
  pitch: 1.5, // 53 px line pitch
  boxHeight: 1.05, // 37 px highlight bars
  boxPadX: 0.14, // bar starts ~5 px left of the text
  titleGap: 0.93, // 33 px between button and title
  headerToBody: 1.3, // 46 px from button bottom to the first bar
  bodyGrade: 40, // Google Sans GRAD axis: slightly heavier strokes, same width (search UI look)
} as const;

export const FONT_STACK = "'Google Sans', 'KAI Noto IPA', 'Inter', sans-serif";

/** Total height of the card in px (used for placement and safe-area checks). */
export function dictionaryHeight(bodyPx: number): number {
  const s = DICT_STYLE;
  const lines = dictionaryLines(false).length;
  return s.circle * bodyPx + s.headerToBody * bodyPx + lines * s.pitch * bodyPx - (s.pitch - s.boxHeight) * bodyPx * 0.5;
}

export function dictionaryTop(opts: DictionaryOptions, height = 1920): number {
  const h = dictionaryHeight(opts.bodyPx);
  return opts.anchor === 'top' ? SAFE_AREA.top + 30 : height - SAFE_AREA.bottom - 10 - h;
}

const SpeakerIcon: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path fill={DICT_STYLE.icon} d="M3 9v6h4l5 5V4L7 9H3z" />
    <path fill={DICT_STYLE.icon} d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    <path fill={DICT_STYLE.icon} d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);

export const DictionaryCard: React.FC<{opts: DictionaryOptions; frameWidth?: number}> = ({opts}) => {
  const s = DICT_STYLE;
  const b = opts.bodyPx;
  const top = dictionaryTop(opts);
  const circle = s.circle * b;
  const lines = dictionaryLines(opts.highlightIncludesPeriod);
  return (
    <div
      data-kai="dictionary"
      style={{position: 'absolute', left: SAFE_AREA.left + Math.ceil(s.boxPadX * b) + 2, top, fontFamily: FONT_STACK, color: s.text, textShadow: '0 1px 2px rgba(0,0,0,0.35)'}}
    >
      {/* header: button + word + pronunciation */}
      <div style={{display: 'flex', alignItems: 'center', height: circle}}>
        <div style={{width: circle, height: circle, borderRadius: '50%', background: s.button, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none'}}>
          <SpeakerIcon size={circle * 0.46} />
        </div>
        <div style={{marginLeft: s.titleGap * b, display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
          <div style={{fontSize: s.title * b, fontWeight: 700, lineHeight: 1.12, letterSpacing: 0}}>{DICTIONARY.word}</div>
          <div style={{fontSize: s.phoneticSize * b, fontWeight: 400, lineHeight: 1.25, color: s.phonetic, marginTop: 0.12 * b}}>{DICTIONARY.phonetic}</div>
        </div>
      </div>
      {/* body: fixed line breaks exactly as in the reference */}
      <div style={{marginTop: s.headerToBody * b - (s.pitch - s.boxHeight) * b * 0.5, fontSize: b, fontWeight: 400, fontVariationSettings: `'GRAD' ${s.bodyGrade}`}}>
        {lines.map((line, i) => (
          <div key={i} style={{height: s.pitch * b, display: 'flex', alignItems: 'center', whiteSpace: 'pre'}}>
            {line.map((seg, j) =>
              seg.highlight ? (
                <span
                  key={j}
                  data-kai="highlight"
                  style={{
                    display: 'inline-block',
                    background: s.highlight,
                    height: s.boxHeight * b,
                    lineHeight: `${s.boxHeight * b}px`,
                    // bar extends a little to the left of the text (as in the reference) and
                    // ends with the same padding on the right; following text starts after it
                    padding: `0 ${s.boxPadX * b}px`,
                    // only at the start of a line does the bar reach into the left margin;
                    // mid-line (after "Kindness is ") the space before the bar stays visible
                    marginLeft: j === 0 ? -s.boxPadX * b : 0,
                    fontWeight: 500,
                    textShadow: 'none',
                  }}
                >
                  {seg.text}
                </span>
              ) : (
                <span key={j}>{seg.text}</span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/** The card with a calm fade-in / fade-out and the reference-style dimming behind it. */
export const DictionaryOverlay: React.FC<{opts: DictionaryOptions; outroFrames: number; fadeOutStartFrame: number}> = ({opts, outroFrames, fadeOutStartFrame}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const inStart = Math.round(opts.fadeInAt * fps);
  const inEnd = inStart + Math.round(0.4 * fps);
  const outEnd = Math.min(outroFrames, fadeOutStartFrame);
  const outStart = outEnd - Math.round(0.45 * fps);
  const opacity = interpolate(frame, [inStart, inEnd, outStart, outEnd], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (opacity <= 0) return null;
  const top = dictionaryTop(opts);
  const h = dictionaryHeight(opts.bodyPx);
  const dimTop = Math.max(0, top - 140);
  const dimBottom = Math.min(1920, top + h + 60);
  const stops =
    opts.anchor === 'bottom'
      ? `linear-gradient(180deg, rgba(0,0,0,0) ${dimTop}px, rgba(0,0,0,0.42) ${top + 30}px, rgba(0,0,0,0.42) ${dimBottom - 60}px, rgba(0,0,0,0.22) 1920px)`
      : `linear-gradient(180deg, rgba(0,0,0,0.3) 0px, rgba(0,0,0,0.42) ${top + 30}px, rgba(0,0,0,0.42) ${top + h}px, rgba(0,0,0,0) ${dimBottom + 120}px)`;
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: stops}} />
      <DictionaryCard opts={opts} />
    </AbsoluteFill>
  );
};
