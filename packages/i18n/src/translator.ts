import {
  type MessageParams,
  fill,
  formatDate,
  formatDateTime,
  formatNumber,
  pluralForm,
} from './format';
import { DEFAULT_LOCALE, type Locale } from './locales';
import { CATALOGS, type MessageKey } from './messages';

export { resolveLocale } from './locales';
export type { MessageParams } from './format';

export type Translator = (key: MessageKey, params?: MessageParams) => string;

/**
 * The base of every message that has a `.one` and a `.other` form
 * (`account.applicants.count` for `account.applicants.count.one` and
 * `.other`). Typed so `tn` only accepts a base that really has both forms.
 */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}.one`
    ? `${Base}.other` extends MessageKey
      ? Base
      : never
    : never;
}[MessageKey];

/** Picks the `.one` or `.other` form for `count` in the locale's own plural rules, and fills `{count}`. */
export type PluralTranslator = (base: PluralBase, count: number, params?: MessageParams) => string;

/**
 * Build a translator for a locale. A missing translation falls back to the
 * canonical English message, so the UI never shows a raw key (the catalogs are
 * complete by type, so this only matters if that guarantee is bypassed).
 * Number parameters are written in the locale's digits; string parameters are
 * inserted exactly as given.
 */
export function createTranslator(locale: Locale): Translator {
  return (key, params) => {
    const template = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
    return fill(template, params, locale);
  };
}

/** Everything a screen needs to speak one language: messages, plurals, numbers and dates. */
export interface I18n {
  readonly locale: Locale;
  readonly t: Translator;
  readonly tn: PluralTranslator;
  readonly number: (value: number) => string;
  /** A calendar date. */
  readonly date: (value: Date | string | number, style?: 'short' | 'long') => string;
  /** A date with its time of day and zone. */
  readonly dateTime: (value: Date | string | number) => string;
}

export function createI18n(locale: Locale): I18n {
  const t = createTranslator(locale);
  return {
    locale,
    t,
    tn: (base, count, params) =>
      t(`${base}.${pluralForm(locale, count)}` as MessageKey, { ...params, count }),
    number: (value) => formatNumber(locale, value),
    date: (value, style) => formatDate(locale, value, style),
    dateTime: (value) => formatDateTime(locale, value),
  };
}
