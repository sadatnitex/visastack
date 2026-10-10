import { NeonIdentityPort, WorkosIdentityPort } from './identity-provider';
import { selectedIdentityProvider } from './identity-selection';

/** The one thing the public pages need to know: does this visitor have a session? */
export interface SessionReader {
  currentIdentity(): Promise<unknown>;
}

/**
 * Whether the visitor is signed in, for the public header, footer and home page. It asks the
 * sign-in system this deployment actually uses (WorkOS or Neon Auth), so the answer is right on
 * both. A read that fails counts as signed out: a hiccup must never break a public page, and the
 * workspace itself still checks the session on its own.
 */
export async function isSignedIn(
  reader: SessionReader = selectedIdentityProvider() === 'neon_auth'
    ? new NeonIdentityPort()
    : new WorkosIdentityPort(),
): Promise<boolean> {
  try {
    return Boolean(await reader.currentIdentity());
  } catch {
    return false;
  }
}
