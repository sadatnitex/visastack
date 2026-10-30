import { describe, expect, it } from 'vitest';
import { isNeonProtectedPath } from './identity-selection';

describe('isNeonProtectedPath', () => {
  it('protects the signed-in app and the pilot access screen', () => {
    for (const path of [
      '/app',
      '/app/',
      '/app/applicants',
      '/app/mission/123/snapshots/9',
      '/pilot-access-denied',
      '/oauth/authorize',
      '/auth/reauth',
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
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/verify-email',
      '/auth/reauthorize',
      '/application',
      '/applications/1',
      '/apple',
      '/oauth/token',
      '/oauth/authorized',
    ]) {
      expect(isNeonProtectedPath(path), path).toBe(false);
    }
  });
});
