import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * This route exists specifically so `getSignInUrl` (which sets a PKCE
 * cookie as a side effect) is only ever called from a genuinely legal
 * context (a Route Handler), never from the Server Component render that
 * `session-age.ts`'s `enforceSessionAgeLimit` runs inside. The one behavior
 * worth a regression test beyond "it calls through" is the `returnTo`
 * same-origin guard -- the exact kind of check that could silently rot into
 * an open redirect, a real security regression, not just a UX one.
 */

const getSignInUrl = vi.fn();

vi.mock('@workos-inc/authkit-nextjs', () => ({
  getSignInUrl: (...args: unknown[]) => getSignInUrl(...args),
}));

beforeEach(() => {
  vi.stubEnv('IDENTITY_PROVIDER', 'workos');
  getSignInUrl.mockReset();
  getSignInUrl.mockResolvedValue('https://auth.workos.com/sign-in?reauth=1');
});

describe('GET /api/session-reauth', () => {
  it('forwards maxAge and returnTo to getSignInUrl and redirects to the resulting WorkOS URL', async () => {
    const { GET } = await import('./route');
    const res = await GET(
      new Request(
        'https://example.test/api/session-reauth?maxAge=43200&returnTo=%2Fapp%2Fapplicant%2F123',
      ),
    );
    expect(getSignInUrl).toHaveBeenCalledWith({ maxAge: 43200, returnTo: '/app/applicant/123' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://auth.workos.com/sign-in?reauth=1');
  });

  it('falls back to /app when returnTo is missing', async () => {
    const { GET } = await import('./route');
    await GET(new Request('https://example.test/api/session-reauth?maxAge=600'));
    expect(getSignInUrl).toHaveBeenCalledWith({ maxAge: 600, returnTo: '/app' });
  });

  it('refuses an absolute/off-app returnTo, falling back to /app rather than forwarding it (open-redirect guard)', async () => {
    const { GET } = await import('./route');
    await GET(
      new Request(
        `https://example.test/api/session-reauth?maxAge=600&returnTo=${encodeURIComponent('https://evil.example/phish')}`,
      ),
    );
    expect(getSignInUrl).toHaveBeenCalledWith({ maxAge: 600, returnTo: '/app' });
  });

  it('refuses a protocol-relative returnTo ("//evil.example"), falling back to /app', async () => {
    const { GET } = await import('./route');
    await GET(
      new Request(
        `https://example.test/api/session-reauth?maxAge=600&returnTo=${encodeURIComponent('//evil.example')}`,
      ),
    );
    expect(getSignInUrl).toHaveBeenCalledWith({ maxAge: 600, returnTo: '/app' });
  });

  it('omits maxAge from the getSignInUrl call when absent or non-positive', async () => {
    const { GET } = await import('./route');
    await GET(new Request('https://example.test/api/session-reauth?returnTo=%2Fapp'));
    expect(getSignInUrl).toHaveBeenCalledWith({ returnTo: '/app' });
  });
});

describe('Neon reauthentication', () => {
  it.each([
    ['/app/privacy', '/app/privacy'],
    ['https://other.example.test', '/app'],
    ['//other.example.test', '/app'],
    ['/\\other.example.test', '/app'],
    ['/app\n', '/app'],
  ])('keeps the return destination safe: %s', async (requested, expected) => {
    vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
    const { GET } = await import('./route');
    const request = new Request(
      `https://example.test/api/session-reauth?maxAge=1&returnTo=${encodeURIComponent(requested)}`,
    );
    const response = await GET(request);
    const target = new URL(response.headers.get('location') ?? '');
    expect(response.status).toBe(302);
    expect(target.origin).toBe('https://example.test');
    expect(target.pathname).toBe('/auth/reauth');
    expect(target.searchParams.get('returnTo')).toBe(expected);
    expect(target.searchParams.has('maxAge')).toBe(false);
    expect(getSignInUrl).not.toHaveBeenCalled();
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
