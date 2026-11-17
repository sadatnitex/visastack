import { appendAuditEvent } from './audit';
import type { Db } from './db';
import { checkRateLimit } from './rate-limit';
import { SIGNUP_PRIVACY_VERSION, SIGNUP_TERMS_VERSION } from './signup-notices';

/**
 * The record of agreement to the terms of use and the privacy notice for a person who signs in
 * without the sign-up form (Google). The sign-up form records an acknowledgement before the account
 * exists, keyed to a random form number (`signup-notices.ts`). Someone signing in with Google has
 * no form, so they are stopped once, before their account is created, and asked to agree; this is
 * what that agreement writes. It is keyed to the Neon Auth identity (an immutable id from the
 * signed-in session, never input from the browser), carries the versions they agreed to, and is
 * part of the append-only, hash-chained audit log, so it cannot be edited afterwards.
 */

export const SIGNIN_NOTICES_EVENT = 'SIGNIN_NOTICES_ACKNOWLEDGED';

/** A few tries cover a double click or a retry; more is someone scripting the audit log. */
const ACKNOWLEDGEMENT_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

export interface SignInNoticeInput {
  /** The immutable Neon Auth user id from the authenticated server session. */
  readonly neonUserId: string;
  readonly termsVersion: string;
  readonly privacyVersion: string;
}

/**
 * Appends the acknowledgement. False, and nothing written, for a version that is not the current
 * one, an unusable id, or too many tries; a database or audit failure throws, so the caller
 * cannot go on as if it had been recorded.
 */
export async function acknowledgeSignInNotices(
  db: Db,
  input: SignInNoticeInput,
  now: Date = new Date(),
): Promise<boolean> {
  const neonUserId = input.neonUserId.trim();
  if (
    neonUserId.length === 0 ||
    neonUserId.length > 200 ||
    input.termsVersion !== SIGNUP_TERMS_VERSION ||
    input.privacyVersion !== SIGNUP_PRIVACY_VERSION
  ) {
    return false;
  }
  return db.transaction(async (tx) => {
    const decision = await checkRateLimit(
      tx,
      { subjectId: neonUserId, action: 'auth.signin_notices', label: 'acknowledgement' },
      ACKNOWLEDGEMENT_LIMIT,
      now,
    );
    if (!decision.allowed) return false;
    await appendAuditEvent(tx, {
      eventType: SIGNIN_NOTICES_EVENT,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'neon_user',
      resourceId: neonUserId,
      metadata: {
        termsVersion: SIGNUP_TERMS_VERSION,
        privacyVersion: SIGNUP_PRIVACY_VERSION,
        signedIn: true,
      },
    });
    return true;
  });
}
