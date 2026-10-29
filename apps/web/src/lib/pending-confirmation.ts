import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from './env';

/**
 * The address a person just asked us to confirm, remembered for a short while in their own
 * browser, so the "Confirm Your Email Address" page can say where the link went and offer one
 * tap to send it again, instead of asking them to type the address a second time.
 *
 * The cookie holds the address they typed themselves, an expiry and a signature: it is httpOnly
 * (no script reads it), scoped to `/auth`, and lives 30 minutes. The signature means only
 * VisaStack can have written it, so the page never shows an address someone else planted. The key
 * is derived from the sign-in cookie secret with a fixed label, so no new secret is needed and the
 * secret itself is never exposed. Sending the link again still goes through the usual rate limits.
 */

export const PENDING_CONFIRMATION_COOKIE = 'vs_pending_confirmation';
export const PENDING_CONFIRMATION_LIFETIME_S = 30 * 60;

function signingKey(): Buffer | null {
  const secret = readEnv('NEON_AUTH_COOKIE_SECRET');
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update('visastack.pending-confirmation.v1').digest();
}

function signature(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** The cookie value for one address, or null when it cannot be signed. */
export function encodePendingConfirmation(email: string, now: Date = new Date()): string | null {
  const key = signingKey();
  if (!key) return null;
  const expiresAt = Math.floor(now.getTime() / 1000) + PENDING_CONFIRMATION_LIFETIME_S;
  const payload = Buffer.from(JSON.stringify({ e: email, x: expiresAt }), 'utf8').toString(
    'base64url',
  );
  return `${payload}.${signature(payload, key)}`;
}

/** The address in a cookie value VisaStack signed and that has not expired, else null. */
export function decodePendingConfirmation(
  value: string | undefined,
  now: Date = new Date(),
): string | null {
  const key = signingKey();
  if (!key || !value || value.length > 1024) return null;
  const [payload, presented, extra] = value.split('.');
  if (!payload || !presented || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, key), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { e, x } = parsed as { e?: unknown; x?: unknown };
    if (typeof e !== 'string' || typeof x !== 'number') return null;
    if (x * 1000 < now.getTime()) return null;
    return e;
  } catch {
    return null;
  }
}

/** "s•••@nitex.com": enough to recognise the address, not enough to read it over a shoulder. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** Cookie settings: only the server reads it, only the sign-in pages receive it. */
export function pendingConfirmationCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/auth',
    maxAge: PENDING_CONFIRMATION_LIFETIME_S,
  };
}
