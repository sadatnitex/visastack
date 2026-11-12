import {
  type Catalog,
  type CatalogTranslator,
  type Locale,
  type MessageParams,
  catalogResolve,
  catalogTranslator,
} from '@visastack/i18n';
import { type ReactNode, createElement } from 'react';
import type { PageLanguage } from './page-language';

/**
 * Language of parts (WCAG 3.1.2). A translator that is also callable as a plain string function
 * and can say which language each message is really in, so text that differs from the page's
 * language gets its own `lang`.
 */
export interface PartsTranslator<K extends string> extends CatalogTranslator<K> {
  /** The bare string when it is in the page language, otherwise a span carrying its `lang`. */
  node(key: K, params?: MessageParams): ReactNode;
  /** `{}` or `{ lang }`, for spreading onto an element that holds only this message. */
  lang(key: K): { lang?: Locale };
}

export function partsTranslator<K extends string>(
  catalog: Catalog<K>,
  locale: Locale,
  pageLang: PageLanguage,
): PartsTranslator<K> {
  const plain = catalogTranslator(catalog, locale);
  return Object.assign((key: K, params?: MessageParams) => plain(key, params), {
    node(key: K, params?: MessageParams): ReactNode {
      const { text, lang } = catalogResolve(catalog, locale, key, params);
      return lang === pageLang ? text : createElement('span', { lang }, text);
    },
    lang(key: K): { lang?: Locale } {
      const { lang } = catalogResolve(catalog, locale, key);
      return lang === pageLang ? {} : { lang };
    },
  });
}
