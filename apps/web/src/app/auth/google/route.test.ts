import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const social = vi.fn();
vi.mock('../../../lib/neon-auth', () => ({ getNeonAuth: () => ({ signIn: { social } }) }));

import { GET } from './route';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';

function enable(): void {
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
}

function request(query = ''): Request {
  return new Request(`https://example.test/auth/google${query}`);
}

beforeEach(() => {
  social.mockReset();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test');
});
afterEach(() => vi.unstubAllEnvs());

it('sends the person back to sign-in when Google sign-in is not switched on, and never calls Neon', async () => {
  const response = await GET(request());
  expect(response.status).toBe(307);
  expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/auth/sign-in');
  expect(response.headers.get('location')).toContain('e=social_off');
  expect(social).not.toHaveBeenCalled();
});

it('asks Neon Auth for Google with the confirmed landing as the return address, then redirects to the provider', async () => {
  enable();
  social.mockResolvedValue({
    data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc', redirect: true },
    error: null,
  });
  const response = await GET(request('?next=%2Fapp%2Fdocuments'));
  expect(response.headers.get('location')).toBe(
    'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
  );
  const call = social.mock.calls[0]?.[0];
  expect(call.provider).toBe('google');
  expect(call.disableRedirect).toBe(true);
  expect(call.callbackURL).toMatch(/\/auth\/confirmed\?next=%2Fapp%2Fdocuments$/);
  expect(call.errorCallbackURL).toMatch(/\/auth\/sign-in\?e=social&next=%2Fapp%2Fdocuments$/);
});

it('never lets the return path leave the site', async () => {
  enable();
  social.mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null });
  await GET(request('?next=https%3A%2F%2Fevil.example%2F'));
  const call = social.mock.calls[0]?.[0];
  expect(call.callbackURL).not.toContain('evil.example');
  expect(call.errorCallbackURL).not.toContain('evil.example');
});

it('shows a fixed message when Neon fails, returns no address, or an insecure one', async () => {
  enable();
  for (const result of [
    { data: null, error: { message: 'secret provider text' } },
    { data: { url: undefined }, error: null },
    { data: { url: 'http://accounts.google.com/x' }, error: null },
  ]) {
    social.mockResolvedValueOnce(result);
    const response = await GET(request());
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/auth/sign-in?e=social');
    expect(location).not.toContain('secret');
  }
  social.mockRejectedValueOnce(new Error('network'));
  expect((await GET(request())).headers.get('location')).toContain('e=social');
});
