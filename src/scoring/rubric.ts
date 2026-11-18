/** The fixed 100-point rubric from the project brief. Do not change without updating the docs. */
export const RUBRIC = {
  emotional: {max: 35, label: 'A. Emotionaler Höhepunkt'},
  clarity: {max: 25, label: 'B. Verständlichkeit'},
  dropPotential: {max: 20, label: 'C. Musik-Drop-Potenzial'},
  visualQuality: {max: 10, label: 'D. Bildqualität'},
  originality: {max: 10, label: 'E. Originalität'},
} as const;

export type CriterionKey = keyof typeof RUBRIC;
export const CRITERIA = Object.keys(RUBRIC) as CriterionKey[];

export const DEFAULT_THRESHOLD = 75;

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Keyword lexicons (lower-case, multiple languages). Each entry: [regex, weight]. */
export const LEX = {
  emotional: [
    /\b(cry|cries|crying|cried|tears?|sobbing|breaks? down)\b/,
    /\b(emotional|heartwarming|heart-warming|touching|moving|goosebumps|chills|speechless|wholesome)\b/,
    /\b(reunion|reunited|reunites|comes home|homecoming)\b/,
    /\b(surprised?|surprises|shocked|couldn'?t believe|can'?t believe)\b/,
    /\b(llor[aóo]|l[áa]grimas|emocionante|conmovedor)\b/,
    /\b(weint|tr[äa]nen|ber[üu]hrend|g[äa]nsehaut|emotional)\b/,
    /\b(chora|l[áa]grimas|emocionante)\b/,
    /\b(pleure|larmes|émouvant)\b/,
  ],
  kindness: [
    /\b(kindness|kind|compassion|selfless|humanity|humane|generous|generosity)\b/,
    /\b(helps?|helping|helped|gives?|gave|giving|donat\w*|pays? for|paid for|shares?|sharing|saves?|saved|rescue\w*)\b/,
    /\b(respect|sportsmanship|fair ?play|good samaritan|hero)\b/,
    /\b(hilft|helfen|menschlichkeit|hilfsbereit\w*|respekt)\b/,
    /\b(bondad|ayuda|humanidad|bondade|ajuda|gentillesse|gentilezza|iyilik)\b/,
  ],
  climax: [
    /\b(reaction|reacts?|when (he|she|they) (saw|realized|found out)|finally|first time|never expected|unexpected\w*|wait for it|the end|ending)\b/,
    /\b(surprise|proposal|reveal|gift|wins?|crosses the finish|finish line)\b/,
  ],
  compilation: [
    /\bcompilation\b/,
    /\b(top ?\d+|#\d+|part ?\d+|vol\.? ?\d+|episode)\b/,
    /\b(moments that|acts of kindness that will|best of|that will (restore|make you))\b/,
    /\b\d{2,}\s+(moments|times|acts)\b/,
  ],
  offTopic: [
    /\b(lyrics?|official (music )?video|song|music video|trailer|podcast|interview|sermon|full episode|documentary|news report|live stream|livestream)\b/,
    /\b(prank|scripted|skit|staged|short film|movie|animated|animation|cartoon|ai generated|gameplay)\b/,
    /\b(music|no copyright|soundtrack|ost|audiobook|bedtime story|tale for kids|story for kids|folk story|lecture|webinar|meeting|press conference)\b/,
  ],
  subjects: {
    elderly: /\b(elderly|old (man|woman|lady)|grandma|grandpa|grandmother|grandfather|senior|oma|opa|abuela|abuelo)\b/,
    homeless: /\b(homeless|obdachlos|sin hogar)\b/,
    children: /\b(kids?|child|children|boy|girl|student|classmate|baby|kind(er)?)\b/,
    animals: /\b(dog|puppy|cat|kitten|animal|bird|horse|hund|katze|perro|gato)\b/,
    sports: /\b(football|soccer|basketball|runner|race|marathon|athlete|player|match|tennis|fußball|futbol|sport\w*)\b/,
    military: /\b(soldier|veteran|military|army|marine)\b/,
    service: /\b(police|officer|firefighter|nurse|doctor|bus driver|waiter|waitress|delivery)\b/,
    disability: /\b(blind|deaf|wheelchair|disabled|autis\w*|down syndrome)\b/,
    strangers: /\b(stranger|strangers|fremde\w*|desconocido)\b/,
  },
} as const;

export function countMatches(text: string, patterns: readonly RegExp[]): number {
  let n = 0;
  for (const p of patterns) if (p.test(text)) n++;
  return n;
}

export function categoriesOf(text: string): string[] {
  return Object.entries(LEX.subjects)
    .filter(([, re]) => re.test(text))
    .map(([k]) => k);
}
