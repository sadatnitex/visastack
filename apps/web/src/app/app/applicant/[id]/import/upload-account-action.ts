'use server';

import { withSession } from '../../../../../lib/session';
import { uploadAccountKey } from './upload-account';

/**
 * WP-PIC17: whether the session on this device still belongs to the account whose key the page was
 * given. Answers only yes or no: no id, no key, nothing else leaves the server. Signed out, an
 * unconfirmed address, or any other failure is "no", so waiting files are never sent under a
 * sign-in other than the one that chose them.
 */
export async function isSameUploadAccountAction(expected: unknown): Promise<boolean> {
  if (typeof expected !== 'string' || expected.length === 0 || expected.length > 64) return false;
  try {
    return await withSession(async ({ accountId }) => uploadAccountKey(accountId) === expected);
  } catch {
    // Includes the sign-in redirect for a signed-out session: never followed from here.
    return false;
  }
}
