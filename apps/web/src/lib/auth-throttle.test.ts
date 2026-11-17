import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const checkRateLimit = vi.fn();
vi.mock('@visastack/services', () => ({
  RATE_LIMITS: { AUTH_SIGN_IN_IP: { limit: 60, windowMs: 3_600_000 } },
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}));
const withPublicDb = vi.fn(async (work: (db: unknown) => Promise<unknown>) => work({ db: true }));
vi.mock('./public-db', () => ({
  withPublicDb: (work: (db: unknown) => Promise<unknown>) => withPublicDb(work),
}));
const reportServerError = vi.fn();
vi.mock('./server-error', () => ({
  reportServerError: (...args: unknown[]) => reportServerError(...args),
}));

import { withinAddressLimit } from './auth-throttle';

beforeEach(() => {
  checkRateLimit.mockReset();
  reportServerError.mockReset();
  withPublicDb.mockClear();
});

describe('withinAddressLimit', () => {
  it('counts the address only, under the named limit, and never stores it as typed', async () => {
    checkRateLimit.mockResolvedValue({ allowed: true });
    expect(await withinAddressLimit({ byAddress: 'AUTH_SIGN_IN_IP', onFailure: 'allow' })).toBe(
      true,
    );
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    const [, subject, limit] = checkRateLimit.mock.calls[0] ?? [];
    expect(subject.action).toBe('auth.AUTH_SIGN_IN_IP');
    expect(JSON.stringify(subject)).not.toContain('203.0.113.7');
    expect(limit).toEqual({ limit: 60, windowMs: 3_600_000 });
  });

  it('refuses once the limit is used up', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });
    expect(await withinAddressLimit({ byAddress: 'AUTH_SIGN_IN_IP', onFailure: 'allow' })).toBe(
      false,
    );
  });

  it('follows the caller when the counter cannot be read, and reports it', async () => {
    withPublicDb.mockRejectedValueOnce(new Error('database down'));
    expect(await withinAddressLimit({ byAddress: 'AUTH_SIGN_IN_IP', onFailure: 'allow' })).toBe(
      true,
    );
    withPublicDb.mockRejectedValueOnce(new Error('database down'));
    expect(await withinAddressLimit({ byAddress: 'AUTH_SIGN_IN_IP', onFailure: 'deny' })).toBe(
      false,
    );
    expect(reportServerError).toHaveBeenCalledTimes(2);
  });
});
