import { type Locale, resolveLocale } from '@visastack/i18n';
import { cookies } from 'next/headers';

/**
 * EN/BN locale preference (Build Spec's "English and Bangla launch UI").
 * A plain cookie, not an account field — no schema needed, and it works for
 * a signed-out visitor too (the landing page is itself part of the
 * translated critical path).
 */
export const LOCALE_COOKIE = 'visastack_locale';

/** Read the visitor's locale preference, defaulting to English. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}
