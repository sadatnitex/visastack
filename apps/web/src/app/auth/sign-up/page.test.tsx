import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { readSignupForm } from '../../../lib/signup-form';
import SignUpPage from './page';

vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());

it('offers readable notices and an unchecked acknowledgement with a valid signed form', async () => {
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
  vi.stubEnv('PUBLIC_BETA_OPEN', 'false');
  const document = new JSDOM(
    renderToStaticMarkup(await SignUpPage({ searchParams: Promise.resolve({}) })),
  ).window.document;
  const checkbox = document.querySelector<HTMLInputElement>('input[name="acceptNotices"]');
  expect(checkbox?.required).toBe(true);
  expect(checkbox?.checked).toBe(false);
  expect(document.querySelector('a[href="/terms"]')?.textContent).toBe('terms of use');
  expect(document.querySelector('a[href="/privacy"]')?.textContent).toBe('privacy notice');
  const token = document.querySelector<HTMLInputElement>('input[name="signupForm"]')?.value;
  expect(token && readSignupForm(token)).toBeTruthy();
  expect(document.body.textContent).toContain('you do so at your own risk');
  expect(document.querySelector('input[name="website"]')?.closest('[hidden]')).not.toBeNull();
});

it('asks only for what creating the account needs, and keeps every notice and safeguard (owner list item 17)', async () => {
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
  const document = new JSDOM(
    renderToStaticMarkup(await SignUpPage({ searchParams: Promise.resolve({}) })),
  ).window.document;
  const form = document.querySelector('form');
  // The traveller or agency choice was guidance the server never read: it is gone.
  expect(form?.querySelector('input[name="usageIntent"]')).toBeNull();
  expect(form?.querySelector('fieldset')).toBeNull();
  // What a person fills in: an optional name, the email, the password and the acknowledgement.
  const filled = [...(form?.querySelectorAll<HTMLInputElement>('input') ?? [])]
    .filter((input) => input.type !== 'hidden' && !input.closest('[hidden]'))
    .map((input) => input.name);
  expect(filled).toEqual(['name', 'email', 'password', 'acceptNotices']);
  const name = document.querySelector<HTMLInputElement>('input[name="name"]');
  expect(name?.required).toBe(false);
  expect(document.querySelector('label[for="name"]')?.textContent).toContain(
    'Your Name (Optional)',
  );
  // Safeguards kept: the signed form, the hidden trap field, the own-risk notice and the consent.
  expect(form?.querySelector('input[name="signupForm"]')).not.toBeNull();
  expect(form?.querySelector('input[name="website"]')).not.toBeNull();
  expect(document.body.textContent).toContain('you do so at your own risk');
  expect(document.querySelector<HTMLInputElement>('input[name="acceptNotices"]')?.required).toBe(
    true,
  );
  expect(document.body.textContent).toContain('Agencies use the same account.');
});
