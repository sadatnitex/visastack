'use client';

import {
  type Catalog,
  type CatalogTranslator,
  DEFAULT_LOCALE,
  type Locale,
  catalogTranslator,
} from '@visastack/i18n';
import { type ReactNode, createContext, useContext, useMemo } from 'react';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Gives client components the locale the server resolved. Renders no markup of its own. */
export function I18nProvider({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT<K extends string>(catalog: Catalog<K>): CatalogTranslator<K> {
  const locale = useLocale();
  return useMemo(() => catalogTranslator(catalog, locale), [catalog, locale]);
}
