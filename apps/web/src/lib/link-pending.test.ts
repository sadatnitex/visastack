import { describe, expect, it } from 'vitest';
import {
  encodeLinkPending,
  linkPendingCookieName,
  linkPendingCookieOptions,
  linkPendingValid,
} from './link-pending';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';

describe('the link pending mark', () => {
  it('is a Lax, httpOnly, Secure, host-only cookie that lives ten minutes', () => {
    expect(linkPendingCookieName(true)).toBe('__Host-vs-link-pending');
    expect(linkPendingCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
  });

  it('holds for ten minutes and no longer, only under the same key, and differs every time', async () => {
    const now = 1_800_000_000_000;
    const mark = await encodeLinkPending(SECRET, now);
    expect(await linkPendingValid(mark, SECRET, now + 599_000)).toBe(true);
    expect(await linkPendingValid(mark, SECRET, now + 601_000)).toBe(false);
    expect(await linkPendingValid(mark, `${SECRET}x`, now)).toBe(false);
    expect(await linkPendingValid(mark, 'short', now)).toBe(false);
    expect(await encodeLinkPending(SECRET, now)).not.toBe(mark);
  });

  it('refuses anything forged or malformed', async () => {
    const mark = await encodeLinkPending(SECRET);
    const [payload, signature] = mark.split('.');
    const forged = btoa(JSON.stringify({ n: 'x', e: Date.now() + 600_000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await linkPendingValid(`${forged}.${signature}`, SECRET)).toBe(false);
    expect(await linkPendingValid(`${payload}.`, SECRET)).toBe(false);
    expect(await linkPendingValid(`${payload}.%%%`, SECRET)).toBe(false);
    expect(await linkPendingValid(undefined, SECRET)).toBe(false);
    expect(await linkPendingValid('x'.repeat(600), SECRET)).toBe(false);
  });
});
