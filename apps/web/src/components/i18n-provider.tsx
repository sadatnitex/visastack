'use client';

import { type Catalog, DEFAULT_LOCALE, type Locale } from '@visastack/i18n';
import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { type PartsTranslator, partsTranslator } from '../lib/language-parts';
import type { PageLanguage } from '../lib/page-language';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);
const PageLanguageContext = createContext<PageLanguage>('en');

/** Gives client components the locale the server resolved. Renders no markup of its own. */
export function I18nProvider({
  locale,
  pageLang,
  children,
}: {
  readonly locale: Locale;
  /** The language of the html element, from the root layout. */
  readonly pageLang: PageLanguage;
  readonly children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <PageLanguageContext.Provider value={pageLang}>{children}</PageLanguageContext.Provider>
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
  return useMemo(() => partsTranslator(catalog, locale, pageLang), [catalog, locale, pageLang]);
}
