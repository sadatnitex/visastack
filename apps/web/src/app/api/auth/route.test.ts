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
  it('hands every request to Neon Auth, the only sign-in system', async () => {
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
