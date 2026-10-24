import { appendAuditEvent } from './audit';
import type { Db } from './db';
import { checkRateLimit } from './rate-limit';

export const SIGNUP_TERMS_VERSION = '2026-10-24.1';
export const SIGNUP_PRIVACY_VERSION = '2026-10-24.1';
export const SIGNUP_FORM_LIFETIME_MS = 20 * 60 * 1000;

export interface SignupNoticeInput {
  readonly formId: string;
  readonly expiresAt: number;
  readonly termsVersion: string;
  readonly privacyVersion: string;
}

/** Records an unauthenticated form acknowledgement, not verified identity or optional consent. */
export async function acknowledgeSignupNotices(
  db: Db,
  input: SignupNoticeInput,
  now: number = Date.now(),
): Promise<boolean> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.formId) ||
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= now ||
    input.expiresAt > now + SIGNUP_FORM_LIFETIME_MS ||
    input.termsVersion !== SIGNUP_TERMS_VERSION ||
    input.privacyVersion !== SIGNUP_PRIVACY_VERSION
  )
    return false;

  return db.transaction(async (tx) => {
    // Pin the counter to the expiry's day, so midnight and pruning cannot reopen a live form.
    const decision = await checkRateLimit(
      tx,
      { subjectId: input.formId, action: 'auth.signup_form', label: 'registration' },
      { limit: 1, windowMs: 24 * 60 * 60 * 1000 },
      new Date(input.expiresAt),
    );
    if (!decision.allowed) return false;
    await appendAuditEvent(tx, {
      eventType: 'SIGNUP_NOTICES_ACKNOWLEDGED',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'signup_form',
      resourceId: input.formId,
      metadata: {
        termsVersion: SIGNUP_TERMS_VERSION,
        privacyVersion: SIGNUP_PRIVACY_VERSION,
        identityVerified: false,
      },
    });
    return true;
  });
}
