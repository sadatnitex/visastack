import { type Locale, resolveLocale } from '@visastack/i18n';
import { cookies } from 'next/headers';
import { LANGUAGE_CHOICE_ENABLED } from './language-choice';

/**
 * EN/BN locale preference (Build Spec's "English and Bangla launch UI").
 * A plain cookie, not an account field — no schema needed, and it works for
 * a signed-out visitor too (the landing page is itself part of the
 * translated critical path).
 */
export const LOCALE_COOKIE = 'visastack_locale';

/**
 * Attributes for the locale cookie (directive Part 9 section 6: Secure,
 * HttpOnly and SameSite "as appropriate"). Only the server reads it, so
 * scripts never need to and cannot; `Lax` keeps it off cross-site
 * sub-requests while still arriving on a normal top-level visit. `Secure` is
 * production-only because a plain-http local server would drop the cookie.
 */
export function localeCookieOptions(secure: boolean) {
  return {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
  };
}

/** Read the visitor's locale preference, defaulting to English (always English while choice is off). */
export async function getLocale(): Promise<Locale> {
  if (!LANGUAGE_CHOICE_ENABLED) return resolveLocale(undefined);
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}
