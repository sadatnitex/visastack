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

export function catalogTranslator<K extends string>(
  catalog: Catalog<K>,
  locale: Locale,
): CatalogTranslator<K> {
  const tag = localeTag(locale);
  return (key, params) => {
    const template = catalog[locale][key] ?? catalog[DEFAULT_LOCALE][key] ?? key;
    return formatMessage(template, params, tag);
  };
}
