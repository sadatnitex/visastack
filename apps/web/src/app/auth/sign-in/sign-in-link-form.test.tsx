import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));

import SignInPage from './page';

async function page(searchParams: Record<string, string> = {}): Promise<Document> {
  const html = renderToStaticMarkup(
    await SignInPage({ searchParams: Promise.resolve(searchParams) }),
  );
  return new JSDOM(html).window.document;
}

beforeEach(() => {
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', '');
});
afterEach(() => vi.unstubAllEnvs());

it('offers a sign-in link by email only while SIGN_IN_LINKS is on, beside the unchanged password form', async () => {
  vi.stubEnv('SIGN_IN_LINKS', '');
  let doc = await page();
  expect(doc.querySelector('#link-email')).toBeNull();
  expect(doc.querySelector('input[name="password"]')).not.toBeNull();

  vi.stubEnv('SIGN_IN_LINKS', 'on');
  doc = await page({ next: '/app/cases' });
  const field = doc.querySelector<HTMLInputElement>('#link-email');
  expect(field?.getAttribute('type')).toBe('email');
  const linkForm = field?.closest('form');
  expect(linkForm?.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe('/app/cases');
  expect(linkForm?.querySelector('input[name="password"]')).toBeNull();
  expect(doc.querySelectorAll('input[name="password"]')).toHaveLength(1);
});

it('explains each sign-in link outcome in plain words', async () => {
  vi.stubEnv('SIGN_IN_LINKS', 'on');
  expect((await page({ n: 'link_sent' })).body.textContent).toContain('We sent a sign-in link');
  expect((await page({ e: 'link' })).body.textContent).toContain('same device and browser');
  expect((await page({ e: 'link_expired' })).body.textContent).toContain(
    'expired or was already used',
  );
  const invalid = await page({ e: 'link_invalid' });
  expect(invalid.querySelector('#link-email')?.getAttribute('aria-describedby')).toBe(
    'signin-error',
  );
  expect(invalid.querySelector('#email')?.getAttribute('aria-describedby')).toBeNull();
});
