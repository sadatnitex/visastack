/**
 * The languages VisaStack speaks (Build Spec section 9; PRD section 6: English and
 * Bangla). Kept apart from the catalogs so a client component can ask "which
 * language is this" without loading a single message.
 */

export const LOCALES = ['en', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Narrow an arbitrary string to a supported `Locale`, defaulting otherwise. */
export function resolveLocale(input: string | undefined): Locale {
  return LOCALES.includes(input as Locale) ? (input as Locale) : DEFAULT_LOCALE;
}

/**
 * The BCP 47 tag used for number and date formatting. English is the
 * day-first British form because every market the product serves (Bangladesh,
 * the United Kingdom, France, Singapore) writes the day before the month, so
 * "5 Oct 2026" is never read as the 10th of May. Bangla is Bangla as written in
 * Bangladesh, which also selects Bengali digits.
 */
export function formatTag(locale: Locale): string {
  return locale === 'bn' ? 'bn-BD' : 'en-GB';
}
