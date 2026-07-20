/**
 * @visastack/i18n — bilingual (English/Bangla) messages.
 *
 * A framework-agnostic message catalog and a typed translator with `{token}`
 * interpolation and English fallback. No dependency on `react`/`next` — any
 * VisaStack surface can consume it.
 */

export {
  BN,
  CATALOGS,
  DEFAULT_LOCALE,
  EN,
  type Locale,
  LOCALES,
  type MessageKey,
} from './messages';

export {
  createTranslator,
  type MessageParams,
  resolveLocale,
  type Translator,
} from './translator';
