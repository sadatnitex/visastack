import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  }),
}));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));

import {
  PENDING_CONFIRMATION_COOKIE,
  encodePendingConfirmation,
} from '../../../lib/pending-confirmation';
import SignInPage from './page';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';

async function emailField(searchParams: Record<string, string>): Promise<string | null> {
  const html = renderToStaticMarkup(
    await SignInPage({ searchParams: Promise.resolve(searchParams) }),
  );
  const document = new JSDOM(html).window.document;
  return (
    document.querySelector<HTMLInputElement>('input[name="email"]')?.getAttribute('value') ?? null
  );
}

beforeEach(() => {
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
  jar.clear();
});
afterEach(() => vi.unstubAllEnvs());

it('starts with the address this browser asked us to confirm, only after the confirmation link', async () => {
  const value = encodePendingConfirmation('maria@example.test');
  if (!value) throw new Error('cookie could not be signed');
  jar.set(PENDING_CONFIRMATION_COOKIE, value);
  expect(await emailField({ n: 'confirmed' })).toBe('maria@example.test');
  // Other pages and messages never prefill.
  expect(await emailField({})).toBeNull();
  expect(await emailField({ n: 'reset' })).toBeNull();
  expect(await emailField({ e: 'failed' })).toBeNull();
});

it('leaves the field empty when nothing was remembered or the cookie is not ours', async () => {
  expect(await emailField({ n: 'confirmed' })).toBeNull();
  jar.set(PENDING_CONFIRMATION_COOKIE, 'forged.value');
  expect(await emailField({ n: 'confirmed' })).toBeNull();
});

it('keeps the confirmed message and never puts the address in a link', async () => {
  const value = encodePendingConfirmation('maria@example.test');
  if (!value) throw new Error('cookie could not be signed');
  jar.set(PENDING_CONFIRMATION_COOKIE, value);
  const html = renderToStaticMarkup(
    await SignInPage({ searchParams: Promise.resolve({ n: 'confirmed' }) }),
  );
  expect(html).toContain('Your email address is confirmed.');
  const links = [...html.matchAll(/(?:href|action)="([^"]*)"/g)].map((m) => m[1] ?? '');
  for (const link of links) expect(link).not.toContain('maria');
});
