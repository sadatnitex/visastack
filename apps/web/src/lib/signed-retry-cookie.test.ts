import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signedRetryCookie } from './signed-retry-cookie';

const config = {
  label: 'visastack.test-retry.v1',
  path: '/app/admin/test',
  lifetimeS: 15 * 60,
  maxLength: 1024,
};

beforeEach(() => {
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 's'.repeat(64));
});

describe('the signed retry cookie (S29 round 2)', () => {
  const cookie = signedRetryCookie(config);
  const now = new Date('2026-10-30T10:00:00Z');

  it('gives back the fields for the same account before it expires', () => {
    const value = cookie.encode({ f: 'x', v: { name: 'Growth' } }, 'acct-1', now);
    expect(value).not.toBeNull();
    const fields = cookie.decode(value ?? undefined, 'acct-1', now);
    expect(fields).toMatchObject({ f: 'x', v: { name: 'Growth' }, a: 'acct-1' });
  });

  it('refuses a tampered cookie', () => {
    const value = cookie.encode({ f: 'x' }, 'acct-1', now) ?? '';
    const [payload, sig] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ f: 'y', a: 'acct-1', x: 9e9 })).toString(
      'base64url',
    );
    expect(cookie.decode(`${forged}.${sig}`, 'acct-1', now)).toBeNull();
    expect(cookie.decode(`${payload}.${sig?.slice(0, -2)}AA`, 'acct-1', now)).toBeNull();
    expect(cookie.decode(`${value}.extra`, 'acct-1', now)).toBeNull();
  });

  it('refuses an expired cookie', () => {
    const value = cookie.encode({ f: 'x' }, 'acct-1', now) ?? undefined;
    expect(cookie.decode(value, 'acct-1', new Date(now.getTime() + 16 * 60 * 1000))).toBeNull();
  });

  it("refuses another account's cookie and another page's cookie", () => {
    const value = cookie.encode({ f: 'x' }, 'acct-1', now) ?? undefined;
    expect(cookie.decode(value, 'acct-2', now)).toBeNull();
    const other = signedRetryCookie({ ...config, label: 'visastack.other-retry.v1' });
    expect(other.decode(value, 'acct-1', now)).toBeNull();
  });

  it('writes nothing without a strong secret, and refuses values that are too long', () => {
    const long = signedRetryCookie({ ...config, refuseLongerThan: 50 });
    expect(long.encode({ f: 'x'.repeat(200) }, 'acct-1', now)).toBeNull();
    expect(cookie.decode('a'.repeat(2000), 'acct-1', now)).toBeNull();
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'short');
    expect(cookie.encode({ f: 'x' }, 'acct-1', now)).toBeNull();
  });

  it('is httpOnly, Lax and scoped to its page', () => {
    expect(cookie.options(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/app/admin/test',
      maxAge: 900,
    });
  });
});
