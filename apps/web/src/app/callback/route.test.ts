import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

describe('the retired sign-in callback', () => {
  it.each(['', '?code=stale&state=stale&returnTo=https%3A%2F%2Fother.example.test'])(
    'goes to same-site sign-in, exchanges nothing and sets no cookie: %s',
    async (query) => {
      const { GET } = await import('./route');
      const response = await GET(new NextRequest(`https://example.test/callback${query}`));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://example.test/auth/sign-in');
      expect(response.headers.has('set-cookie')).toBe(false);
    },
  );

  it('does so even if a leftover setting still names the old provider', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'workos');
    try {
      const { GET } = await import('./route');
      const response = await GET(new NextRequest('https://example.test/callback?code=test'));
      expect(response.headers.get('location')).toBe('https://example.test/auth/sign-in');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
