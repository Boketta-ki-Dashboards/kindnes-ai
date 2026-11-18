import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import type {EditPlan, Grade} from '../edit/plan-types';
import {FramedVideo} from './components/FramedVideo';
import {DefinitionCard, Texts} from './components/Texts';

export interface KindnessEditProps {
  plan: EditPlan;
  /** Maps repo-relative media paths to URLs the renderer can fetch. */
  media: Record<string, string>;
  font?: string;
  [key: string]: unknown;
}

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
  let pulse = 0;
  for (const bf of beatFrames) {
    const d = frame - bf;
    if (d >= 0 && d < 6) pulse = Math.max(pulse, 0.018 * (1 - d / 6));
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
  zoomFrom: number;
  zoomTo: number;
  len: number;
  lead: number;
  pulse: number;
  filter: string;
  punch: boolean;
}> = ({src, trimBefore, framing, focusX, zoomFrom, zoomTo, len, lead, pulse, filter, punch}) => {
  const frame = useCurrentFrame();
  let scale = interpolate(frame, [0, len], [zoomFrom, zoomTo], {extrapolateRight: 'clamp', easing: Easing.out(Easing.quad)});
  if (punch) scale *= interpolate(frame, [0, 7], [1.22, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const opacity = lead ? interpolate(frame, [0, lead], [0, 1], {extrapolateRight: 'clamp'}) : 1;
  return (
    <AbsoluteFill style={{opacity}}>
      <FramedVideo src={src} trimBefore={trimBefore} framing={framing} focusX={focusX} scale={scale + pulse} muted filter={filter} />
    </AbsoluteFill>
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

export const KindnessEdit: React.FC<KindnessEditProps> = ({plan, media, font = 'Inter'}) => {
  const {fps} = useVideoConfig();
  const storyFrames = Math.round(plan.story.duration * fps);
  const totalFrames = Math.round(plan.durationSec * fps);
  const m = plan.music;
  const gain = dbToGain(m.gainDb);
  const fadeIn = Math.round(m.fadeInSec * fps);
  const fadeOut = Math.round(m.fadeOutSec * fps);
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
