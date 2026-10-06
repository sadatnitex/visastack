import { describe, expect, it } from 'vitest';
import { isNeonProtectedPath, selectedIdentityProvider } from './identity-selection';

const env = (value: string | undefined) => (name: string) =>
  name === 'IDENTITY_PROVIDER' ? value : undefined;

describe('selectedIdentityProvider', () => {
  it('keeps WorkOS when unset, empty, or anything other than neon_auth', () => {
    expect(selectedIdentityProvider(env(undefined))).toBe('workos');
    expect(selectedIdentityProvider(env(''))).toBe('workos');
    expect(selectedIdentityProvider(env('workos'))).toBe('workos');
    expect(selectedIdentityProvider(env('okta'))).toBe('workos');
    expect(selectedIdentityProvider(env('NEON_AUTH'))).toBe('workos');
  });

  it('selects Neon Auth only for the exact value, ignoring surrounding spaces', () => {
    expect(selectedIdentityProvider(env('neon_auth'))).toBe('neon_auth');
    expect(selectedIdentityProvider(env(' neon_auth '))).toBe('neon_auth');
  });
});

describe('isNeonProtectedPath', () => {
  it('protects the signed-in app and the pilot access screen', () => {
    for (const path of [
      '/app',
      '/app/',
      '/app/applicants',
      '/app/mission/123/snapshots/9',
      '/pilot-access-denied',
    ]) {
      expect(isNeonProtectedPath(path), path).toBe(true);
    }
  });

  it('leaves public pages and the sign-in pages alone', () => {
    for (const path of [
      '/',
      '/status',
      '/trust',
      '/trust/some-route',
      '/auth/sign-in',
      '/auth/sign-up',
      '/application',
      '/applications/1',
      '/apple',
    ]) {
      expect(isNeonProtectedPath(path), path).toBe(false);
    }
  });
});
