import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {RUBRIC, DEFAULT_THRESHOLD} from '../src/scoring/rubric';
import {scoreFromContent, scoreFromMetadata, scoreFromReview, isCompilation} from '../src/scoring/score';
import {candidate, syntheticAnalysis, tmpDir} from './helpers/fixtures';

const ctx = {others: [], producedCategories: [], threshold: 75};

describe('100-point rubric', () => {
  it('uses exactly the weights 35/25/20/10/10 (sum 100)', () => {
    expect(RUBRIC.emotional.max).toBe(35);
    expect(RUBRIC.clarity.max).toBe(25);
    expect(RUBRIC.dropPotential.max).toBe(20);
    expect(RUBRIC.visualQuality.max).toBe(10);
    expect(RUBRIC.originality.max).toBe(10);
    expect(Object.values(RUBRIC).reduce((s, r) => s + r.max, 0)).toBe(100);
    expect(DEFAULT_THRESHOLD).toBe(75);
  });

  it('total is the sum of the criteria and every criterion stays within its maximum', () => {
    const c = candidate({title: 'Stranger pays for elderly woman groceries, she cries tears of joy', durationSec: 45, viewCount: 2_000_000, description: 'heartwarming moment caught on camera'});
    const s = scoreFromMetadata(c, ctx);
    const sum = s.emotional.points + s.clarity.points + s.dropPotential.points + s.visualQuality.points + s.originality.points;
    expect(s.total).toBeCloseTo(sum, 5);
    for (const k of ['emotional', 'clarity', 'dropPotential', 'visualQuality', 'originality'] as const) {
      expect(s[k].points).toBeGreaterThanOrEqual(0);
      expect(s[k].points).toBeLessThanOrEqual(s[k].max);
      expect(s[k].reasons.length).toBeGreaterThan(0);
    }
  });

  it('marks metadata-only scores as provisional', () => {
    const s = scoreFromMetadata(candidate({title: 'Random act of kindness'}), ctx);
    expect(s.analysisLevel).toBe('METADATA_ONLY');
    expect(s.provisional).toBe(true);
  });

  it('content scores are based on measured media and not provisional', () => {
    const c = candidate({title: 'Boy helps elderly man cross the street', durationSec: 30});
    const s = scoreFromContent(c, syntheticAnalysis(30, {width: 1080, height: 1920}), ctx);
    expect(s.analysisLevel).toBe('CONTENT_SIGNALS');
    expect(s.provisional).toBe(false);
    expect(s.visualQuality.reasons.join(' ')).toMatch(/measured 1080x1920/);
  });

  it('penalises compilations and long videos', () => {
    const single = scoreFromMetadata(candidate({title: 'Firefighter saves kitten and the owner cries', durationSec: 40}), ctx);
    const comp = scoreFromMetadata(candidate({title: 'Top 50 acts of kindness compilation #92', durationSec: 900}), ctx);
    expect(isCompilation({title: 'Top 50 acts of kindness compilation #92', durationSec: 900})).toBe(true);
    expect(comp.clarity.points).toBeLessThan(single.clarity.points);
    expect(comp.total).toBeLessThan(single.total);
  });

  it('applies the 75-point threshold exactly (74.9 out, 75 in)', () => {
    const dir = tmpDir();
    const mk = (total: number) => {
      const c = candidate({title: 'x'});
      const file = path.join(dir, `${c.id}.json`);
      // distribute: emotional gets the remainder
      const rest = 25 + 20 + 10 + 10;
      fs.writeFileSync(file, JSON.stringify({candidateId: c.id, reviewer: 'test', reviewedAt: 'now', basis: 'unit test', scores: {emotional: {points: total - rest, reasons: ['t']}, clarity: {points: 25, reasons: ['t']}, dropPotential: {points: 20, reasons: ['t']}, visualQuality: {points: 10, reasons: ['t']}, originality: {points: 10, reasons: ['t']}}}));
      return scoreFromReview(c, ctx, file)!;
    };
    expect(mk(74.9).qualifies).toBe(false);
    expect(mk(75).qualifies).toBe(true);
    expect(mk(75).analysisLevel).toBe('CONTENT_REVIEWED');
  });
});
