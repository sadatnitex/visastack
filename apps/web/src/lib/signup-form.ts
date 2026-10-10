import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  SIGNUP_FORM_LIFETIME_MS,
  SIGNUP_PRIVACY_VERSION,
  SIGNUP_TERMS_VERSION,
  type SignupNoticeInput,
  acknowledgeSignupNotices,
} from '@visastack/services';
import { readNeonAuthSettings } from './neon-auth';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';

const PURPOSE = 'visastack/signup-notices/v1:';

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(PURPOSE).update(payload).digest();
}

/** Purpose-separated signatures reuse the existing protected Auth key without replacing it. */
export function createSignupForm(now: number = Date.now()): string {
  const input: SignupNoticeInput = {
    formId: randomUUID(),
    expiresAt: now + SIGNUP_FORM_LIFETIME_MS,
    termsVersion: SIGNUP_TERMS_VERSION,
    privacyVersion: SIGNUP_PRIVACY_VERSION,
  };
  const payload = Buffer.from(JSON.stringify(input)).toString('base64url');
  return `${payload}.${signature(payload, readNeonAuthSettings().cookieSecret).toString('base64url')}`;
}

export function readSignupForm(token: string, now: number = Date.now()): SignupNoticeInput | null {
  if (token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const actual = Buffer.from(parts[1], 'base64url');
    const expected = signature(parts[0], readNeonAuthSettings().cookieSecret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const input = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8'),
    ) as SignupNoticeInput;
    if (
      typeof input.formId !== 'string' ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= now ||
      input.expiresAt > now + SIGNUP_FORM_LIFETIME_MS ||
      input.termsVersion !== SIGNUP_TERMS_VERSION ||
      input.privacyVersion !== SIGNUP_PRIVACY_VERSION
    )
      return null;
    return input;
  } catch {
    return null;
  }
}

/** Database errors refuse the attempt before account creation or sending a confirmation email. */
export async function consumeSignupForm(input: SignupNoticeInput): Promise<boolean> {
  try {
    return await withPublicDb((db) => acknowledgeSignupNotices(db, input));
  } catch (error) {
    reportServerError('signupForm', error, { step: 'record notice acknowledgement' });
    return false;
  }
}
