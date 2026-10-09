import 'server-only';
import { createHash } from 'node:crypto';
import { RATE_LIMITS, checkRateLimit } from '@visastack/services';
import { headers } from 'next/headers';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';

/**
 * Limits on the sign-in, sign-up and recovery forms. Counters are kept per hashed address and per
 * hashed network address in the existing database counter table, so one person cannot lock
 * another out of a different address and one source cannot drain the daily email allowance.
 * Raw addresses are never stored here, only short hashes.
 */

type AuthLimit =
  | 'AUTH_SIGN_IN_EMAIL'
  | 'AUTH_SIGN_IN_IP'
  | 'AUTH_SIGN_UP_IP'
  | 'AUTH_SIGN_UP_EMAIL'
  | 'AUTH_EMAIL_SEND_EMAIL'
  | 'AUTH_EMAIL_SEND_IP';

function digest(kind: string, value: string): string {
  return `${kind}:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
}

async function clientAddress(): Promise<string> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || list.get('x-real-ip')?.trim() || 'unknown';
}

export interface AuthThrottleInput {
  readonly email: string;
  readonly byEmail: AuthLimit;
  readonly byAddress: AuthLimit;
  /** What to do when the counter itself cannot be read: keep sign-in usable, but never let email sending run unchecked. */
  readonly onFailure: 'allow' | 'deny';
}

/** True when this attempt is within the limits. */
export async function withinAuthLimits(input: AuthThrottleInput): Promise<boolean> {
  try {
    const address = await clientAddress();
    return await withPublicDb(async (db) => {
      const byEmail = await checkRateLimit(
        db,
        {
          subjectId: digest('email', input.email),
          action: `auth.${input.byEmail}`,
          label: 'attempt',
        },
        RATE_LIMITS[input.byEmail],
      );
      const byAddress = await checkRateLimit(
        db,
        { subjectId: digest('net', address), action: `auth.${input.byAddress}`, label: 'attempt' },
        RATE_LIMITS[input.byAddress],
      );
      return byEmail.allowed && byAddress.allowed;
    });
  } catch (error) {
    reportServerError('authThrottle', error, { step: 'rate limit check' });
    return input.onFailure === 'allow';
  }
}
