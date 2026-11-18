import {PATHS} from '../core/paths.js';
import {readJson, writeJson} from '../core/fsutil.js';
import path from 'node:path';

/** Base search terms from the project brief. */
export const BASE_TERMS = [
  'Humanity Restored',
  'Faith in Humanity Restored',
  'Wholesome Moments',
  'Unexpected Kindness',
  'Random Acts of Kindness',
  'Strangers Helping Strangers',
  'Sportsmanship',
  'Respect Moments',
  'Selfless Acts',
  'Emotional Moments',
  'Helping Others',
  'Beautiful Human Moments',
  'Acts of Compassion',
  'Humanity Wins',
  'Kindness Caught on Camera',
  'Heartwarming Sports Moments',
  'Fair Play Moments',
  'Helping Elderly People',
  'Unexpected Acts of Humanity',
  'Respect in Sports',
  'Emotional Reunions',
];

/** Related themes to widen the net (avoid finding the same viral clips again and again). */
export const RELATED_TERMS = [
  'stranger pays for groceries',
  'helping homeless man',
  'soldier surprises family',
  'dog helps blind cat',
  'athlete helps opponent finish race',
  'kids help classmate',
  'firefighter saves kitten',
  'bus driver helps passenger',
  'man gives his jacket to stranger',
  'teacher surprised by students',
  'grandpa emotional surprise',
  'waiter receives huge tip reaction',
  'deaf child hears for first time',
  'player comforts crying opponent',
  'fans help rival team',
  'neighbors help elderly woman',
  'street vendor surprised with help',
  'boy shares food with stranger',
  'police officer helps elderly man cross street',
  'runner carries injured competitor',
];

/** Multilingual variants (German, Spanish, Portuguese, French, Italian, Turkish, Arabic). */
export const MULTILINGUAL_TERMS = [
  'Menschlichkeit Video berührend',
  'Hilfsbereitschaft Fremde helfen',
  'Fairplay Momente Fußball',
  'Glaube an die Menschheit wiederhergestellt',
  'actos de bondad',
  'humanidad momentos emocionantes',
  'fair play futbol respeto',
  'atos de bondade emocionante',
  'gentillesse inconnu aide',
  'gesti di gentilezza',
  'iyilik videoları duygusal',
  'لطف إنساني مؤثر',
];

export const SHORT_FORM_SUFFIXES = ['', ' shorts', ' caught on camera', ' emotional'];

export function allQueries(): string[] {
  const set = new Set<string>();
  for (const t of BASE_TERMS) set.add(t.toLowerCase());
  for (const t of RELATED_TERMS) set.add(t.toLowerCase());
  for (const t of MULTILINGUAL_TERMS) set.add(t);
  // a few combined forms (theme + format) for variety
  for (const t of BASE_TERMS.slice(0, 10)) set.add(`${t.toLowerCase()} shorts`);
  return [...set];
}

interface QueryState {
  cursor: number;
  lastRun: Record<string, string>;
}

const STATE_FILE = path.join(PATHS.data, 'query-state.json');

/**
 * Round-robin over all queries so every run searches different terms
 * (and the same clips are not re-found over and over).
 */
export function nextQueries(n: number, stateFile = STATE_FILE): string[] {
  const all = allQueries();
  const st = readJson<QueryState>(stateFile, {cursor: 0, lastRun: {}});
  const out: string[] = [];
  for (let i = 0; i < Math.min(n, all.length); i++) out.push(all[(st.cursor + i) % all.length]);
  st.cursor = (st.cursor + out.length) % all.length;
  const now = new Date().toISOString();
  for (const q of out) st.lastRun[q] = now;
  writeJson(stateFile, st);
  return out;
}
