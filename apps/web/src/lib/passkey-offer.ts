import 'server-only';
import { getAccountByEmail } from '@visastack/services';
import { hasPasskey } from '@visastack/services/passkeys';
import { neonSessionAgeSeconds } from './neon-recency';
import { requestSessionReader } from './neon-request-session';
import { passkeysEnabled } from './passkeys';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';
import { isStaffContext } from './session-age';

/** The traveller absolute limit (session-age.ts): past it only a new sign-in helps. */
const TRAVELLER_MAX_SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Whether the "confirm it is you" page should offer a passkey. Only when it can actually help:
 * the switch is on, someone is signed in, the sign-in is still inside its absolute limit, the
 * account is a traveller's (staff keep the password and authenticator code), and the account has
 * a passkey. Read without `withSession`, which sends a stale sign-in to this very page. Anything
 * unreadable means no offer, so the password form is always there.
 */
export async function passkeyOfferedAtReauth(): Promise<boolean> {
  if (!passkeysEnabled()) return false;
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
