import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { GoogleButton } from './google-button';

afterEach(() => vi.unstubAllEnvs());

it('renders nothing until Google sign-in is switched on', () => {
  expect(renderToStaticMarkup(<GoogleButton next={undefined} notice />)).toBe('');
});

it('renders a plain link that carries a safe return path, and the terms line when asked', () => {
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  const html = renderToStaticMarkup(<GoogleButton next="/app/documents" notice />);
  expect(html).toContain('href="/auth/google?next=%2Fapp%2Fdocuments"');
  expect(html).toContain('Continue with Google');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/privacy"');
  const outside = renderToStaticMarkup(<GoogleButton next="https://evil.example" notice={false} />);
  expect(outside).not.toContain('evil.example');
  expect(outside).not.toContain('/terms');
});
