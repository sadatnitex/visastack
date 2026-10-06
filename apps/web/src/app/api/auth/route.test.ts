import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlerGet = vi.fn(async () => new Response('neon-get', { status: 200 }));
const handlerPost = vi.fn(async () => new Response('neon-post', { status: 200 }));
vi.mock('../../../lib/neon-auth', () => ({
  getNeonAuth: () => ({ handler: () => ({ GET: handlerGet, POST: handlerPost }) }),
}));

const ctx = { params: Promise.resolve({ path: ['sign-in', 'email'] }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/auth/[...path]', () => {
  it('is a plain 404 for every method when WorkOS is the selected provider', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'workos');
    const route = await import('./[...path]/route');
    expect((await route.GET(new Request('https://x.test/api/auth/session'), ctx)).status).toBe(404);
    expect(
      (
        await route.POST(
          new Request('https://x.test/api/auth/sign-up/email', { method: 'POST' }),
          ctx,
        )
      ).status,
    ).toBe(404);
    expect(handlerGet).not.toHaveBeenCalled();
    expect(handlerPost).not.toHaveBeenCalled();
  });

  it('hands the request to Neon Auth when it is the selected provider', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
    const route = await import('./[...path]/route');
    expect(
      await (await route.GET(new Request('https://x.test/api/auth/session'), ctx)).text(),
    ).toBe('neon-get');
    expect(
      await (
        await route.POST(
          new Request('https://x.test/api/auth/sign-in/email', { method: 'POST' }),
          ctx,
        )
      ).text(),
    ).toBe('neon-post');
  });
});
