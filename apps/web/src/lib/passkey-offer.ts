import 'server-only';
import { getAccountByEmail } from '@visastack/services';
import { hasPasskey } from '@visastack/services/passkeys';
import { neonSessionAgeSeconds } from './neon-recency';
import { requestSessionReader } from './neon-request-session';
import { PASSKEYS_PATH, passkeysEnabled } from './passkeys';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';
import { TRAVELLER_MAX_SESSION_AGE_SECONDS, isStaffContext } from './session-age';

/**
 * Whether the "confirm it is you" page should offer a passkey. Only when it can actually help:
 * the switch is on, someone is signed in, the sign-in is still inside its absolute limit, the
 * account is a traveller's (staff keep the password and authenticator code), and the account has
 * a passkey. Never for the passkeys page itself: adding or removing a passkey needs the typed
 * password, so a passkey there would only send the person round in a loop. Read without
 * `withSession`, which sends a stale sign-in to this very page. Anything unreadable means no
 * offer, so the password form is always there.
 */
export async function passkeyOfferedAtReauth(returnTo: string): Promise<boolean> {
  if (!passkeysEnabled()) return false;
  if (returnTo === PASSKEYS_PATH || returnTo.startsWith(`${PASSKEYS_PATH}?`)) return false;
  try {
    const { data } = await requestSessionReader().getSession();
    const email = data?.user?.email;
    if (!email || !data?.user?.emailVerified) return false;
    if ((await neonSessionAgeSeconds()) > TRAVELLER_MAX_SESSION_AGE_SECONDS) return false;
    return await withPublicDb(async (db) => {
      const account = await getAccountByEmail(db, email);
      if (!account) return false;
      if (await isStaffContext(db, { accountId: account.id, email })) return false;
      return (await hasPasskey(db, account.id)) === true;
    });
  } catch (error) {
    reportServerError('passkeyOffer', error);
    return false;
  }
}
