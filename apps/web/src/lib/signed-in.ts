import { cache } from 'react';
import { createIdentityPort } from './providers';
import { reportServerError } from './server-error';

/**
 * Next's own control-flow signals all carry a string `digest` (its documented shape; Next exports no
 * stable check that works under every test double). An application error has none.
 */
function isNextSignal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === 'string'
  );
}

/**
 * Next refuses to set a cookie while a page is being drawn ("Cookies can only be modified in a
 * Server Action or Route Handler"). Neon Auth tries to, when the signed copy of the session it
 * keeps in a cookie is a few minutes old and it fetches a fresh one. On a page the request filter
 * does not refresh first (the public pages), that refusal is expected: nobody's session can be
 * renewed from there, so the visitor reads as signed out for this one page, and it is not an error
 * to report (it filled the production error log on every visit to /auth/reauth). The filter now
 * refreshes the session on /auth/reauth too. Read through the error and its causes, by Next's own
 * fixed wording, so a different failure is never mistaken for it.
 */
const READ_ONLY_COOKIES = 'Cookies can only be modified in a Server Action or Route Handler';

export function isReadOnlyCookiesError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const { message, cause } = current as { message?: unknown; cause?: unknown };
    if (typeof message === 'string' && message.startsWith(READ_ONLY_COOKIES)) return true;
    current = cause;
  }
  return false;
}

/** The one thing the public pages need to know: does this visitor have a session? */
export interface SessionReader {
  currentIdentity(): Promise<unknown>;
}

/**
 * Whether the visitor is signed in, for the public header, footer and home page. It asks Neon
 * Auth through the identity port. A read that fails counts as signed out: a hiccup must never break a public page, and the
 * workspace itself still checks the session on its own.
 */
async function readSignedIn(reader?: SessionReader): Promise<boolean> {
  try {
    return Boolean(await (reader ?? createIdentityPort()).currentIdentity());
  } catch (error) {
    // Next's own signals (a page found to be per-request while it is built, a redirect) are not
    // failures: they go back to Next unchanged, so they are never logged as errors or hidden.
    if (isNextSignal(error)) throw error;
    if (isReadOnlyCookiesError(error)) return false;
    reportServerError('public navigation identity', error);
    return false;
  }
}

/**
 * The same answer, read once per request: the layout and a page that both ask (the public
 * invitation page) share one session read.
 */
export const isSignedIn = cache(readSignedIn);
