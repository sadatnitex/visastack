/**
 * @visastack/i18n - bilingual (English/Bangla) messages.
 *
 * Framework-agnostic message catalogs (one per flow, Bangla complete by type), a
 * typed translator with `{token}` interpolation and plurals, locale-aware
 * numbers and dates, and the professional-review record for the Bangla text. No
 * dependency on `react`/`next`: any VisaStack surface can consume it. Browser
 * code imports `@visastack/i18n/client` instead, which carries no catalogs.
 */

export type { Catalog, CatalogMeta, ReviewArea } from './catalog';
export { defineCatalog, tokensOf } from './catalog';
export {
  BN,
  CATALOG_LIST,
  CATALOGS,
  type CatalogId,
  DEFAULT_LOCALE,
  EN,
  type Locale,
  LOCALES,
  type MessageKey,
  catalogOf,
  isMessageKey,
} from './messages';
export {
  DISPLAY_TIME_ZONE,
  type RichPiece,
  fill,
  formatDate,
  formatDateOnly,
  formatDateTime,
  formatNumber,
  pluralForm,
  splitRich,
} from './format';
export { formatTag } from './locales';
export {
  BANGLA_REVIEW_RECORDS,
  type BanglaReviewRecord,
  banglaReviewPending,
  isBanglaReviewPending,
  reviewAreasFor,
} from './review';
export {
  type I18n,
  type MessageParams,
  type PluralBase,
  type PluralTranslator,
  type Translator,
  createI18n,
  createTranslator,
  resolveLocale,
} from './translator';
