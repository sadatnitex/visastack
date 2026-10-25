import { describe, expect, it } from 'vitest';

/**
 * Where a stale session goes to sign in again. The one behaviour worth a regression test beyond
 * "it redirects" is the `returnTo` same-origin guard: the exact kind of check that could silently
 * rot into an open redirect, a real security regression, not just a UX one.
 */

describe('Neon reauthentication', () => {
  it('falls back to /app when returnTo is missing', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request('https://example.test/api/session-reauth?maxAge=600'));
    const target = new URL(response.headers.get('location') ?? '');
    expect(target.pathname).toBe('/auth/reauth');
    expect(target.searchParams.get('returnTo')).toBe('/app');
  });

  it.each([
    ['/app/privacy', '/app/privacy'],
    ['https://other.example.test', '/app'],
    ['//other.example.test', '/app'],
    ['/\\other.example.test', '/app'],
    ['/app\n', '/app'],
  ])('keeps the return destination safe: %s', async (requested, expected) => {
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
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
