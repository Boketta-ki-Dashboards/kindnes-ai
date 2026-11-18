import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig, Easing, continueRender, delayRender} from 'remotion';
import type {EditPlan, Grade, OutroShot} from '../edit/plan-types';
import {FramedVideo} from './components/FramedVideo';
import {DefinitionCard, Texts} from './components/Texts';
import {DictionaryCard, DictionaryOverlay} from './components/DictionaryDefinition';

export interface KindnessEditProps {
  plan: EditPlan;
  /** Maps repo-relative media paths to URLs the renderer can fetch. */
  media: Record<string, string>;
  font?: string;
  /** Font files served next to the media (Google Sans, Noto Sans IPA subset). */
  fonts?: {googleSans?: string; notoIpa?: string};
  /** QC helper: render only text overlays on black (safe-area measurement). */
  overlayOnly?: boolean;
  [key: string]: unknown;
}

/** Load the bundled fonts once per tab before the first frame is captured. */
const useBundledFonts = (fonts?: {googleSans?: string; notoIpa?: string}) => {
  const [handle] = React.useState(() => (fonts?.googleSans || fonts?.notoIpa ? delayRender('loading fonts') : null));
  React.useEffect(() => {
    if (handle === null) return;
    const faces: FontFace[] = [];
    if (fonts?.googleSans) faces.push(new FontFace('Google Sans', `url(${fonts.googleSans})`, {weight: '400 700'}));
    if (fonts?.notoIpa) faces.push(new FontFace('KAI Noto IPA', `url(${fonts.notoIpa})`, {weight: '400 700'}));
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => {
        loaded.forEach((f) => (document.fonts as unknown as {add: (x: FontFace) => void}).add(f));
        continueRender(handle);
      })
      .catch((e) => {
        console.error('font loading failed', e);
        continueRender(handle);
      });
  }, [handle, fonts?.googleSans, fonts?.notoIpa]);
};

/** Beat-pulse strength per dramaturgical act (curated outros). */
const PULSE: Record<NonNullable<OutroShot['act']> | 'default', number> = {drop: 0.022, dynamic: 0.022, emotional: 0.015, calm: 0.006, default: 0.018};

const GRADES: Record<Grade, string> = {
  golden: 'sepia(0.12) saturate(1.12) contrast(1.06)',
  'warm-soft': 'sepia(0.08) saturate(1.06) contrast(1.0) brightness(1.02)',
  natural: 'none',
};

const dbToGain = (db: number) => Math.pow(10, db / 20);

const url = (media: Record<string, string>, src: string) => media[src] ?? src;

