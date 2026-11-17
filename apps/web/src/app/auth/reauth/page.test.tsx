import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
const listAccounts = vi.fn();
vi.mock('../../../lib/neon-auth', () => ({ getNeonAuth: () => ({ listAccounts }) }));
const getSession = vi.fn();
vi.mock('../../../lib/neon-request-session', () => ({
  requestSessionReader: () => ({ getSession }),
}));

import ReauthPage from './page';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';

async function render(searchParams: Record<string, string> = {}): Promise<Document> {
  const html = renderToStaticMarkup(
    await ReauthPage({ searchParams: Promise.resolve(searchParams) }),
  );
  return new JSDOM(html).window.document;
}

function enable(): void {
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
}

beforeEach(() => {
  listAccounts.mockReset();
  getSession.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('keeps the password form when Google sign-in is off, without asking Neon Auth anything', async () => {
  const document = await render();
  expect(document.querySelector('input[name="password"]')).not.toBeNull();
  expect(document.querySelector('a[href^="/auth/google"]')).toBeNull();
  expect(listAccounts).not.toHaveBeenCalled();
});

it('offers Google instead of a password to a person who has only ever signed in with Google', async () => {
  enable();
  listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }], error: null });
  const document = await render({ returnTo: '/app/documents' });
  expect(document.querySelector('input[name="password"]')).toBeNull();
  expect(document.querySelector('a[href^="/auth/google"]')?.getAttribute('href')).toBe(
    '/auth/google?next=%2Fapp%2Fdocuments',
  );
  expect(document.body.textContent).not.toContain('By continuing you agree');
});

it('never sends the Google return anywhere outside the site', async () => {
  enable();
  listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }], error: null });
  const document = await render({ returnTo: 'https://evil.example' });
  expect(document.querySelector('a[href^="/auth/google"]')?.getAttribute('href')).toBe(
    '/auth/google?next=%2Fapp',
  );
});

it('keeps the password form for anyone with a password, and when the answer cannot be read', async () => {
  enable();
  for (const answer of [
    { data: [{ providerId: 'credential' }], error: null },
    { data: [{ providerId: 'credential' }, { providerId: 'google' }], error: null },
    { data: null, error: { message: 'x' } },
    { data: [], error: null },
  ]) {
    listAccounts.mockResolvedValueOnce(answer);
    const document = await render();
    expect(document.querySelector('input[name="password"]')).not.toBeNull();
    expect(document.querySelector('a[href^="/auth/google"]')).toBeNull();
  }
  listAccounts.mockRejectedValueOnce(new Error('network'));
  expect((await render()).querySelector('input[name="password"]')).not.toBeNull();
});

it('shows the password form instead of hanging when Neon Auth stalls', async () => {
  enable();
  vi.useFakeTimers();
  listAccounts.mockReturnValue(new Promise(() => {}));
  const pending = render();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await pending).querySelector('input[name="password"]')).not.toBeNull();
});
