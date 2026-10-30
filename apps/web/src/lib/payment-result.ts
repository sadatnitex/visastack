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
 *   characters long. A shorter value is not used.
 * - Otherwise a key derived from `NEON_AUTH_COOKIE_SECRET` (always set where people sign in).
 * - With neither, no address is signed and the browser goes to the general result page.
 *
 * Both are turned into the key with the fixed label `visastack.payment-result.v2`, so the secret
 * itself is never exposed by a signature. Addresses signed before this change (key derived from
 * `SSLCOMMERZ_STORE_PASSWORD` with the label `visastack.payment-result.v1`) are still accepted
 * until they expire; owner decision O2 removes that acceptance in a later package, at least 7
 * days after this one is live.
 */

export const PAYMENT_RESULT_LIFETIME_MS = 60 * 60 * 1000;
export const PAYMENT_RESULT_SIGNING_SECRET = 'PAYMENT_RESULT_SIGNING_SECRET';
export const MIN_SIGNING_SECRET_LENGTH = 32;

const LABEL = 'visastack.payment-result.v2';
const LEGACY_LABEL = 'visastack.payment-result.v1';

function derive(secret: string, label: string): Buffer {
  return createHmac('sha256', secret).update(label).digest();
}

/** The key new addresses are signed with, or null when there is no secret to sign with. */
function signingKey(): Buffer | null {
  const own = readEnv(PAYMENT_RESULT_SIGNING_SECRET);
  if (own !== undefined && own.length >= MIN_SIGNING_SECRET_LENGTH) return derive(own, LABEL);
  const cookieSecret = readEnv('NEON_AUTH_COOKIE_SECRET');
  if (cookieSecret) return derive(cookieSecret, LABEL);
  return null;
}

/** Every key an address may have been signed with: today's, then the one used before S19 step 0. */
function verificationKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const current = signingKey();
  if (current) keys.push(current);
  const legacyPassword = readEnv('SSLCOMMERZ_STORE_PASSWORD');
  if (legacyPassword) keys.push(derive(legacyPassword, LEGACY_LABEL));
  return keys;
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
