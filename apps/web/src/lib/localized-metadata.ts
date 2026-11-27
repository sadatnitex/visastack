import type { Metadata } from 'next';
import { publicBnByEnglish } from '../i18n/public-lookup';
import { primePage } from './i18n-server';

/**
 * A public page's tab title in the visitor's language. Pages call it in place of a static
 * `metadata` constant: `export const generateMetadata = localizedMetadata({ title: 'How It Works' })`.
 * English is unchanged (the same object); a Bengali visitor gets the drafted Bengali title when there
 * is one, and the English title otherwise. Reading the locale reads the request's cookies, which the
 * root layout already does for every page, so nothing becomes dynamic that was not.
 */
export function localizedMetadata<M extends Metadata & { readonly title: string }>(
  base: M,
): () => Promise<Metadata> {
  return async () => {
    // A tab title is Bengali only on a page that is itself marked Bengali (it can never be Bengali
    // over an English page). With no request to read (a unit test) the page is English.
    const { pageLang } = await primePage();
    if (pageLang !== 'bn') return base;
    const title = publicBnByEnglish(base.title);
    return title === undefined ? base : { ...base, title };
  };
}
