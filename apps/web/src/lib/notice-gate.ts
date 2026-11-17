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
import { accountsHavePassword } from './social-sign-in';

/**
 * Agreement to the terms of use and the privacy notice for a person who arrives without the sign-up
 * form (Google). The email sign-up form requires a tick and records it before the account exists
 * (docs/public-beta/SIGNUP-SAFEGUARDS.md). A person who signs in with Google has no form, so at the
 * one moment an account would be created for them, `withSession` stops and sends them to
 * `/auth/accept-terms`. Nothing is created until they have agreed. The stop applies only when:
 *  - no account exists yet for their identity or address (`neonAccountExists`), and
 *  - they have not just agreed in this browser (the signed proof below), and
 *  - they have no password (an email sign-up already ticked the form).
 * Anything that cannot be read is treated as "must agree": a mistake can only ask someone to tick
 * a box once more, never create an account without it.
 *
 * The durable record is the audit event written by `acknowledgeSignInNotices`. The proof cookie only
 * carries "this person just agreed to these versions" from that page to the next request, signed
 * with a key derived from the sign-in secret, bound to the Neon user id, valid for an hour, so it
 * cannot be forged, reused for another person, or kept for an older version of the notices.
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

/** True when this identity has a password, which means it came through the sign-up form. */
async function signsInWithPassword(): Promise<boolean> {
  try {
    const { getNeonAuth } = await import('./neon-auth');
    const accounts = await getNeonAuth().listAccounts();
    return accountsHavePassword(accounts.data);
  } catch {
    return false;
  }
}

/** Whether this sign-in must agree to the notices before an account is created for it. */
export async function mustAcknowledgeNotices(
  db: Db,
  user: { readonly id: string; readonly email: string },
): Promise<boolean> {
  if (await neonAccountExists(db, { neonUserId: user.id, email: user.email })) return false;
  if (await hasAgreedProof(user.id)) return false;
  return !(await signsInWithPassword());
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
  const value = proof.encode({ t: SIGNUP_TERMS_VERSION, p: SIGNUP_PRIVACY_VERSION }, neonUserId);
  if (!value) return false;
  (await cookies()).set(
    NOTICES_PROOF_COOKIE,
    value,
    proof.options(readEnv('NODE_ENV') === 'production'),
  );
  return true;
}
