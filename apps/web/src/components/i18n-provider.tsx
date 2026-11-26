'use client';

import { type Catalog, DEFAULT_LOCALE, type Locale } from '@visastack/i18n';
import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { type KeyDrafts, type PartsTranslator, partsTranslator } from '../lib/language-parts';
import type { PageLanguage } from '../lib/page-language';
import { renderPublic } from './public-site/public-text-core';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);
const PageLanguageContext = createContext<PageLanguage>('en');
const DraftsContext = createContext<Readonly<Record<string, string>>>({});

/** Gives client components the locale the server resolved. Renders no markup of its own. */
export function I18nProvider({
  locale,
  pageLang,
  drafts = {},
  children,
}: {
  readonly locale: Locale;
  /** The language of the html element, from the root layout. */
  readonly pageLang: PageLanguage;
  /** Live drafted Bengali for catalogue keys that have no reviewed Bengali (from the server). */
  readonly drafts?: Readonly<Record<string, string>>;
  readonly children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <PageLanguageContext.Provider value={pageLang}>
        <DraftsContext.Provider value={drafts}>{children}</DraftsContext.Provider>
      </PageLanguageContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function usePageLanguage(): PageLanguage {
  return useContext(PageLanguageContext);
}

export function useT<K extends string>(catalog: Catalog<K>): PartsTranslator<K> {
  const locale = useLocale();
  const pageLang = usePageLanguage();
  const drafts = useContext(DraftsContext);
  return useMemo(() => {
    const lookup: KeyDrafts = (key) => drafts[key];
    return partsTranslator(catalog, locale, pageLang, lookup);
  }, [catalog, locale, pageLang, drafts]);
}

/** `publicText` for a client component: the drafted Bengali comes from the server through the provider. */
export function usePublicText(): (text: string) => ReactNode {
  const locale = useLocale();
  const pageLang = usePageLanguage();
  const drafts = useContext(DraftsContext);
  return (text) =>
    renderPublic(text, locale === 'bn' ? drafts[`en:${text}`] : undefined, pageLang, locale);
}
