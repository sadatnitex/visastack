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
 * the payment's own state. The key is derived from the store password with a fixed label, so no
 * new secret is needed and the password itself is never exposed by the signature.
 */

export const PAYMENT_RESULT_LIFETIME_MS = 60 * 60 * 1000;

function signingKey(): Buffer | null {
  const password = readEnv('SSLCOMMERZ_STORE_PASSWORD');
  if (!password) return null;
  return createHmac('sha256', password).update('visastack.payment-result.v1').digest();
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
  const key = signingKey();
  if (!key || !params.t || !params.x || !params.s) return false;
  if (!/^[0-9]{1,12}$/.test(params.x)) return false;
  const expiresAt = Number(params.x);
  if (expiresAt * 1000 < now.getTime()) return false;
  const expected = Buffer.from(signature(params.t, expiresAt, key), 'utf8');
  const presented = Buffer.from(params.s, 'utf8');
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
