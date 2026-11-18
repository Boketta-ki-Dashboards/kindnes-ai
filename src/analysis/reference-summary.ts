import fs from 'node:fs';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {readJson, writeJson} from '../core/fsutil.js';
import type {VideoAnalysis} from '../outro/outro.js';
import type {BeatMap} from '../music/beatmap.js';
import {nearestBeat} from '../music/beatmap.js';

interface SongMatch {
  segments: {mediaStart: number; mediaEnd: number; songStart: number; songEnd: number; offset: number; meanSimilarity: number}[];
}

/**
 * Derive the edit structure of every reference video from the stored analyses:
 * where the song starts, when the cut to the anime outro happens (in video and song
 * time), how long story/outro are and how fast the outro is cut relative to the beat.
 */
export function summarizeReferences(beatmap: BeatMap): Record<string, unknown> {
  const dir = path.join(PATHS.analysis, 'references');
  const out: Record<string, unknown>[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.video.json')).sort()) {
    const base = f.replace('.video.json', '');
    const v = readJson<VideoAnalysis>(path.join(dir, f));
    const sm = readJson<SongMatch>(path.join(dir, `${base}.songmatch.json`));
    const main = [...sm.segments].sort((a, b) => b.mediaEnd - b.mediaStart - (a.mediaEnd - a.mediaStart))[0];
    if (!main) {
      out.push({id: base, note: 'song not found'});
      continue;
    }
    // transition = first hard cut whose song time is near the outro drop region (46.5-50 s),
    // else the biggest warmth jump (dissolves are invisible to the cut detector)
    let transition: number | null = null;
    let method = 'hard cut';
    const segOf = (t: number) => sm.segments.find((s) => t >= s.mediaStart - 0.5 && t <= s.mediaEnd + 0.5) ?? main;
    for (const c of v.cuts) {
      const st = c.time + segOf(c.time).offset;
      if (st > 46.5 && st < 50) {
        transition = c.time;
        break;
      }
    }
    if (transition === null) {
      const w = v.perSecond.warmth;
      let best = -1;
      let bi = -1;
      for (let i = 1; i < w.length; i++) {
        const st = i + main.offset;
        if (st > 46 && st < 50.5 && w[i] - w[i - 1] > best) {
          best = w[i] - w[i - 1];
          bi = i;
        }
      }
      if (bi > 0) {
        transition = bi;
        method = 'colour jump (dissolve)';
      }
    }
    const tSong = transition !== null ? transition + segOf(transition).offset : null;
    const black = v.blackSegments.find((b) => transition !== null && b.start > transition);
    const outroEndMedia = black ? black.start : main.mediaEnd;
    const outroCuts = v.cuts.filter((c) => transition !== null && c.time > transition + 0.1 && c.time < outroEndMedia).map((c) => c.time);
    const intervals = outroCuts.slice(1).map((t, i) => t - outroCuts[i]);
    const leads = outroCuts.map((t) => {
      const st = t + segOf(t).offset;
      return nearestBeat(beatmap.beats, st) - st;
    });
    const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    out.push({
      id: base,
      resolution: `${v.info.width}x${v.info.height}`,
      fps: v.info.fps,
      durationSec: v.info.durationSec,
      songOffsetSec: main.offset,
      songStartsAt: main.songStart,
      songSimilarity: main.meanSimilarity,
      transitionVideoSec: transition,
      transitionSongSec: tSong !== null ? Number(tSong.toFixed(3)) : null,
      transitionMethod: method,
      nearestDownbeat: tSong !== null ? nearestBeat(beatmap.downbeats, tSong) : null,
      storyDurationSec: transition !== null ? Number((transition - Math.max(0, main.mediaStart)).toFixed(2)) : null,
      outroEndVideoSec: outroEndMedia,
      outroDurationSec: transition !== null ? Number((outroEndMedia - transition).toFixed(2)) : null,
      outroCutCount: outroCuts.length,
      outroMedianCutIntervalSec: median(intervals),
      outroMedianCutIntervalBeats: median(intervals) !== null ? Number((median(intervals)! / beatmap.beatPeriodSec).toFixed(2)) : null,
      outroMedianCutLeadBeforeBeatSec: median(leads) !== null ? Number(median(leads)!.toFixed(3)) : null,
      storyCutsPerMinute: transition ? Number(((v.cuts.filter((c) => c.time < transition!).length / transition) * 60).toFixed(1)) : null,
      color: (v as unknown as {color: unknown}).color,
    });
  }
  const songTimes = out.map((r) => r.transitionSongSec).filter((x): x is number => typeof x === 'number');
  const summary = {
    schema: 'kindness-ai/reference-summary',
    createdAt: new Date().toISOString(),
    references: out,
    consensus: {
      transitionSongSecMedian: median(songTimes),
      transitionSongSecRange: songTimes.length ? [Math.min(...songTimes), Math.max(...songTimes)] : null,
    },
  };
  writeJson(path.join(PATHS.analysis, 'reference-summary.json'), summary);
  return summary;
  function median(a: number[]) {
    return a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  }
}
