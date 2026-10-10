import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleAuth, legacyHandler } = vi.hoisted(() => {
  const legacyHandler = vi.fn(async () => Response.redirect('https://example.test/app', 302));
  return { legacyHandler, handleAuth: vi.fn(() => legacyHandler) };
});
vi.mock('@workos-inc/authkit-nextjs', () => ({ handleAuth }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
});

describe('retired callback on Neon deployments', () => {
  it.each(['', '?code=stale&state=stale&returnTo=https%3A%2F%2Fother.example.test'])(
    'goes to same-site sign-in without invoking WorkOS: %s',
    async (query) => {
      const { GET } = await import('./route');
      const response = await GET(new NextRequest(`https://example.test/callback${query}`));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://example.test/auth/sign-in');
      expect(handleAuth).not.toHaveBeenCalled();
      expect(legacyHandler).not.toHaveBeenCalled();
      expect(response.headers.has('set-cookie')).toBe(false);
    },
  );

  it('preserves an explicitly selected legacy provider during migration', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'workos');
    const { GET } = await import('./route');
    const request = new NextRequest('https://example.test/callback?code=test&state=test');
    const response = await GET(request);
    expect(response.status).toBe(302);
    expect(legacyHandler).toHaveBeenCalledWith(request);
  });
});
