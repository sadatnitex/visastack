import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
const listAccounts = vi.fn();
vi.mock('../../../lib/neon-auth', () => ({ getNeonAuth: () => ({ listAccounts }) }));
vi.mock('../../../lib/neon-request-session', () => ({
  requestSessionReader: () => ({ getSession: async () => ({ data: { user: { id: 'u1' } } }) }),
}));
const choices = vi.fn();
vi.mock('../../../lib/passkey-offer', () => ({
  reauthChoices: (returnTo: string) => choices(returnTo),
}));
vi.mock('../passkey-confirm', () => ({
  PasskeyConfirm: ({ returnTo }: { returnTo: string }) => (
    <div data-passkey-confirm={returnTo}>passkey</div>
  ),
}));

import ReauthPage from './page';

async function render(searchParams: Record<string, string>): Promise<Document> {
  const html = renderToStaticMarkup(
    await ReauthPage({ searchParams: Promise.resolve(searchParams) }),
  );
  return new JSDOM(html).window.document;
}

function linkButton(doc: Document): HTMLButtonElement | undefined {
  return Array.from(doc.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Email Me a Sign-In Link Instead'),
  );
}

beforeEach(() => {
  choices.mockReset().mockResolvedValue({ passkey: false, link: false });
  listAccounts.mockReset().mockResolvedValue({ data: [{ providerId: 'credential' }] });
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', '');
});
afterEach(() => vi.unstubAllEnvs());

it('offers a passkey only when the server says it can help, and always keeps the password', async () => {
  let doc = await render({ returnTo: '/app/privacy' });
  expect(doc.querySelector('[data-passkey-confirm]')).toBeNull();
  expect(doc.querySelector('input[name="password"]')).not.toBeNull();

  choices.mockResolvedValue({ passkey: true, link: false });
  doc = await render({ returnTo: '//evil.example' });
  expect(doc.querySelector('[data-passkey-confirm]')?.getAttribute('data-passkey-confirm')).toBe(
    '/app',
  );
  expect(doc.querySelector('input[name="password"]')).not.toBeNull();
  expect(choices).toHaveBeenLastCalledWith('/app');
});

it('offers a passkey to a traveller who signs in only with Google, beside the Google button', async () => {
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
  listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }] });
  choices.mockResolvedValue({ passkey: true, link: false });
  const doc = await render({ returnTo: '/app/privacy' });
  expect(doc.body.textContent).toContain('You signed in with Google');
  expect(doc.querySelector('[data-passkey-confirm]')).not.toBeNull();
  expect(doc.querySelector('input[name="password"]')).toBeNull();
});

it('offers the email link only when the server allows it (never to staff), with its outcomes', async () => {
  expect(linkButton(await render({ returnTo: '/app/privacy' }))).toBeUndefined();
  choices.mockResolvedValue({ passkey: false, link: true });
  const doc = await render({ returnTo: '/app/privacy', n: 'link_sent' });
  expect(
    linkButton(doc)?.closest('form')?.querySelector<HTMLInputElement>('input[name="returnTo"]')
      ?.value,
  ).toBe('/app/privacy');
  expect(doc.body.textContent).toContain('We sent a sign-in link to your email address');
  const staff = await render({ returnTo: '/app/privacy', e: 'link_staff' });
  expect(staff.body.textContent).toContain('Staff accounts confirm with the password');
  expect(staff.querySelector('#password')?.getAttribute('aria-describedby')).toBeNull();
});
