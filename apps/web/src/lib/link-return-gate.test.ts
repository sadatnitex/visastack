import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { encodeLinkPending, linkPendingCookieName } from './link-pending';
import { refuseUnaskedLink } from './link-return-gate';

/**
 * Q8 login CSRF guard, before any sign-in is handed over: the sign-in link landing goes on to
 * Neon Auth only in a browser holding a valid, unexpired mark from asking for a link.
 */

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';
const env = (name: string) => (name === 'NEON_AUTH_COOKIE_SECRET' ? SECRET : undefined);
const MARK = linkPendingCookieName(true);

function request(path: string, mark?: string): NextRequest {
  const headers = new Headers();
  if (mark !== undefined) headers.set('cookie', `${MARK}=${mark}`);
  return new NextRequest(`https://app.example.test${path}`, { headers });
}

async function refusedTo(path: string, mark?: string): Promise<string | null> {
  const response = await refuseUnaskedLink(request(path, mark), env);
  if (!response) return null;
  const location = new URL(response.headers.get('location') ?? '');
  return `${location.pathname}${location.search}`;
}

const LANDING = '/auth/link-return?next=%2Fapp%2Fcases&neon_auth_session_verifier=v';

describe('refuseUnaskedLink', () => {
  it('lets the browser that asked go on to Neon Auth', async () => {
    expect(await refusedTo(LANDING, await encodeLinkPending(SECRET))).toBeNull();
  });

  it('refuses before any sign-in: no mark, a forged one, another key, or an expired one', async () => {
    const expected = '/auth/sign-in?e=link&next=%2Fapp%2Fcases';
    expect(await refusedTo(LANDING)).toBe(expected);
    const valid = await encodeLinkPending(SECRET);
    const [payload] = valid.split('.');
    expect(await refusedTo(LANDING, `${payload}.AAAA`)).toBe(expected);
    expect(await refusedTo(LANDING, await encodeLinkPending(`${SECRET}-other`))).toBe(expected);
    expect(
      await refusedTo(LANDING, await encodeLinkPending(SECRET, Date.now() - 11 * 60_000)),
    ).toBe(expected);
  });

  it('keeps the destination on this site, and leaves every other page alone', async () => {
    expect(await refusedTo('/auth/link-return?next=%2F%2Fevil.example')).toBe(
      '/auth/sign-in?e=link',
    );
    expect(await refusedTo('/auth/social-return?next=%2Fapp')).toBeNull();
    expect(await refusedTo('/app')).toBeNull();
  });
});
