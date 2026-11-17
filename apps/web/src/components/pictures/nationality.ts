/**
 * Which passport cover a traveller sees, from the nationality saved on their profile.
 *
 * The profile field `nationality` is free text: people type "Bangladeshi" (the field's own hint),
 * "Bangladesh", the two-letter code "BD", or a passport reading saves the three-letter code "BGD".
 * Bangla text is accepted too, because Bangla is a language of the product. Letter case, spaces,
 * dots and hyphens do not matter. Anything else, or nothing at all, is not Bangladesh and gets
 * the neutral drawn cover.
 *
 * This file only reads a word; it never stores, logs or sends it anywhere.
 */

/** The written forms that mean Bangladesh, already folded by `foldNationality`. */
const BANGLADESH_FORMS: ReadonlySet<string> = new Set([
  'bd',
  'bgd',
  'bangladesh',
  'bangladeshi',
  'bangladeshis',
  'peoplesrepublicofbangladesh',
  'republicofbangladesh',
  // Bangla: the country, and the nationality word with either final vowel sign.
  'বাংলাদেশ',
  'বাংলাদেশি',
  'বাংলাদেশী',
]);

/** Plain separators people type: dots, commas, apostrophes, underscores, brackets, hyphens. */
const ASCII_SEPARATORS = ".,'_()-";

/**
 * Other characters that carry no letters, by code point (numbers, so the source holds no
 * lookalike or invisible characters): the curly apostrophe and acute accent, every hyphen and
 * dash from U+2010 to U+2015, and the invisible joiners some Bangla keyboards insert between
 * letters (U+200B to U+200D, U+2060, U+FEFF).
 */
const SILENT_CODE_POINTS: ReadonlySet<number> = new Set([
  0x2019, 0x00b4, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x200b, 0x200c, 0x200d, 0x2060,
  0xfeff,
]);

function isSeparator(character: string): boolean {
  return (
    character.trim() === '' ||
    ASCII_SEPARATORS.includes(character) ||
    SILENT_CODE_POINTS.has(character.codePointAt(0) ?? 0)
  );
}

/**
 * Lower case, canonical Unicode form, and no spaces, dots, apostrophes, hyphens, brackets or the
 * invisible joiners some Bangla keyboards insert between letters.
 */
export function foldNationality(value: string): string {
  return Array.from(value.normalize('NFC').toLowerCase())
    .filter((character) => !isSeparator(character))
    .join('');
}

/** True when the saved nationality names Bangladesh (BD, BGD, Bangladesh, Bangladeshi, Bangla). */
export function isBangladeshNationality(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const folded = foldNationality(value);
  return folded.length > 0 && BANGLADESH_FORMS.has(folded);
}

/** The two covers the product can show. */
export type PassportCoverKind = 'bangladesh' | 'neutral';

/** The cover for a saved nationality: the real Bangladesh cover, or the neutral drawn one. */
export function passportCoverFor(nationality: string | null | undefined): PassportCoverKind {
  return isBangladeshNationality(nationality) ? 'bangladesh' : 'neutral';
}
