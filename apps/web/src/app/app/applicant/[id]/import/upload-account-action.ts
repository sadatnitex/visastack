'use server';

import { withSession } from '../../../../../lib/session';
import { uploadAccountKey } from './upload-account';

/** Next's sign-in redirect signal (it exports no stable detector; same shape `withSession` reads). */
function isRedirectSignal(error: unknown): boolean {
  const digest = (error as { readonly digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/**
 * WP-PIC17: whether the session on this device still belongs to the account whose key the page was
 * given. True: the same account. False: signed out (the sign-in redirect is caught, never followed)
 * or another account. Null: no answer this time (a server failure), so the page asks again later
 * and never drops files only because the server stumbled. No id or key leaves the server.
 */
export async function isSameUploadAccountAction(expected: unknown): Promise<boolean | null> {
  if (typeof expected !== 'string' || expected.length === 0 || expected.length > 64) return false;
  try {
    return await withSession(async ({ accountId }) => uploadAccountKey(accountId) === expected);
  } catch (error) {
    return isRedirectSignal(error) ? false : null;
  }
}
