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

beforeEach(() => {
  vi.clearAllMocks();
  h.newRequest();
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
