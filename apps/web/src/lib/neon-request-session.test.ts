import { beforeEach, expect, it, vi } from 'vitest';

/** A stand-in for React's per-request `cache()`: `newRequest()` starts a new request. */
const h = vi.hoisted(() => {
  const state = { scope: new Map<unknown, unknown>() };
  return {
    state,
    newRequest() {
      state.scope = new Map();
    },
    getSession: vi.fn(),
    cookies: [] as { name: string; value: string }[],
  };
});

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cache:
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      if (!h.state.scope.has(fn)) h.state.scope.set(fn, fn(...args));
      return h.state.scope.get(fn) as R;
    },
}));
vi.mock('./neon-auth', () => ({ getNeonAuth: () => ({ getSession: h.getSession }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => h.cookies }) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.newRequest();
  h.cookies = [
    { name: 'vs_locale', value: 'en' },
    { name: '__Secure-neon-auth.session_token', value: 'synthetic' },
  ];
  h.getSession.mockResolvedValue({
    data: {
      user: { id: 'neon-1', email: 'person@example.test', emailVerified: true },
      session: { createdAt: new Date(Date.now() - 60_000) },
    },
  });
});

it('asks Neon Auth once per request for the identity and the session age together', async () => {
  const { NeonIdentityPort } = await import('./identity-provider');
  const { neonSessionAgeSeconds } = await import('./neon-recency');

  await new NeonIdentityPort().currentIdentity();
  await new NeonIdentityPort().currentIdentity();
  await neonSessionAgeSeconds();
  expect(h.getSession).toHaveBeenCalledOnce();
});

it('asks again on the next request, so a sign-out is seen straight away', async () => {
  const { NeonIdentityPort } = await import('./identity-provider');
  expect(await new NeonIdentityPort().currentIdentity()).toMatchObject({ providerId: 'neon-1' });

  h.newRequest();
  h.getSession.mockResolvedValue({ data: null });
  expect(await new NeonIdentityPort().currentIdentity()).toBeUndefined();
  expect(h.getSession).toHaveBeenCalledTimes(2);
});

it('answers "signed out" without asking Neon Auth when the visitor carries no Neon Auth cookie', async () => {
  h.cookies = [{ name: 'vs_locale', value: 'en' }];
  const { NeonIdentityPort } = await import('./identity-provider');
  const { neonSessionAgeSeconds } = await import('./neon-recency');

  expect(await new NeonIdentityPort().currentIdentity()).toBeUndefined();
  expect(await neonSessionAgeSeconds()).toBe(Number.POSITIVE_INFINITY);
  expect(h.getSession).not.toHaveBeenCalled();
});

it('still asks Neon Auth for any Neon Auth cookie, even one that is not the session itself', async () => {
  h.cookies = [{ name: '__Secure-neon-auth.local.session_data', value: 'synthetic' }];
  h.getSession.mockResolvedValue({ data: null });
  const { NeonIdentityPort } = await import('./identity-provider');
  expect(await new NeonIdentityPort().currentIdentity()).toBeUndefined();
  expect(h.getSession).toHaveBeenCalledOnce();
});

it('uses the same cookie prefix Neon Auth forwards to its service (checked in the installed package)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { NEON_AUTH_COOKIE_PREFIX } = await import('./neon-request-session');
  const dist = fileURLToPath(
    new URL('../../node_modules/@neondatabase/auth/dist', import.meta.url),
  );
  const sources = readdirSync(dist)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => readFileSync(join(dist, f), 'utf8'));
  const server = sources.find((s) => s.includes('const extractNeonAuthCookies'));
  expect(
    server,
    'Neon Auth no longer has extractNeonAuthCookies: re-check the shortcut',
  ).toBeDefined();
  expect(server).toContain(`const NEON_AUTH_COOKIE_PREFIX = "${NEON_AUTH_COOKIE_PREFIX}";`);
  const extract = server?.slice(server.indexOf('const extractNeonAuthCookies'));
  expect(extract?.slice(0, 600)).toContain('name.startsWith(NEON_AUTH_COOKIE_PREFIX)');
});
