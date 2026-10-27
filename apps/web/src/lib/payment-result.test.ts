import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAYMENT_RESULT_LIFETIME_MS,
  signedPaymentResultPath,
  verifyPaymentResultParams,
} from './payment-result';

const TRAN = 'VSP0123456789abcdef0123456789';

beforeEach(() => vi.stubEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-store-password'));
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

  it('cannot be made or checked without the store password, and a different password does not verify', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const good = parts(signedPaymentResultPath(TRAN, now));
    vi.stubEnv('SSLCOMMERZ_STORE_PASSWORD', 'a-different-password');
    expect(verifyPaymentResultParams(good, now)).toBe(false);
    vi.stubEnv('SSLCOMMERZ_STORE_PASSWORD', '');
    expect(signedPaymentResultPath(TRAN, now)).toBeNull();
    expect(verifyPaymentResultParams(good, now)).toBe(false);
  });

  it('does not contain the password', () => {
    const path = signedPaymentResultPath(TRAN) ?? '';
    expect(path).not.toContain('synthetic-store-password');
  });
});
