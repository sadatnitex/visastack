import { type Catalog, DEFAULT_LOCALE, type Locale } from '@visastack/i18n';
import { unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import { type PartsTranslator, partsTranslator } from './language-parts';
import { getLocale } from './locale';
import { type PageLanguage, pageLanguage } from './page-language';
import { requestedPath } from './request-path';

/**
 * Server-side translation. Server code only: it reads the request's locale through `getLocale`.
 *
 * Layouts and pages render in parallel, so a sync server component cannot count on the layout
 * having run first. Every `page.tsx` default export must `await primeLocale()` before it
 * returns; the root layout does too. After that, `getServerT(catalog)` is synchronous. The
 * holder is request-scoped through React `cache` (the same pattern next-intl uses), so one
 * visitor's language never reaches another request.
 */
const localeHolder = cache((): { locale: Locale | null; pageLang: PageLanguage } => ({
  locale: null,
  pageLang: 'en',
}));

/**
 * Resolve the request's locale and the page's language once and remember both for the rest of
 * the request. The root layout uses the returned pair for `<html lang>` and the provider, so the
 * markup and the translators come from one value.
 */
export async function primePage(): Promise<{ locale: Locale; pageLang: PageLanguage }> {
  let locale: Locale;
  try {
    locale = await getLocale();
  } catch (error) {
    // Next's own signals (dynamic rendering, redirects, not-found) must keep travelling, or a
    // page would quietly turn static and English. Anything else, such as reading cookies outside
    // a request in a unit test, falls back to English.
    unstable_rethrow(error);
    locale = DEFAULT_LOCALE;
  }
  // The page's own language, from the same rule the root layout uses for <html lang>, so the
  // two cannot disagree. No request to read (a unit test) means English. Read before anything
  // is stored, so a concurrent component never sees the new locale with a stale page language.
  const pageLang = pageLanguage(locale, await requestedPath());
  const holder = localeHolder();
  holder.locale = locale;
  holder.pageLang = pageLang;
  return { locale, pageLang };
}

/** Resolve the request's locale once and remember it for the rest of the request. */
export async function primeLocale(): Promise<Locale> {
  return (await primePage()).locale;
}

/** The language the page itself is marked with (`<html lang>`). Needs `primeLocale()` first. */
export function getPageLanguage(): PageLanguage {
  return localeHolder().pageLang;
}

/** Sync translator for a catalog. Needs `primeLocale()` to have run earlier in the request. */
export function getServerT<K extends string>(catalog: Catalog<K>): PartsTranslator<K> {
  const { locale, pageLang } = localeHolder();
  if (locale === null) {
    if (process.env.NODE_ENV === 'development') {
      throw new Error(
        'getServerT called before primeLocale(): add `await primeLocale()` to the page default export',
      );
    }
    return partsTranslator(catalog, 'en', 'en');
  }
  return partsTranslator(catalog, locale, pageLang);
}

/** Async translator: primes the locale, then translates. */
export async function getT<K extends string>(catalog: Catalog<K>): Promise<PartsTranslator<K>> {
  const locale = await primeLocale();
  return partsTranslator(catalog, locale, localeHolder().pageLang);
}
