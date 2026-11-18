/**
 * Dictionary definition for the "kindness" outro (version A2).
 * Text and line breaks follow references/typography/dictionary-ref-2_layout.webp word
 * for word. Pure data – shared by the Remotion component and the tests.
 */
export const DICTIONARY = {
  word: 'kindness',
  phonetic: '/kʌɪn(d)nɪs/',
  text:
    'Kindness is the quality of being friendly, generous, and considerate, often involving acts of care without expecting rewards. ' +
    'It reduces stress, boosts self-esteem, and strengthens relationships by fostering connection. ' +
    'Small, intentional actions like listening, complimenting, or helping others can significantly improve mental well-being ' +
    'and create a positive, contagious impact on communities.',
  /** The blue-highlighted part (as in the reference: ends right after "rewards"). */
  highlight: 'the quality of being friendly, generous, and considerate, often involving acts of care without expecting rewards',
} as const;

export interface Segment {
  text: string;
  highlight: boolean;
}

/** The nine lines of the reference, with the highlighted segments marked. */
export function dictionaryLines(highlightIncludesPeriod: boolean): Segment[][] {
  const end = highlightIncludesPeriod ? 'rewards.' : 'rewards';
  const rest = highlightIncludesPeriod ? ' It reduces' : '. It reduces';
  return [
    [
      {text: 'Kindness is ', highlight: false},
      {text: 'the quality of being friendly,', highlight: true},
    ],
    [{text: 'generous, and considerate, often involving acts', highlight: true}],
    [
      {text: `of care without expecting ${end}`, highlight: true},
      {text: rest, highlight: false},
    ],
    [{text: 'stress, boosts self-esteem, and strengthens', highlight: false}],
    [{text: 'relationships by fostering connection. Small,', highlight: false}],
    [{text: 'intentional actions like listening, complimenting, or', highlight: false}],
    [{text: 'helping others can significantly improve mental', highlight: false}],
    [{text: 'well-being and create a positive, contagious', highlight: false}],
    [{text: 'impact on communities.', highlight: false}],
  ];
}

/** Plain text reconstructed from the lines (used to verify it is word-for-word). */
export function linesToText(lines: Segment[][]): string {
  return lines
    .map((l) => l.map((s) => s.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function highlightedText(lines: Segment[][]): string {
  return lines
    .flat()
    .filter((s) => s.highlight)
    .map((s) => s.text)
    .join(' ');
}
