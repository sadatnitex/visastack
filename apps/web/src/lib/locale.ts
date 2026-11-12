import { type Locale, resolveLocale } from '@visastack/i18n';
import { cookies } from 'next/headers';
import { getDeploymentMode } from './deployment-mode';
import { isProductionSite } from './hosting';
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

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Preview path for browser checks while the language switch is off: lets an existing locale cookie
 * be honoured so Bangla can be seen and tested. All four must hold, and anything unexpected means
 * "no": the explicit flag LOCALE_PREVIEW=1, not Vercel production, not the Render fallback or any
 * other production site (checked directly, because DEPLOYMENT_MODE can override the mode), and a
 * deployment mode of exactly "development". It never changes the picker or what a visitor can do.
 */
export function localePreviewActive(): boolean {
  try {
    if (readEnv('LOCALE_PREVIEW') !== '1') return false;
    if (readEnv('VERCEL_ENV') === 'production') return false;
    if (isProductionSite()) return false;
    return getDeploymentMode() === 'development';
  } catch {
    return false;
  }
}

/** Read the visitor's locale preference, defaulting to English (always English while choice is off, except the non-production preview path above). */
export async function getLocale(): Promise<Locale> {
  // Read the request even while the choice is off: the root layout's call here is what keeps
  // every page rendered per request, and a page built ahead of time would carry no fresh
  // script nonce, so its scripts would be blocked by the page's own security policy.
  const store = await cookies();
  if (!LANGUAGE_CHOICE_ENABLED && !localePreviewActive()) return resolveLocale(undefined);
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}
