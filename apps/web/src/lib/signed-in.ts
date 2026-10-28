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

/** The one thing the public pages need to know: does this visitor have a session? */
export interface SessionReader {
  currentIdentity(): Promise<unknown>;
}

/**
 * Whether the visitor is signed in, for the public header, footer and home page. It asks Neon
 * Auth through the identity port. A read that fails counts as signed out: a hiccup must never break a public page, and the
 * workspace itself still checks the session on its own.
 */
export async function isSignedIn(reader?: SessionReader): Promise<boolean> {
  try {
    return Boolean(await (reader ?? createIdentityPort()).currentIdentity());
  } catch (error) {
    // Next's own signals (a page found to be per-request while it is built, a redirect) are not
    // failures: they go back to Next unchanged, so they are never logged as errors or hidden.
    if (isNextSignal(error)) throw error;
    reportServerError('public navigation identity', error);
    return false;
  }
}
