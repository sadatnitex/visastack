import 'server-only';
import { getAccountByEmail } from '@visastack/services';
import { hasPasskey } from '@visastack/services/passkeys';
import { neonSessionAgeSeconds } from './neon-recency';
import { requestSessionReader } from './neon-request-session';
import { PASSKEYS_PATH, passkeysEnabled } from './passkeys';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';
import { TRAVELLER_MAX_SESSION_AGE_SECONDS, isStaffContext } from './session-age';
import { signInLinksEnabled } from './sign-in-links';

export interface ReauthChoices {
  /** Offer "Use Face ID, Fingerprint or Screen Lock". */
  readonly passkey: boolean;
  /** Offer "Email Me a Sign-In Link Instead". */
  readonly link: boolean;
}

const NONE: ReauthChoices = { passkey: false, link: false };

/**
 * What the "confirm it is you" page may offer besides the password (Q8), decided on the server.
 * Both need a signed-in traveller: staff (a platform role, an organization membership, or a
 * bootstrap address) keep the password and authenticator code exactly as before.
 *
 * - Passkey: switch on, the sign-in is still inside its absolute limit, the account has a passkey,
 *   and the way back is not the passkeys page (adding or removing a passkey needs a fresh sign-in,
 *   so a passkey there would only send the person round in a loop).
 * - Email link: switch on.
 *
 * Read without `withSession`, which sends a stale sign-in to this very page. Anything unreadable
 * offers nothing, so the password form is always there.
 */
export async function reauthChoices(returnTo: string): Promise<ReauthChoices> {
  const passkeysOn = passkeysEnabled();
  const linksOn = signInLinksEnabled();
  if (!passkeysOn && !linksOn) return NONE;
  try {
    const { data } = await requestSessionReader().getSession();
    const email = data?.user?.email;
    if (!email || !data?.user?.emailVerified) return NONE;
    const returningToPasskeys =
      returnTo === PASSKEYS_PATH || returnTo.startsWith(`${PASSKEYS_PATH}?`);
    const withinLimit = (await neonSessionAgeSeconds()) <= TRAVELLER_MAX_SESSION_AGE_SECONDS;
    return await withPublicDb(async (db) => {
      const account = await getAccountByEmail(db, email);
      if (!account) return NONE;
      if (await isStaffContext(db, { accountId: account.id, email })) return NONE;
      const passkey =
        passkeysOn &&
        withinLimit &&
        !returningToPasskeys &&
        (await hasPasskey(db, account.id)) === true;
      return { passkey, link: linksOn };
    });
  } catch (error) {
    reportServerError('reauthChoices', error);
    return NONE;
  }
}
