/**
 * The part of `@visastack/i18n` a browser bundle may import: formatting and
 * interpolation, and the few words of the error screen; no other message text.
 * A client component receives the few messages it needs as props from the server
 * page (so a traveller on a slow connection downloads no catalog they will not
 * read) and uses these helpers to fill in numbers, dates and names.
 */

import { errors } from './catalogs/errors';
import type { Locale } from './locales';

/** The messages the error screen needs, in the reader's language. The only catalog a browser bundle carries. */
export type ErrorPageKey = keyof typeof errors.en;
export function errorPageText(locale: Locale): Readonly<Record<ErrorPageKey, string>> {
  return errors[locale];
}

export {
  DISPLAY_TIME_ZONE,
  type MessageParams,
  type RichPiece,
  fill,
  formatDate,
  formatDateOnly,
  formatDateTime,
  formatNumber,
  pluralForm,
  splitRich,
} from './format';
export { DEFAULT_LOCALE, LOCALES, type Locale, formatTag, resolveLocale } from './locales';
