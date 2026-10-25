import { describe, expect, it } from 'vitest';
import { isPublicBetaOpen } from './public-beta';

const env = (values: Record<string, string>) => (name: string) => values[name];
const NEON = {
  NEON_AUTH_BASE_URL: 'https://auth.example.test/db',
  NEON_AUTH_COOKIE_SECRET: 'c'.repeat(40),
};

describe('isPublicBetaOpen', () => {
  it('is on only with the exact value true and Neon sign-in configured', () => {
    expect(isPublicBetaOpen(env({ ...NEON, PUBLIC_BETA_OPEN: 'true' }))).toBe(true);
  });

  it.each([
    ['unset', { ...NEON }],
    ['not exactly true', { ...NEON, PUBLIC_BETA_OPEN: 'TRUE' }],
    ['1', { ...NEON, PUBLIC_BETA_OPEN: '1' }],
    ['sign-in not configured', { PUBLIC_BETA_OPEN: 'true' }],
    [
      'the sign-in address is not https',
      { ...NEON, NEON_AUTH_BASE_URL: 'http://auth.example.test/db', PUBLIC_BETA_OPEN: 'true' },
    ],
    [
      'the cookie secret is too short',
      { ...NEON, NEON_AUTH_COOKIE_SECRET: 'short', PUBLIC_BETA_OPEN: 'true' },
    ],
  ])('stays closed when %s', (_label, values) => {
    expect(isPublicBetaOpen(env(values))).toBe(false);
  });
});
