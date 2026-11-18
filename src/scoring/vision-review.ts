/**
 * OPTIONAL content review by a vision model (Claude API).
 *
 * Disabled by default: it is a paid service (≈ 12 frames ≈ 15k input tokens per clip,
 * a few cents with Claude Opus 5.5). Enable it only deliberately via
 * config/pipeline.json -> scoring.visionReview.enabled = true and an API key
 * (ANTHROPIC_API_KEY, or an `ant auth login` profile).
 *
 * The model looks at real frames of the downloaded clip plus measured signals and
 * fills the same 100-point rubric. The result is stored as data/reviews/<id>.json,
 * exactly like a human review, so it becomes a CONTENT_REVIEWED score.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {betaZodOutputFormat} from '@anthropic-ai/sdk/helpers/beta/zod';
import {z} from 'zod';
import {abs} from '../core/paths.js';
import {nowIso, writeJson} from '../core/fsutil.js';
import type {Candidate} from '../core/types.js';
import type {VideoAnalysis} from '../outro/outro.js';
import {extractFrame} from '../media/ffmpeg.js';
import {RUBRIC, clamp, type CriterionKey} from './rubric.js';
import {reviewPath, type ReviewFile} from './score.js';

const Criterion = z.object({points: z.number(), reasons: z.array(z.string())});
const ReviewSchema = z.object({
  is_kindness_story: z.boolean(),
  summary: z.string(),
  emotional: Criterion,
  clarity: Criterion,
  dropPotential: Criterion,
  visualQuality: Criterion,
  originality: Criterion,
  suggested_highlight_sec: z.number().nullable(),
  suggested_hook_text: z.string().nullable(),
});

export interface VisionReviewOptions {
  model: string;
  frames: number;
  effort: 'low' | 'medium' | 'high';
}

const SYSTEM = `You review short real-life video clips for "Kindness AI", a TikTok channel that posts genuine moments of kindness, respect, fair play and selfless help, cut to music with an emotional anime outro.
Score the clip with this fixed rubric, using only what is visible in the frames and the measured signals:
A emotional (0-35): emotional impact, surprise, humanity, visible reaction, strength of the key moment.
B clarity (0-25): understandable without long explanation, clear beginning and end, context, works as a short video.
C dropPotential (0-20): a clear peak moment that a music drop can hit, convincing transition to an outro.
D visualQuality (0-10): resolution, sharpness, stability, framing, suitability for 9:16.
E originality (0-10): interesting plot, surprising turn, special human moment.
Be strict: staged, scripted, advertising, news-studio, compilation or off-topic material scores low. If the frames do not show a kindness story, say so.
Reasons must describe what you actually see in the frames (with timestamps).`;

export async function visionReview(c: Candidate, analysis: VideoAnalysis, opts: VisionReviewOptions): Promise<ReviewFile> {
  if (!c.media.local?.path) throw new Error(`${c.id}: no local media to review`);
  const file = abs(c.media.local.path);
  const D = analysis.info.durationSec;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-review-'));
  const times = Array.from({length: opts.frames}, (_, i) => ((i + 0.5) / opts.frames) * D);
  for (const h of analysis.highlights?.slice(0, 2) ?? []) times.push(h.time);
  times.sort((a, b) => a - b);

  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  for (const t of times) {
    const jpg = path.join(tmp, `${t.toFixed(2)}.jpg`);
    await extractFrame(file, t, jpg, 768);
    content.push({type: 'text', text: `Frame at ${t.toFixed(1)} s:`});
    content.push({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(jpg).toString('base64')}});
  }
  const loud = (analysis.audio?.halfSecond ?? []).filter((_, i) => i % 2 === 0).map((h) => `${h.t}s:${h.rmsDb.toFixed(0)}dB`).join(' ');
  content.push({
    type: 'text',
    text:
      `Title: ${c.title}\nSource: ${c.platform} ${c.url}\nDescription: ${(c.description ?? '').slice(0, 800)}\n` +
      `Measured: ${analysis.info.width}x${analysis.info.height} @ ${analysis.info.fps} fps, ${D.toFixed(1)} s, ${analysis.cuts.length} hard cuts, ` +
      `audio loudness per second: ${loud || 'no audio'}\n` +
      `Detected peak candidates: ${(analysis.highlights ?? []).map((h) => `${h.time}s`).join(', ') || 'none'}\n` +
      'Score the clip with the rubric.',
  });

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: opts.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: {effort: opts.effort, format: betaZodOutputFormat(ReviewSchema)},
    messages: [{role: 'user', content}],
  });
  fs.rmSync(tmp, {recursive: true, force: true});
  if (response.stop_reason === 'refusal') throw new Error(`model declined the review (${response.stop_details?.category ?? 'no category'})`);
  const r = response.parsed_output;
  if (!r) throw new Error(`no parseable review returned (stop_reason ${response.stop_reason})`);

  const scores = {} as ReviewFile['scores'];
  for (const k of Object.keys(RUBRIC) as CriterionKey[]) {
    scores[k] = {points: clamp(Math.round(r[k].points * 10) / 10, 0, RUBRIC[k].max), reasons: r[k].reasons};
  }
  if (!r.is_kindness_story) scores.emotional.reasons.unshift('model: frames do not show a kindness story');
  const review: ReviewFile & {summary: string; suggestions: Record<string, unknown>; model: string} = {
    candidateId: c.id,
    reviewer: `claude-api:${response.model}`,
    reviewedAt: nowIso(),
    basis: `${times.length} frames of the media file + measured signals`,
    scores,
    summary: r.summary,
    suggestions: {highlightSec: r.suggested_highlight_sec, hookText: r.suggested_hook_text},
    model: response.model,
  };
  writeJson(reviewPath(c.id), review);
  return review;
}
