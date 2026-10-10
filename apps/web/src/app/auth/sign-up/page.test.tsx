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
  expect(document.body.textContent).toContain('Do not enter real applicant details');
  expect(document.querySelector('input[name="website"]')?.closest('[hidden]')).not.toBeNull();
});
