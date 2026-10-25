/**
 * How the interface writes names (owner rule, 25 Oct 2026). A term (a page, section or card
 * heading, a menu item, a field label, a status badge, a short button name) uses Title Case:
 * every word starts with a capital, apart from small joining words after the first ("Share &
 * Care", "Ready for Review", "Sign In with the Invited Email"). A sentence (a hint, a message, a
 * question, anything ending in a full stop) keeps only its first word capitalised.
 */

const SMALL_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'nor',
  'but',
  'of',
  'to',
  'in',
  'on',
  'for',
  'at',
  'by',
  'with',
  'as',
  'per',
  'via',
  'vs',
  'from',
  'into',
  'than',
  'if',
]);
/** Joining words that stay lower case inside a hyphenated word ("Sign-In", "Free-Plan"). */
const HYPHEN_SMALL_WORDS: ReadonlySet<string> = new Set(['a', 'an', 'the', 'and', 'or', 'of']);
/** Verbs whose particle is part of the name ("Sign In", "Set Up", "Turn Off"). */
const PHRASAL_VERBS: ReadonlySet<string> = new Set([
  'sign',
  'log',
  'set',
  'clean',
  'check',
  'opt',
  'follow',
  'roll',
  'turn',
  'start',
  'back',
  'switch',
  'switched',
  'signed',
]);
const PARTICLES: ReadonlySet<string> = new Set(['in', 'up', 'out', 'on', 'off', 'back', 'over']);

const ALNUM = /[A-Za-z0-9]/;
const WORD_CHAR = /[A-Za-z0-9'’.-]/;

/**
 * Splits "(e-visa)," into what comes before the word, the word, and what follows. A single pass
 * over the characters, so the time stays linear whatever the text.
 */
function splitWord(word: string): { before: string; core: string; after: string } | null {
  let start = 0;
  while (start < word.length && !ALNUM.test(word.charAt(start))) start += 1;
  if (start === word.length) return null;
  let end = start + 1;
  while (end < word.length && WORD_CHAR.test(word.charAt(end))) end += 1;
  return { before: word.slice(0, start), core: word.slice(start, end), after: word.slice(end) };
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Writes a term in Title Case. Words already holding capitals (VisaStack, AI, USD) are kept. */
export function toTitleCase(text: string): string {
  const words = text.split(' ');
  return words
    .map((word, i) => {
      // An HTML entity such as &amp; is a symbol, not a word.
      if (/^&[a-z]+;$/.test(word)) return word;
      const split = splitWord(word);
      if (!split) return word;
      const { before, core, after } = split;
      // A single capital letter is not an abbreviation: "Add A Traveller" is wrong.
      const abbreviation = core.length > 1 && core === core.toUpperCase();
      if (/[A-Z]/.test(core.slice(1)) || /^[0-9]/.test(core) || abbreviation) {
        return word;
      }
      // A trailing full stop belongs to the word ("vs."), not to its spelling.
      const lower = core.toLowerCase().replace(/\.$/, '');
      const first = i === 0 || before.startsWith('(');
      const last = i === words.length - 1;
      const previous = (words[i - 1] ?? '').toLowerCase().replace(/[^a-z]/g, '');
      const particle = PARTICLES.has(lower) && PHRASAL_VERBS.has(previous);
      if (!first && !last && SMALL_WORDS.has(lower) && !particle)
        return `${before}${core.toLowerCase()}${after}`;
      if (!first && last && ['a', 'an', 'the', 'and', 'or', 'nor', 'if'].includes(lower)) {
        return `${before}${core.toLowerCase()}${after}`;
      }
      const parts = core
        .split('-')
        .map((part, j) =>
          j === 0 || !HYPHEN_SMALL_WORDS.has(part.toLowerCase()) ? capitalise(part) : part,
        );
      return `${before}${parts.join('-')}${after}`;
    })
    .join(' ');
}

/** Whether a term is already in Title Case. */
export function isTitleCase(text: string): boolean {
  return toTitleCase(text) === text;
}
