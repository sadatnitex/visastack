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
 * The address of this site as the visitor typed it. Behind a proxy (Vercel, Render) the server's
 * own idea of its address is not the visitor's, so the forwarded host and scheme come first, as
 * the other same-site checks do (`same-site.ts`). Anything that does not look like a host and a
 * scheme falls back to the address the framework gave. Neon Auth separately refuses a host it does
 * not trust, so this only chooses which trusted address the sign-in cookies and returns belong to.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (name: string) => request.headers.get(name)?.split(',')[0]?.trim();
  const host = (first('x-forwarded-host') || request.headers.get('host') || url.host).toLowerCase();
  const scheme = (first('x-forwarded-proto') || url.protocol.replace(':', '')).toLowerCase();
  const plausible =
    /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(host) && /^https?$/.test(scheme);
  return plausible ? `${scheme}://${host}` : url.origin;
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

/**
 * How the person who is signed in right now signs in: 'signed-out' (nobody), 'google-only' (no
 * password) or 'other' (a password, with or without Google). Starting Google while signed in is
 * only for 'google-only' people, who have no password to confirm it is them with; for anyone with
 * a password it would replace the password check with one tap on a device that may still be signed
 * in to Google. A visitor with no sign-in cookie is answered without asking Neon Auth. Throws when
 * Neon Auth cannot be asked; callers treat that as 'other'.
 */
export async function sessionSignInMethods(): Promise<'signed-out' | 'google-only' | 'other'> {
  const { requestSessionReader } = await import('./neon-request-session');
  const { data } = await requestSessionReader().getSession();
  if (!data?.user) return 'signed-out';
  const { getNeonAuth } = await import('./neon-auth');
  const accounts = await getNeonAuth().listAccounts();
  return onlyGoogleAccounts(accounts.data) ? 'google-only' : 'other';
}
