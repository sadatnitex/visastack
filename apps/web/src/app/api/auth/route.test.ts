import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlerGet = vi.fn(async () => new Response('neon-get', { status: 200 }));
const handlerPost = vi.fn(async () => new Response('neon-post', { status: 200 }));
vi.mock('../../../lib/neon-auth', () => ({
  getNeonAuth: () => ({ handler: () => ({ GET: handlerGet, POST: handlerPost }) }),
}));

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const post = (path: string) => new Request(`https://x.test/api/auth/${path}`, { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/auth/[...path]', () => {
  it('hands session reads and other requests to Neon Auth, the only sign-in system', async () => {
    const route = await import('./[...path]/route');
    expect(
      await (
        await route.GET(new Request('https://x.test/api/auth/get-session'), ctx('get-session'))
      ).text(),
    ).toBe('neon-get');
    expect(await (await route.POST(post('sign-out'), ctx('sign-out'))).text()).toBe('neon-post');
  });

  it('refuses every other direct POST, including sign-in, email sending and path tricks', async () => {
    const route = await import('./[...path]/route');
    for (const path of [
      ['sign-in', 'email'],
      ['Sign-In', 'Email'],
      ['sign-in', 'social'],
      ['sign-up', 'email'],
      ['request-password-reset'],
      ['forget-password'],
      ['forget-password', 'email-otp'],
      ['email-otp', 'send-verification-otp'],
      ['reset-password'],
      ['send-verification-email'],
      ['change-email'],
      ['x', '..', 'sign-in', 'email'],
      ['sign-out', '..', 'sign-in', 'email'],
      ['%2e%2e', 'sign-in', 'email'],
      ['sign-out', ''],
    ]) {
      const response = await route.POST(post(path.join('/')), ctx(...path));
      expect(response.status, path.join('/')).toBe(404);
    }
    expect(handlerPost).not.toHaveBeenCalled();
  });
});
