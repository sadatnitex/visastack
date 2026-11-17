import 'server-only';
import {
  type Db,
  SIGNUP_PRIVACY_VERSION,
  SIGNUP_TERMS_VERSION,
  acknowledgeSignInNotices,
  neonAccountExists,
} from '@visastack/services';
import { cookies } from 'next/headers';
import { readEnv } from './env';
import { signedRetryCookie } from './signed-retry-cookie';
import { accountsHavePassword, withTimeout } from './social-sign-in';

/**
 * Agreement to the terms of use and the privacy notice for a person who arrives without the sign-up
 * form (Google). The email sign-up form requires a tick and records it before the account exists
 * (docs/public-beta/SIGNUP-SAFEGUARDS.md). A person who signs in with Google has no form, so at the
 * one moment an account would be created for them, `withSession` stops and sends them to
 * `/auth/notice-check`, and nothing is created until they have agreed.
 *
 * Two questions, kept apart because of where each can be asked:
 *  - `mustAcknowledgeNotices` (pages and `withSession`): is this a NEW account (none exists for the
 *    identity or address) that has not just agreed in this browser? It reads only the database and
 *    the signed proof below, never Neon Auth, because a page render may not write the cookies Neon
 *    Auth can send back.
 *  - `signsInWithPassword` (the `/auth/notice-check` route only, which may write cookies): did this
 *    identity come through the sign-up form? Then it has a password, the form already recorded the
 *    acknowledgement, and `markNoticesSettled` keeps a proof so nothing else is asked.
 * Anything that cannot be read counts as "must agree": a mistake only asks someone to tick a box
 * once more, never creates an account without it.
 *
 * The durable record of a tick is the audit event written by `acknowledgeSignInNotices`. The proof
 * cookie only carries "this is settled for these versions" to the next request, signed with a key
 * derived from the sign-in secret, bound to the Neon user id, valid for an hour, so it cannot be
 * forged, reused for another person, or kept for an older version of the notices.
 */

export const NOTICES_PROOF_COOKIE = 'vs_notices_agreed';
const PROOF_LIFETIME_S = 60 * 60;

const proof = signedRetryCookie({
  label: 'visastack.notices-agreed.v1',
  path: '/',
  lifetimeS: PROOF_LIFETIME_S,
  maxLength: 400,
});

async function hasAgreedProof(neonUserId: string): Promise<boolean> {
  const value = (await cookies()).get(NOTICES_PROOF_COOKIE)?.value;
  const fields: Record<string, unknown> = proof.decode(value, neonUserId) ?? {};
  const { t, p } = fields;
  return t === SIGNUP_TERMS_VERSION && p === SIGNUP_PRIVACY_VERSION;
}

/** Time allowed for Neon Auth to say how the person signs in; after it, they are asked to agree. */
const ACCOUNT_LOOKUP_TIMEOUT_MS = 3000;

/**
 * True when this identity has a password, which means it came through the sign-up form. Calls Neon
 * Auth, so it belongs in a route handler (which may write cookies), never in a page render. False
 * for anything unreadable or slow.
 */
export async function signsInWithPassword(): Promise<boolean> {
  try {
    const { getNeonAuth } = await import('./neon-auth');
    const accounts = await withTimeout(getNeonAuth().listAccounts(), ACCOUNT_LOOKUP_TIMEOUT_MS);
    return accountsHavePassword(accounts.data);
  } catch {
    return false;
  }
}

/**
 * Whether this sign-in is a new account that has not yet agreed. Reads only the database and the
 * signed proof, so a page may call it.
 */
export async function mustAcknowledgeNotices(
  db: Db,
  user: { readonly id: string; readonly email: string },
): Promise<boolean> {
  if (await neonAccountExists(db, { neonUserId: user.id, email: user.email })) return false;
  return !(await hasAgreedProof(user.id));
}

function keepProof(neonUserId: string, how: 'tick' | 'form'): Promise<boolean> {
  const value = proof.encode(
    { t: SIGNUP_TERMS_VERSION, p: SIGNUP_PRIVACY_VERSION, w: how },
    neonUserId,
  );
  if (!value) return Promise.resolve(false);
  return cookies().then((store) => {
    store.set(NOTICES_PROOF_COOKIE, value, proof.options(readEnv('NODE_ENV') === 'production'));
    return true;
  });
}

/**
 * For a person who came through the sign-up form (they have a password): keep a proof so nothing
 * is asked of them. Writes a cookie, so route handlers and server actions only.
 */
export async function markNoticesSettled(neonUserId: string): Promise<boolean> {
  return keepProof(neonUserId, 'form');
}

/**
 * Records the agreement and keeps the proof for the next request. False when nothing was
 * recorded (old versions, too many tries) or the proof cannot be signed; throws when the audit
 * log cannot be written, so nobody moves on as if they had agreed.
 */
export async function acknowledgeNotices(db: Db, neonUserId: string): Promise<boolean> {
  const recorded = await acknowledgeSignInNotices(db, {
    neonUserId,
    termsVersion: SIGNUP_TERMS_VERSION,
    privacyVersion: SIGNUP_PRIVACY_VERSION,
  });
  if (!recorded) return false;
  return keepProof(neonUserId, 'tick');
}
