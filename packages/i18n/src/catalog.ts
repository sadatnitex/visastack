import { localeTag } from './format';
import { type MessageParams, formatMessage } from './icu';
import { DEFAULT_LOCALE, type Locale } from './messages';

export interface Catalog<K extends string> {
  readonly en: Readonly<Record<K, string>>;
  readonly bn: Readonly<Partial<Record<K, string>>>;
}

/** English defines the keys; Bengali may be partial and falls back to English. */
export function defineCatalog<const E extends Readonly<Record<string, string>>>(catalog: {
  readonly en: E;
  readonly bn: Readonly<Partial<Record<keyof E & string, string>>>;
}): Catalog<keyof E & string> {
  return catalog;
}

export type CatalogKey<C> = C extends Catalog<infer K> ? K : never;

export type CatalogTranslator<K extends string> = (key: K, params?: MessageParams) => string;

/** A translated message with the language it is actually written in. */
export interface ResolvedMessage {
  readonly text: string;
  readonly lang: Locale;
}

/**
 * Resolve a key and report the language used: 'bn' only when a Bengali value exists for a Bengali
 * visitor, otherwise 'en' (the English fallback, or the key itself when nothing is defined).
 */
export function catalogResolve<K extends string>(
  catalog: Catalog<K>,
  locale: Locale,
  key: K,
  params?: MessageParams,
): ResolvedMessage {
  const own = catalog[locale][key];
  const lang: Locale = own !== undefined ? locale : DEFAULT_LOCALE;
  const template = own ?? catalog[DEFAULT_LOCALE][key] ?? key;
  return { text: formatMessage(template, params, localeTag(lang)), lang };
}

export function catalogTranslator<K extends string>(
  catalog: Catalog<K>,
  locale: Locale,
): CatalogTranslator<K> {
  return (key, params) => catalogResolve(catalog, locale, key, params).text;
}
