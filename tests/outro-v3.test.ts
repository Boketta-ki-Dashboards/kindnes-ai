import {describe, expect, it} from 'vitest';
import {DICTIONARY, dictionaryLines, highlightedText, linesToText} from '../src/outro/dictionary-text';
import {buildV3Plans} from '../src/outro/v3';
import {loadAssetsConfig, loadPipelineConfig} from '../src/core/config';
import {dictionaryHeight, dictionaryTop} from '../src/remotion/components/DictionaryDefinition';
import {SAFE_AREA} from '../src/edit/plan-types';

const SPEC =
  'Kindness is the quality of being friendly, generous, and considerate, often involving acts of care without expecting rewards. It reduces stress, boosts self-esteem, and strengthens relationships by fostering connection. Small, intentional actions like listening, complimenting, or helping others can significantly improve mental well-being and create a positive, contagious impact on communities.';

describe('dictionary definition (version A2)', () => {
  it('uses the requested text word for word, in the nine reference lines', () => {
    expect(DICTIONARY.text).toBe(SPEC);
    const lines = dictionaryLines(false);
    expect(lines).toHaveLength(9);
    expect(linesToText(lines)).toBe(SPEC);
    expect(lines.map((l) => l.map((s) => s.text).join(''))[5]).toBe('intentional actions like listening, complimenting, or');
  });
  it('highlights exactly "the quality … rewards" (not "Kindness is", not the rest)', () => {
    const lines = dictionaryLines(false);
    expect(highlightedText(lines)).toBe('the quality of being friendly, generous, and considerate, often involving acts of care without expecting rewards');
    expect(lines[0][0]).toEqual({text: 'Kindness is ', highlight: false});
    expect(lines[2][1]).toEqual({text: '. It reduces', highlight: false});
    expect(lines.slice(3).flat().every((s) => !s.highlight)).toBe(true);
    // optional variant: period inside the highlight
    expect(highlightedText(dictionaryLines(true)).endsWith('rewards.')).toBe(true);
  });
  it('the card is placed inside the TikTok safe area for both anchors', () => {
    for (const anchor of ['bottom', 'top'] as const) {
      const opts = {anchor, bodyPx: 36, fadeInAt: 0.86, highlightIncludesPeriod: false};
      const top = dictionaryTop(opts);
      expect(top).toBeGreaterThanOrEqual(SAFE_AREA.top);
      expect(top + dictionaryHeight(36)).toBeLessThanOrEqual(1920 - SAFE_AREA.bottom);
    }
  });
});

describe('outro V3 plans', () => {
  const {clean, definition} = buildV3Plans(loadPipelineConfig());
  it('both versions share exactly the same cut, music and timing', () => {
    expect(definition.outro.shots).toEqual(clean.outro.shots);
    expect(definition.music).toEqual(clean.music);
    expect(definition.durationSec).toBe(clean.durationSec);
    expect(clean.music.drop).toBeCloseTo(48.216, 6);
  });
  it('differ only in the text treatment (no double texts)', () => {
    expect(clean.outro.overlay).toBe('none');
    expect(clean.texts.map((t) => t.text)).toEqual(['kindness.']);
    expect(definition.outro.overlay).toBe('dictionary');
    expect(definition.texts).toEqual([]);
    expect(definition.outro.dictionary!.fadeInAt).toBeGreaterThan(0); // appears after the drop
  });
  it('starts with Thorfinn on the drop and ends calm on Thorfinn', () => {
    const shots = clean.outro.shots;
    expect(shots[0].tag).toBe('thorfinn-face');
    expect(shots[0].start).toBeCloseTo(clean.outro.start, 6);
    expect(shots.slice(-3).every((s) => s.act === 'calm')).toBe(true);
    expect(shots.at(-1)!.tag!.startsWith('thorfinn')).toBe(true);
    expect(clean.warnings).toEqual([]);
  });
  it('curated shots stay inside the usable source ranges (no black / logo frames)', () => {
    const assets = loadAssetsConfig();
    for (const s of clean.outro.shots) {
      const src = assets.outroSources.find((x) => x.id === s.sourceId)!;
      expect(src.usableRanges.some(([a, b]) => s.srcIn >= a && s.srcOut <= b)).toBe(true);
    }
  });
});
