import { unstable_rethrow } from 'next/navigation';
import { createIdentityPort } from './providers';
import { reportServerError } from './server-error';

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
    unstable_rethrow(error);
    reportServerError('public navigation identity', error);
    return false;
  }
}