const Story: React.FC<{plan: EditPlan; media: Record<string, string>}> = ({plan, media}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = plan.story;
  const storyFrames = Math.round(s.duration * fps);
  // slow push-in over the whole story; a little faster after the emotional peak
  const hl = Math.round(s.highlight.timelineTime * fps);
  const scale = interpolate(frame, [0, Math.max(1, hl), Math.max(hl + 1, storyFrames)], [1, 1 + s.kenBurns * 0.7, 1 + s.kenBurns], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeFrames = Math.max(1, Math.round(s.audioFadeAtDropSec * fps));
  if (!s.segments.length) {
    return (
      <AbsoluteFill style={{background: 'linear-gradient(180deg, #3a352c, #2a261f)', justifyContent: 'center', alignItems: 'center'}}>
        <div style={{color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter', fontSize: 46, textAlign: 'center'}}>
          Story-Clip
          <br />
          <span style={{fontSize: 34}}>endet hier → Drop</span>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      {s.segments.map((seg, i) => {
        const from = Math.round(seg.start * fps);
        const next = s.segments[i + 1];
        const to = next ? Math.round(next.start * fps) : storyFrames;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, to - from)}>
            <FramedVideo
              src={url(media, s.src)}
              trimBefore={Math.round(seg.srcIn * fps)}
              framing={s.framing}
              focusX={s.focusX}
              scale={scale}
              fitZoom={s.fitZoom}
              volume={(f) => {
                const global = from + f;
                const fade = interpolate(global, [storyFrames - fadeFrames, storyFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
                return s.audioGain * fade;
              }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Outro: React.FC<{plan: EditPlan; media: Record<string, string>; font: string}> = ({plan, media, font}) => {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame(); // relative to outro start
  const o = plan.outro;
  const outroFrames = Math.round((o.end - o.start) * fps);
  // beat pulse: small zoom bump on every beat inside the outro
  const beatFrames = plan.music.beatsOnTimeline.filter((b) => b >= o.start - 1e-3).map((b) => Math.round((b - o.start) * fps));
  const active = [...o.shots].reverse().find((sh) => frame >= Math.round((sh.start - o.start) * fps));
  const amp = PULSE[active?.act ?? 'default'];
  let pulse = 0;
  for (const bf of beatFrames) {
    const d = frame - bf;
    if (d >= 0 && d < 6) pulse = Math.max(pulse, amp * (1 - d / 6));
  }
  const fadeOut = interpolate(frame, [outroFrames - Math.round(o.fadeOutSec * fps), outroFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const dissolve = plan.transition.type === 'dissolve' ? Math.round(plan.transition.durationSec * fps) : 0;
  return (
    <AbsoluteFill style={{opacity: fadeOut, backgroundColor: 'black'}}>
      {o.shots.map((shot, i) => {
        const from = Math.round((shot.start - o.start) * fps);
        const next = o.shots[i + 1];
        const to = next ? Math.round((next.start - o.start) * fps) : outroFrames;
        const len = Math.max(1, to - from);
        const lead = i === 0 ? dissolve : 0;
        return (
          <Sequence key={i} from={from - lead} durationInFrames={len + lead}>
            <ShotLayer
              src={url(media, shot.src)}
              trimBefore={Math.max(0, Math.round(shot.srcIn * fps) - lead)}
              framing={shot.framing}
              focusX={shot.focusX}
              focusY={shot.focusY}
              baseZoom={shot.baseZoom ?? 1}
              speed={shot.speed ?? 1}
              effects={shot.effects ?? []}
              zoomFrom={shot.zoomFrom}
              zoomTo={shot.zoomTo}
              len={len + lead}
              lead={lead}
              pulse={pulse}
              filter={GRADES[o.grade]}
              punch={i === 0 && plan.transition.type === 'zoom-punch'}
            />
          </Sequence>
        );
      })}
      {/* vignette for the cinematic anime look */}
      <AbsoluteFill style={{background: 'radial-gradient(ellipse 120% 90% at center, rgba(0,0,0,0) 62%, rgba(0,0,0,0.32) 100%)'}} />
      {o.overlay === 'dictionary' && o.dictionary ? (
        <DictionaryOverlay opts={o.dictionary} outroFrames={outroFrames} fadeOutStartFrame={outroFrames - Math.round(o.fadeOutSec * fps)} />
      ) : null}
      {o.overlay === 'definition' ? (
        <Sequence from={Math.round(0.1 * fps)} durationInFrames={Math.max(1, outroFrames - Math.round(0.1 * fps))}>
          <DefinitionCard font={font} durationFrames={Math.max(1, outroFrames - Math.round(0.1 * fps) - Math.round(o.fadeOutSec * fps))} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const ShotLayer: React.FC<{
  src: string;
  trimBefore: number;
  framing: EditPlan['outro']['shots'][number]['framing'];
  focusX: number;
  focusY?: number;
  baseZoom: number;
  speed: number;
  effects: NonNullable<OutroShot['effects']>;
  zoomFrom: number;
  zoomTo: number;
  len: number;
  lead: number;
  pulse: number;
  filter: string;
  punch: boolean;
}> = ({src, trimBefore, framing, focusX, focusY, baseZoom, speed, effects, zoomFrom, zoomTo, len, lead, pulse, filter, punch}) => {
  const frame = useCurrentFrame();
  let scale = baseZoom * interpolate(frame, [0, len], [zoomFrom, zoomTo], {extrapolateRight: 'clamp', easing: Easing.out(Easing.quad)});
  if (punch) scale *= interpolate(frame, [0, 7], [1.22, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  let extra = '';
  // impact: short zoom-in punch + brightness pop on the cut
  if (effects.includes('impact')) {
    scale *= interpolate(frame, [0, 6], [1.07, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
    const b = interpolate(frame, [0, 5], [1.3, 1], {extrapolateRight: 'clamp'});
    if (b > 1.001) extra += ` brightness(${b.toFixed(3)}) contrast(${(1 + (b - 1) * 0.3).toFixed(3)})`;
  }
  // blur-in: soft motion-blur style transition into the shot
  if (effects.includes('blur-in')) {
    const bl = interpolate(frame, [0, 4], [9, 0], {extrapolateRight: 'clamp', easing: Easing.out(Easing.quad)});
    if (bl > 0.05) extra += ` blur(${bl.toFixed(2)}px) brightness(${(1 + bl / 70).toFixed(3)})`;
    scale *= interpolate(frame, [0, 4], [1.03, 1], {extrapolateRight: 'clamp'});
  }
  const opacity = lead ? interpolate(frame, [0, lead], [0, 1], {extrapolateRight: 'clamp'}) : 1;
  return (
    <AbsoluteFill style={{opacity}}>
      <FramedVideo
        src={src}
        trimBefore={trimBefore}
        framing={framing}
        focusX={focusX}
        focusY={focusY}
        scale={scale + pulse}
        muted
        filter={`${filter === 'none' ? '' : filter}${extra}`.trim() || undefined}
        playbackRate={speed}
      />
      {effects.includes('light') ? <LightAccent /> : null}
    </AbsoluteFill>
  );
};

/** Warm light-leak sweeping across the frame at the start of a shot (screen blend). */
const LightAccent: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 4, 14], [0, 0.55, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (o <= 0) return null;
  const x = interpolate(frame, [0, 14], [15, 85], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill
      style={{
        opacity: o,
        mixBlendMode: 'screen',
        background: `radial-gradient(ellipse 55% 70% at ${x}% 35%, rgba(255,214,140,0.95) 0%, rgba(255,170,70,0.45) 35%, rgba(255,140,40,0) 70%)`,
      }}
    />
  );
};

const Flash: React.FC<{plan: EditPlan}> = ({plan}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (plan.transition.type !== 'flash') return null;
  const at = Math.round(plan.transition.at * fps);
  const d = Math.max(2, Math.round(plan.transition.durationSec * fps));
  const opacity = interpolate(frame, [at - 2, at, at + d], [0, 0.92, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (opacity <= 0) return null;
  return <AbsoluteFill style={{backgroundColor: '#fff6dc', opacity}} />;
};

export const KindnessEdit: React.FC<KindnessEditProps> = ({plan, media, font = 'Inter', fonts, overlayOnly}) => {
  const {fps} = useVideoConfig();
  useBundledFonts(fonts);
  const storyFrames = Math.round(plan.story.duration * fps);
  const totalFrames = Math.round(plan.durationSec * fps);
  const m = plan.music;
  const gain = dbToGain(m.gainDb);
  const fadeIn = Math.round(m.fadeInSec * fps);
  const fadeOut = Math.round(m.fadeOutSec * fps);
  if (overlayOnly) {
    // QC: only the text layers, on black, so their pixel extent can be measured
    const o = plan.outro;
    const outroFrames = Math.round((o.end - o.start) * fps);
    return (
      <AbsoluteFill style={{backgroundColor: 'black'}}>
        <Sequence from={storyFrames} durationInFrames={Math.max(1, totalFrames - storyFrames)}>
          {o.overlay === 'dictionary' && o.dictionary ? (
            <AbsoluteFill>
              <DictionaryOverlayNoDim plan={plan} outroFrames={outroFrames} />
            </AbsoluteFill>
          ) : null}
        </Sequence>
        <Texts texts={plan.texts} font={font} captionTop={0.56} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      <Sequence durationInFrames={Math.max(1, storyFrames)}>
        <Story plan={plan} media={media} />
      </Sequence>
      <Sequence from={storyFrames} durationInFrames={Math.max(1, totalFrames - storyFrames)}>
        <Outro plan={plan} media={media} font={font} />
      </Sequence>
      <Flash plan={plan} />
      <Texts texts={plan.texts} font={font} captionTop={plan.outro.shots[0]?.framing === 'cover' && !plan.outro.shots[0]?.src.endsWith('#fitblur') ? 0.56 : 0.7} />
      <Audio
        src={url(media, m.src)}
        trimBefore={Math.round(m.songStart * fps)}
        volume={(f) => {
          const inGain = fadeIn > 0 ? interpolate(f, [0, fadeIn], [0, 1], {extrapolateRight: 'clamp'}) : 1;
          const outGain = interpolate(f, [totalFrames - fadeOut, totalFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return gain * inGain * outGain;
        }}
      />
    </AbsoluteFill>
  );
};

/** Dictionary card without the dimming gradient (for the overlay-only QC render). */
const DictionaryOverlayNoDim: React.FC<{plan: EditPlan; outroFrames: number}> = ({plan}) =>
  plan.outro.dictionary ? <DictionaryCard opts={plan.outro.dictionary} /> : null;
