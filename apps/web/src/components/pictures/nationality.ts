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

/** Lower case, canonical Unicode form, and no spaces, dots, apostrophes, hyphens or brackets. */
export function foldNationality(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s.,'’´‐-―_()-]+/g, '');
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
