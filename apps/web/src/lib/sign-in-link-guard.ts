import 'server-only';
import { getAccountByEmail } from '@visastack/services';
import { bootstrapAdminEmails } from './admin-emails';
import { withPublicDb } from './public-db';
import { isStaffContext } from './session-age';

/**
 * A sign-in link never makes a staff sign-in (Q8): staff (a platform role, an organization
 * membership, or a bootstrap address) sign in and confirm with the password, as before.
 * The browser-bound "link pending" mark lives in `./link-pending.ts`.
 */

/**
 * Whether this address belongs to staff. Null when it cannot be read, which every caller treats
 * as "do not use a link" (fail closed).
 */
export async function emailIsStaff(email: string): Promise<boolean | null> {
  try {
    return await withPublicDb(async (db) => {
      const account = await getAccountByEmail(db, email);
      if (!account) {
        return bootstrapAdminEmails().includes(email.trim().toLowerCase());
      }
      return isStaffContext(db, { accountId: account.id, email });
    });
  } catch {
    return null;
  }
}
