import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAccountByEmail } from '@visastack/services';
import { bootstrapAdminEmails } from './admin-emails';
import { withPublicDb } from './public-db';
import { isStaffContext } from './session-age';

/**
 * Two guards for sign-in links (Q8), independent of Neon Auth.
 *
 * 1. The browser that asked for a link holds a signed, short-lived "link pending" cookie. The link
 *    landing accepts a new sign-in only in a browser holding one, so a link someone else asked for
 *    (for their own account) can never sign this browser in. The cookie is set for every valid
 *    address, so it says nothing about who has an account.
 * 2. A link never makes a staff sign-in: staff (a platform role, an organization membership, or a
 *    bootstrap address) sign in and confirm with the password, as before.
 */

export const LINK_PENDING_LIFETIME_S = 15 * 60;
const SIGNING_PURPOSE = 'visastack/sign-in-link-pending/v1:';

export function linkPendingCookieName(secure: boolean): string {
  return secure ? '__Host-vs-link-pending' : 'vs-link-pending';
}

/** Lax, so it travels on the link's top-level return from Neon Auth; httpOnly, host-only. */
export function linkPendingCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: LINK_PENDING_LIFETIME_S };
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(SIGNING_PURPOSE).update(payload).digest();
}

export function encodeLinkPending(secret: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      n: randomBytes(16).toString('base64url'),
      e: now + LINK_PENDING_LIFETIME_S * 1000,
    }),
  ).toString('base64url');
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}

/** True only for a cookie this site signed that has not expired. */
export function linkPendingValid(
  value: string | undefined,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!value || value.length > 512) return false;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  try {
    const actual = Buffer.from(parts[1], 'base64url');
    const expected = signature(parts[0], secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      e?: unknown;
    };
    return typeof payload.e === 'number' && payload.e >= now;
  } catch {
    return false;
  }
}

/**
 * Whether this address belongs to staff. Null when it cannot be read, which every caller treats
 * as "do not use a link" (fail closed).
 */
export async function emailIsStaff(email: string): Promise<boolean | null> {
  try {
    return await withPublicDb(async (db) => {
      const account = await getAccountByEmail(db, email);
      if (!account) {
        return bootstrapAdminEmails().includes(email.trim().toLowerCase());
      }
      return isStaffContext(db, { accountId: account.id, email });
    });
  } catch {
    return null;
  }
}
