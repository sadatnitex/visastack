import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GoogleButton } from './google-button';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';

beforeEach(() => vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', ''));
afterEach(() => vi.unstubAllEnvs());

function enable(): void {
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
}

it('renders nothing until Google sign-in is switched on', () => {
  expect(renderToStaticMarkup(<GoogleButton next={undefined} notice />)).toBe('');
});

it('renders nothing when it is switched on but Neon Auth is not fully set up', () => {
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'short');
  expect(renderToStaticMarkup(<GoogleButton next={undefined} notice />)).toBe('');
});

it('renders a plain nofollow link that carries a safe return path, marked as English', () => {
  enable();
  const html = renderToStaticMarkup(<GoogleButton next="/app/documents" notice />);
  expect(html).toContain('href="/auth/google?next=%2Fapp%2Fdocuments"');
  expect(html).toContain('rel="nofollow"');
  expect(html).toContain('<span lang="en">Continue with Google</span>');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/privacy"');
});

it('leaves out the terms line when asked, and never carries an outside return path', () => {
  enable();
  const outside = renderToStaticMarkup(<GoogleButton next="https://evil.example" notice={false} />);
  expect(outside).not.toContain('evil.example');
  expect(outside).toContain('href="/auth/google?next=%2Fapp"');
  expect(outside).not.toContain('/terms');
});
