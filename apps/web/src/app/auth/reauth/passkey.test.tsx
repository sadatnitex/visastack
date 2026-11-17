import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
vi.mock('../../../lib/neon-auth', () => ({ getNeonAuth: () => ({ listAccounts: vi.fn() }) }));
const offered = vi.fn();
vi.mock('../../../lib/passkey-offer', () => ({
  passkeyOfferedAtReauth: (returnTo: string) => offered(returnTo),
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

beforeEach(() => {
  offered.mockReset();
});

it('offers a passkey above the password form only when it can help, and always keeps the password', async () => {
  offered.mockResolvedValue(false);
  let doc = await render({ returnTo: '/app/privacy' });
  expect(doc.querySelector('[data-passkey-confirm]')).toBeNull();
  expect(doc.querySelector('input[name="password"]')).not.toBeNull();

  offered.mockResolvedValue(true);
  doc = await render({ returnTo: '//evil.example' });
  expect(doc.querySelector('[data-passkey-confirm]')?.getAttribute('data-passkey-confirm')).toBe(
    '/app',
  );
  expect(doc.querySelector('input[name="password"]')).not.toBeNull();
  expect(offered).toHaveBeenLastCalledWith('/app');
});

it('offers an email sign-in link only while SIGN_IN_LINKS is on, so nobody without a password is stuck', async () => {
  offered.mockResolvedValue(false);
  vi.stubEnv('SIGN_IN_LINKS', '');
  expect((await render({ returnTo: '/app/privacy' })).body.textContent).not.toContain(
    'Sign-In Link',
  );
  vi.stubEnv('SIGN_IN_LINKS', 'on');
  const doc = await render({ returnTo: '/app/privacy', n: 'link_sent' });
  const button = Array.from(doc.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Email Me a Sign-In Link Instead'),
  );
  expect(
    button?.closest('form')?.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value,
  ).toBe('/app/privacy');
  expect(doc.body.textContent).toContain('We sent a sign-in link to your email address');
  vi.unstubAllEnvs();
});
