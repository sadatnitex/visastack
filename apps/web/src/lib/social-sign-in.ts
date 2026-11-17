import { switchOn } from '@visastack/core';
import { isSignInConfigured, readEnv } from './env';

/**
 * Pieces of "Continue with Google" that can be tested on their own. The start route is
 * `app/auth/google/route.ts`; the button is `app/auth/google-button.tsx`.
 *
 * Nothing here decides who gets in. Neon Auth completes the sign-in at Google, and then every
 * request goes through the same checks as an email sign-in: the invitation check, the
 * confirmed-email rule and the account binding.
 */

/**
 * Whether the "Continue with Google" button is offered.
 *
 * Off unless `GOOGLE_SIGN_IN_ENABLED` is `true` (read the one way every launch switch is read) AND
 * Neon Auth, the only sign-in system, has everything it needs, so the page never shows a button
 * it cannot serve. Switching it on is a deliberate step taken only after Google is set up in the
 * Neon Auth settings for this deployment and the owner has decided how agreement to the terms is
 * recorded for Google sign-ups (docs/operations/current-platform.md).
 */
export function googleSignInEnabled(): boolean {
  return switchOn(readEnv('GOOGLE_SIGN_IN_ENABLED')) && isSignInConfigured();
}

/** The one address Google's own sign-in page lives at. */
const GOOGLE_SIGN_IN_HOST = 'accounts.google.com';

/**
 * The address Neon Auth gave for Google's sign-in page, or null when it is anything else: not a
 * secure address, or not Google's. The browser is only ever sent to this.
 */
export function googleAuthorizationUrl(target: unknown): string | null {
  if (typeof target !== 'string') return null;
  try {
    const url = new URL(target);
    return url.protocol === 'https:' && url.hostname === GOOGLE_SIGN_IN_HOST
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Whether the person clicked the button on one of our own pages. A link that any other site, an
 * email, a bookmark or a page script can start would let someone else begin a sign-in for a
 * visitor, and Neon Auth is told where the start came from by these same headers (it refuses a
 * start that names no origin). So the start needs, together:
 *  - an `Origin` or `Referer` that is this site, and
 *  - where the browser says so (`Sec-Fetch-Site`, `Sec-Fetch-Dest`), a same-site page navigation
 *    (not an image, script, frame or request from elsewhere).
 * Older browsers that send no `Sec-Fetch-*` headers are judged by the first rule alone.
 */
export function startedFromThisSite(headers: HeaderReader, origin: string): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const destination = headers.get('sec-fetch-dest');
  if (destination !== null && destination !== 'document') return false;
  const from = headers.get('origin') ?? headers.get('referer');
  if (!from) return false;
  try {
    return new URL(from).origin === origin;
  } catch {
    return false;
  }
}

/**
 * True when the signed-in person's sign-in methods are Google and nothing else (no password), so
 * the password re-check page cannot work for them. Anything unreadable counts as false, which
 * keeps today's password page.
 */
export function onlyGoogleAccounts(accounts: unknown): boolean {
  if (!Array.isArray(accounts)) return false;
  const methods = accounts.map((entry) => {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const row = entry as { providerId?: unknown; provider?: unknown };
    return row.providerId ?? row.provider;
  });
  return methods.includes('google') && !methods.includes('credential');
}

/** Rejects after `ms` so a stalled call becomes the fixed message, not a platform error page. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
