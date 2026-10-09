import { describe, expect, it } from 'vitest';
import { isPublicBetaOpen } from './public-beta';

const env = (values: Record<string, string>) => (name: string) => values[name];

describe('isPublicBetaOpen', () => {
  it('is on only with Neon sign-in and the exact value true', () => {
    expect(
      isPublicBetaOpen(env({ IDENTITY_PROVIDER: 'neon_auth', PUBLIC_BETA_OPEN: 'true' })),
    ).toBe(true);
  });

  it.each([
    ['unset', {}],
    ['not exactly true', { IDENTITY_PROVIDER: 'neon_auth', PUBLIC_BETA_OPEN: 'TRUE' }],
    ['1', { IDENTITY_PROVIDER: 'neon_auth', PUBLIC_BETA_OPEN: '1' }],
    ['WorkOS selected', { PUBLIC_BETA_OPEN: 'true' }],
    ['WorkOS named explicitly', { IDENTITY_PROVIDER: 'workos', PUBLIC_BETA_OPEN: 'true' }],
  ])('stays closed when %s', (_label, values) => {
    expect(isPublicBetaOpen(env(values))).toBe(false);
  });
});
