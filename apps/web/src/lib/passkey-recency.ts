import 'server-only';
import { passkeyConfirmedAt } from '@visastack/services/passkeys';
import { neonSessionRef } from './neon-recency';
import { passkeysEnabled } from './passkeys';
import { withSession } from './session';
import { isStaffContext } from './session-age';

/**
 * How long ago THIS sign-in was confirmed with a passkey, in seconds, for the traveller step-up
 * check only (`./step-up.ts`). Infinity, meaning "ask for the password as before", whenever:
 * passkeys are switched off; there is no readable sign-in; the step-up is for another account;
 * the account holds any staff role or organization membership (staff rules stay exactly as they
 * were); the passkey table is not there yet; or this sign-in was never confirmed with a passkey.
 *
 * It never signs anyone in and is never used by the absolute session limit (`./session-age.ts`):
 * a passkey cannot make an old sign-in last longer.
 */
export async function passkeyConfirmationAgeSeconds(
  accountId: string,
  now: () => number = Date.now,
): Promise<number> {
  if (!passkeysEnabled()) return Number.POSITIVE_INFINITY;
  const sessionRef = await neonSessionRef();
  if (!sessionRef) return Number.POSITIVE_INFINITY;
  return withSession(async ({ db, accountId: signedIn, email }) => {
    if (signedIn !== accountId) return Number.POSITIVE_INFINITY;
    if (await isStaffContext(db, { accountId, email })) return Number.POSITIVE_INFINITY;
    const at = await passkeyConfirmedAt(db, { accountId, sessionRef });
    if (!at) return Number.POSITIVE_INFINITY;
    return Math.max(0, (now() - at.getTime()) / 1000);
  });
}
