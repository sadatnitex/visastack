import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAYMENT_RESULT_LIFETIME_MS,
  paymentResultSigningProblem,
  signedPaymentResultPath,
  verifyPaymentResultParams,
} from './payment-result';

const TRAN = 'VSP0123456789abcdef0123456789';

const OWN_SECRET = 'synthetic-result-signing-secret-of-40-chars';
const COOKIE_SECRET = 'synthetic-cookie-secret-0123456789abcdef0123456789abcdef';

beforeEach(() => {
  // S19 step 0: the key is VisaStack's own, never a payment provider's.
  vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', OWN_SECRET);
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', COOKIE_SECRET);
  vi.stubEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-store-password');
});
afterEach(() => vi.unstubAllEnvs());

function parts(path: string | null) {
  const url = new URL(path ?? 'https://x.invalid/', 'https://app.example.test');
  return {
    t: url.searchParams.get('t') ?? undefined,
    x: url.searchParams.get('x') ?? undefined,
    s: url.searchParams.get('s') ?? undefined,
  };
}

describe('the signed payment result address', () => {
  it('verifies for the hour it was made for, and not after', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const path = signedPaymentResultPath(TRAN, now);
    expect(path).toMatch(/^\/payments\/result\?/);
    expect(verifyPaymentResultParams(parts(path), now)).toBe(true);
    const nearEnd = new Date(now.getTime() + PAYMENT_RESULT_LIFETIME_MS - 2_000);
    expect(verifyPaymentResultParams(parts(path), nearEnd)).toBe(true);
    const after = new Date(now.getTime() + PAYMENT_RESULT_LIFETIME_MS + 2_000);
    expect(verifyPaymentResultParams(parts(path), after)).toBe(false);
  });

  it('refuses a changed transaction, expiry or signature, and missing parts', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const good = parts(signedPaymentResultPath(TRAN, now));
    expect(verifyPaymentResultParams({ ...good, t: 'VSPother' }, now)).toBe(false);
    expect(verifyPaymentResultParams({ ...good, x: String(Number(good.x) + 86_400) }, now)).toBe(
      false,
    );
    expect(verifyPaymentResultParams({ ...good, s: `${good.s?.slice(0, -1)}A` }, now)).toBe(false);
    expect(verifyPaymentResultParams({ ...good, s: undefined }, now)).toBe(false);
    expect(verifyPaymentResultParams({ ...good, x: '1e12' }, now)).toBe(false);
    expect(verifyPaymentResultParams({ t: undefined, x: undefined, s: undefined }, now)).toBe(
      false,
    );
  });

  it('cannot be made or checked without a signing secret, and a different secret does not verify', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const good = parts(signedPaymentResultPath(TRAN, now));
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', 'a-different-result-signing-secret-of-40c');
    expect(verifyPaymentResultParams(good, now)).toBe(false);
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'a-different-cookie-secret-0123456789abcdef0123');
    expect(verifyPaymentResultParams(good, now)).toBe(false);
    // No own secret and no sign-in cookie secret: nothing is signed and nothing verifies, even
    // with the store password still set (it is no longer a signing key).
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', '');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', '');
    expect(signedPaymentResultPath(TRAN, now)).toBeNull();
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', OWN_SECRET);
    vi.stubEnv('SSLCOMMERZ_STORE_PASSWORD', '');
    expect(verifyPaymentResultParams(good, now)).toBe(true);
  });

  it('never derives a key from a sign-in cookie secret shorter than 32 characters', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', '');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'short-cookie-secret');
    expect(signedPaymentResultPath(TRAN, now)).toBeNull();
    // A link made with a key from that short secret is not accepted either.
    const key = createHmac('sha256', 'short-cookie-secret')
      .update('visastack.payment-result.v2')
      .digest();
    const expiresAt = Math.floor((now.getTime() + PAYMENT_RESULT_LIFETIME_MS) / 1000);
    const s = createHmac('sha256', key)
      .update(`${TRAN}.${expiresAt}`)
      .digest('base64url')
      .slice(0, 43);
    expect(verifyPaymentResultParams({ t: TRAN, x: String(expiresAt), s }, now)).toBe(false);
  });

  it('falls back to a key from the sign-in cookie secret, and never uses a secret shorter than 32 characters', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', 'too-short-secret');
    const fromCookie = parts(signedPaymentResultPath(TRAN, now));
    expect(verifyPaymentResultParams(fromCookie, now)).toBe(true);
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', '');
    expect(verifyPaymentResultParams(fromCookie, now)).toBe(true);
    // The own secret, once long enough, signs new links; a link signed with the cookie-derived key
    // just before the switch still works until it expires.
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', OWN_SECRET);
    const fromOwn = parts(signedPaymentResultPath(TRAN, now));
    expect(fromOwn.s).not.toBe(fromCookie.s);
    expect(verifyPaymentResultParams(fromOwn, now)).toBe(true);
    expect(verifyPaymentResultParams(fromCookie, now)).toBe(true);
    expect(
      verifyPaymentResultParams(
        fromCookie,
        new Date(now.getTime() + PAYMENT_RESULT_LIFETIME_MS + 2_000),
      ),
    ).toBe(false);
    // A link from the own secret does not verify once that secret is gone.
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', '');
    expect(verifyPaymentResultParams(fromOwn, now)).toBe(false);
  });

  it('reports a signing secret that is set but too short, without showing it', () => {
    expect(paymentResultSigningProblem({})).toBeNull();
    expect(paymentResultSigningProblem({ PAYMENT_RESULT_SIGNING_SECRET: '' })).toBeNull();
    expect(paymentResultSigningProblem({ PAYMENT_RESULT_SIGNING_SECRET: OWN_SECRET })).toBeNull();
    const problem = paymentResultSigningProblem({
      PAYMENT_RESULT_SIGNING_SECRET: 'sk_short_pasted_value',
    });
    expect(problem).toMatch(/PAYMENT_RESULT_SIGNING_SECRET is set but shorter than 32/);
    expect(problem).not.toContain('sk_short_pasted_value');
  });

  it('never accepts a link signed with the store password (decision O2 closed)', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const expiresAt = Math.floor((now.getTime() + PAYMENT_RESULT_LIFETIME_MS) / 1000);
    const legacyKey = createHmac('sha256', 'synthetic-store-password')
      .update('visastack.payment-result.v1')
      .digest();
    const s = createHmac('sha256', legacyKey)
      .update(`${TRAN}.${expiresAt}`)
      .digest('base64url')
      .slice(0, 43);
    const forged = { t: TRAN, x: String(expiresAt), s };
    // Whoever holds the store password cannot make a result link.
    expect(verifyPaymentResultParams(forged, now)).toBe(false);
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', '');
    expect(verifyPaymentResultParams(forged, now)).toBe(false);
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', '');
    expect(verifyPaymentResultParams(forged, now)).toBe(false);
    // New links are never signed with the store password.
    vi.stubEnv('PAYMENT_RESULT_SIGNING_SECRET', OWN_SECRET);
    expect(parts(signedPaymentResultPath(TRAN, now)).s).not.toBe(s);
  });

  it('does not contain any secret', () => {
    const path = signedPaymentResultPath(TRAN) ?? '';
    expect(path).not.toContain('synthetic-store-password');
    expect(path).not.toContain(OWN_SECRET);
    expect(path).not.toContain(COOKIE_SECRET);
  });
});
