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

/**
 * The live drafted Bengali for a catalogue key that has no reviewed Bengali (see i18n/*-messages.ts).
 * The server passes the full lookup; the browser gets only the few keyed lines it needs, through the
 * provider, so the message files never ship to the client.
 */
export type KeyDrafts = (key: string) => string | undefined;

export function partsTranslator<K extends string>(
  catalog: Catalog<K>,
  locale: Locale,
  pageLang: PageLanguage,
  drafts?: KeyDrafts,
): PartsTranslator<K> {
  // A key with no reviewed Bengali may have a live draft in the public message files (keyed by
  // catalogue key, so a screen outside the public pages is never touched).
  const withDrafts = drafts ? withPublicDrafts(catalog, drafts) : catalog;
  const plain = catalogTranslator(withDrafts, locale);
  return Object.assign((key: K, params?: MessageParams) => plain(key, params), {
    node(key: K, params?: MessageParams): ReactNode {
      const { text, lang } = catalogResolve(withDrafts, locale, key, params);
      return lang === pageLang ? text : createElement('span', { lang }, text);
    },
    lang(key: K): { lang?: Locale } {
      const { lang } = catalogResolve(withDrafts, locale, key);
      return lang === pageLang ? {} : { lang };
    },
  });
}

const draftedCatalogs = new WeakMap<object, WeakMap<KeyDrafts, unknown>>();

/** The catalogue plus the live drafts for its keys that have no Bengali (cached per catalogue and lookup). */
function withPublicDrafts<K extends string>(catalog: Catalog<K>, drafts: KeyDrafts): Catalog<K> {
  const perCatalog = draftedCatalogs.get(catalog) ?? new WeakMap<KeyDrafts, unknown>();
  draftedCatalogs.set(catalog, perCatalog);
  const cached = perCatalog.get(drafts);
  if (cached) return cached as Catalog<K>;
  const extra: Partial<Record<K, string>> = {};
  for (const key of Object.keys(catalog.en) as K[]) {
    if (catalog.bn[key] !== undefined) continue;
    const draft = drafts(key);
    if (draft !== undefined) extra[key] = draft;
  }
  const result: Catalog<K> =
    Object.keys(extra).length === 0 ? catalog : { en: catalog.en, bn: { ...catalog.bn, ...extra } };
  perCatalog.set(drafts, result);
  return result;
}
