import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { publicBnByEnglish } from '../i18n/public-lookup';
import { getLocale } from './locale';

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
    let locale: string;
    try {
      locale = await getLocale();
    } catch (error) {
      // Next's own signals travel on; anything else (no request to read, as in a unit test) is English.
      unstable_rethrow(error);
      return base;
    }
    if (locale !== 'bn') return base;
    const title = publicBnByEnglish(base.title);
    return title === undefined ? base : { ...base, title };
  };
}
