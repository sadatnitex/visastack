'use client';

import type { Locale } from '@visastack/i18n/client';
import { createContext, useContext } from 'react';

const LocaleContext = createContext<Locale>('en');

/**
 * Tells client components which language the page is in. The root layout reads the
 * visitor's language once, on the server, and wraps the page in this, so a browser
 * component (the error screen, a date it formats) never has to guess it and never
 * paints in the wrong language first.
 */
export function LocaleProvider({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The page's language, inside a client component. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}
