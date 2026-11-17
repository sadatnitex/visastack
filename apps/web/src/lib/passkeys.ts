import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PasskeyRelyingParty } from '@visastack/services/passkeys';
import { resolveBaseUrl } from './base-url';

/**
 * Passkeys that confirm sensitive actions (Q8, ADR 0028), as the web app runs them.
 *
 * `PASSKEYS` is off unless it is exactly "on" (after trimming, any case), so deploying this changes
 * nothing for anyone until the owner switches it on. A passkey never signs anyone in: it only
 * stands in for a recently typed password at a traveller's step-up, inside a sign-in that already
 * exists (see `./step-up.ts`).
 *
 * The challenge a browser is given lives in a short-lived, signed, httpOnly cookie bound to the
 * purpose, the account and the current sign-in (session ref). It is cleared as soon as it is read,
 * and the database refuses the same challenge twice, so an answer cannot be replayed.
 */

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/** Where people see and manage their passkeys. */
export const PASSKEYS_PATH = '/app/account/passkeys';

export function passkeysEnabled(): boolean {
  return readEnv('PASSKEYS')?.trim().toLowerCase() === 'on';
}

/** The site passkeys belong to: the app's own origin and host name. */
export function passkeyRelyingParty(base: string = resolveBaseUrl()): PasskeyRelyingParty {
  const url = new URL(base);
  return { rpID: url.hostname, origin: url.origin, rpName: 'VisaStack' };
}

export type PasskeyPurpose = 'add' | 'confirm';

export const PASSKEY_CHALLENGE_LIFETIME_MS = 2 * 60 * 1000;

export function passkeyChallengeCookieName(secure: boolean): string {
  return secure ? '__Host-vs-passkey' : 'vs-passkey';
}

export function passkeyChallengeCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: PASSKEY_CHALLENGE_LIFETIME_MS / 1000,
  };
}

interface ChallengeBinding {
  readonly purpose: PasskeyPurpose;
  readonly accountId: string;
  readonly sessionRef: string;
}

interface ChallengePayload {
  readonly c: string;
  readonly p: PasskeyPurpose;
  readonly a: string;
  readonly s: string;
  readonly e: number;
}

const SIGNING_PURPOSE = 'visastack/passkey-challenge/v1:';

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(SIGNING_PURPOSE).update(payload).digest();
}

/** A signed cookie value carrying this challenge for this purpose, account and sign-in. */
export function encodePasskeyChallenge(
  challenge: string,
  binding: ChallengeBinding,
  secret: string,
  now: number = Date.now(),
): string {
  const payload: ChallengePayload = {
    c: challenge,
    p: binding.purpose,
    a: binding.accountId,
    s: binding.sessionRef,
    e: now + PASSKEY_CHALLENGE_LIFETIME_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, secret).toString('base64url')}`;
}

export interface PasskeyChallenge {
  readonly challenge: string;
  /** When it was given out (its expiry less its lifetime). */
  readonly issuedAt: Date;
}

/**
 * The challenge in a cookie value, only if the signature holds, it has not expired, and it was
 * made for exactly this purpose, account and sign-in. Anything else is null.
 */
export function readPasskeyChallenge(
  value: string | undefined,
  binding: ChallengeBinding,
  secret: string,
  now: number = Date.now(),
): PasskeyChallenge | null {
  if (!value || value.length > 2048) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const actual = Buffer.from(parts[1], 'base64url');
    const expected = signature(parts[0], secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Partial<
      Record<keyof ChallengePayload, unknown>
    >;
    if (typeof payload.c !== 'string' || payload.c.length === 0 || payload.c.length > 512) {
      return null;
    }
    if (typeof payload.e !== 'number' || payload.e < now) return null;
    if (payload.p !== binding.purpose) return null;
    if (payload.a !== binding.accountId || payload.s !== binding.sessionRef) return null;
    return { challenge: payload.c, issuedAt: new Date(payload.e - PASSKEY_CHALLENGE_LIFETIME_MS) };
  } catch {
    return null;
  }
}
