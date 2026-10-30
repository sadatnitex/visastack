import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from './env';

/**
 * The signed address of the plain-language payment result page (ADR 0020).
 *
 * After the browser comes back from the payment page, VisaStack settles the payment with the
 * gateway and then sends the browser to `/payments/result`. The address carries the transaction
 * id, an expiry and a signature, so a result page can only be reached by a redirect VisaStack
 * itself made, and only for an hour. The page never takes its answer from the address: it reads
 * the payment's own state, and the address grants nothing.
 *
 * The signing key (S19 step 0) belongs to VisaStack, not to any payment provider, so it works the
 * same whichever provider took the payment:
 *
 * - `PAYMENT_RESULT_SIGNING_SECRET`, used as it is (no trimming) when it is at least 32
 *   characters long. A shorter value is not used, and the readiness check reports it
 *   (`paymentResultSigningProblem`, never showing the value).
 * - Otherwise a key derived from `NEON_AUTH_COOKIE_SECRET` (always set where people sign in), under
 *   the same 32-character minimum.
 * - With neither, no address is signed and the browser goes to the general result page.
 *
 * Both are turned into the key with the fixed label `visastack.payment-result.v2`, so the secret
 * itself is never exposed by a signature. Once `PAYMENT_RESULT_SIGNING_SECRET` is set, an address
 * signed with the cookie-derived key is still accepted until it expires, so links handed out just
 * before the switch keep working.
 *
 * No payment provider's credential is ever a key (S19 step 0 round 2, owner decision O2 closed):
 * production never had SSLCOMMERZ set up, so no address was ever signed with the store password,
 * and accepting that key would only let whoever holds the store password forge one.
 */

export const PAYMENT_RESULT_LIFETIME_MS = 60 * 60 * 1000;
export const PAYMENT_RESULT_SIGNING_SECRET = 'PAYMENT_RESULT_SIGNING_SECRET';
export const MIN_SIGNING_SECRET_LENGTH = 32;

const LABEL = 'visastack.payment-result.v2';

function derive(secret: string): Buffer {
  return createHmac('sha256', secret).update(LABEL).digest();
}

/** A secret long enough to sign with, or null. */
function usable(secret: string | undefined): string | null {
  return secret !== undefined && secret.length >= MIN_SIGNING_SECRET_LENGTH ? secret : null;
}

/** The key derived from the sign-in cookie secret, or null when that secret is missing or short. */
function cookieKey(): Buffer | null {
  const cookieSecret = usable(readEnv('NEON_AUTH_COOKIE_SECRET'));
  return cookieSecret === null ? null : derive(cookieSecret);
}

/** The key new addresses are signed with, or null when there is no secret to sign with. */
function signingKey(): Buffer | null {
  const own = usable(readEnv(PAYMENT_RESULT_SIGNING_SECRET));
  return own === null ? cookieKey() : derive(own);
}

/**
 * Every key an address may have been signed with: today's, then (once the own secret is in use)
 * the cookie-derived one, so a link signed just before the switch still works until it expires.
 */
function verificationKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const current = signingKey();
  if (current) keys.push(current);
  const fromCookie = cookieKey();
  if (fromCookie && !(current && fromCookie.equals(current))) keys.push(fromCookie);
  return keys;
}

/**
 * Why the signing setting cannot be used as it is, for the readiness check, or null:
 * `PAYMENT_RESULT_SIGNING_SECRET` is set but shorter than 32 characters. Names the setting only,
 * never its value or its length.
 */
export function paymentResultSigningProblem(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const own = Object.hasOwn(env, PAYMENT_RESULT_SIGNING_SECRET)
    ? env[PAYMENT_RESULT_SIGNING_SECRET]
    : undefined;
  if (own === undefined || own === '') return null;
  return own.length >= MIN_SIGNING_SECRET_LENGTH
    ? null
    : `${PAYMENT_RESULT_SIGNING_SECRET} is set but shorter than ${MIN_SIGNING_SECRET_LENGTH} characters, so it is not used`;
}

function signature(merchantTranId: string, expiresAt: number, key: Buffer): string {
  return createHmac('sha256', key)
    .update(`${merchantTranId}.${expiresAt}`)
    .digest('base64url')
    .slice(0, 43);
}

/** The relative address of the result page for one payment, or null when signing is not possible. */
export function signedPaymentResultPath(
  merchantTranId: string,
  now: Date = new Date(),
): string | null {
  const key = signingKey();
  if (!key) return null;
  const expiresAt = Math.floor((now.getTime() + PAYMENT_RESULT_LIFETIME_MS) / 1000);
  const params = new URLSearchParams({
    t: merchantTranId,
    x: String(expiresAt),
    s: signature(merchantTranId, expiresAt, key),
  });
  return `/payments/result?${params.toString()}`;
}

/** True when the address parts were signed by VisaStack and have not expired. */
export function verifyPaymentResultParams(
  params: {
    readonly t: string | undefined;
    readonly x: string | undefined;
    readonly s: string | undefined;
  },
  now: Date = new Date(),
): boolean {
  if (!params.t || !params.x || !params.s) return false;
  if (!/^[0-9]{1,12}$/.test(params.x)) return false;
  const expiresAt = Number(params.x);
  if (expiresAt * 1000 < now.getTime()) return false;
  const presented = Buffer.from(params.s, 'utf8');
  let matched = false;
  // Every key is compared (no early exit), each in constant time.
  for (const key of verificationKeys()) {
    const expected = Buffer.from(signature(params.t, expiresAt, key), 'utf8');
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) {
      matched = true;
    }
  }
  return matched;
}
