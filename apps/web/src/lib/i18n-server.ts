import {
  type Catalog,
  type CatalogTranslator,
  type Locale,
  catalogTranslator,
} from '@visastack/i18n';
import { cache } from 'react';
import { getLocale } from './locale';

/**
 * Server-side translation. Server code only: it reads the request's locale through `getLocale`.
 *
 * Layouts and pages render in parallel, so a sync server component cannot count on the layout
 * having run first. Every `page.tsx` default export must `await primeLocale()` before it
 * returns; the root layout does too. After that, `getServerT(catalog)` is synchronous. The
 * holder is request-scoped through React `cache` (the same pattern next-intl uses), so one
 * visitor's language never reaches another request.
 */
const localeHolder = cache((): { locale: Locale | null } => ({ locale: null }));

/** Resolve the request's locale once and remember it for the rest of the request. */
export async function primeLocale(): Promise<Locale> {
  const locale = await getLocale();
  localeHolder().locale = locale;
  return locale;
}

/** Sync translator for a catalog. Needs `primeLocale()` to have run earlier in the request. */
export function getServerT<K extends string>(catalog: Catalog<K>): CatalogTranslator<K> {
  const { locale } = localeHolder();
  if (locale === null) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        'getServerT called before primeLocale(): add `await primeLocale()` to the page default export',
      );
    }
    return catalogTranslator(catalog, 'en');
  }
  return catalogTranslator(catalog, locale);
}

/** Async translator: primes the locale, then translates. */
export async function getT<K extends string>(catalog: Catalog<K>): Promise<CatalogTranslator<K>> {
  return catalogTranslator(catalog, await primeLocale());
}
