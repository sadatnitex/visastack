import { describe, expect, it } from 'vitest';
import { googleSignInEnabled, safeProviderRedirect } from './social-sign-in';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';

function env(values: Record<string, string>) {
  return (name: string) => values[name];
}

describe('googleSignInEnabled', () => {
  const ready = {
    GOOGLE_SIGN_IN_ENABLED: 'true',
    NEON_AUTH_BASE_URL: 'https://auth.example.test/neondb/auth',
    NEON_AUTH_COOKIE_SECRET: SECRET,
  };

  it('is on only when switched on and Neon Auth is configured', () => {
    expect(googleSignInEnabled(env(ready))).toBe(true);
  });

  it('is off when the switch is missing, blank or anything but exactly true', () => {
    for (const value of ['', 'false', 'TRUE', '1', 'yes']) {
      expect(googleSignInEnabled(env({ ...ready, GOOGLE_SIGN_IN_ENABLED: value }))).toBe(false);
    }
    const { GOOGLE_SIGN_IN_ENABLED: _switch, ...withoutSwitch } = ready;
    expect(googleSignInEnabled(env(withoutSwitch))).toBe(false);
  });

  it('is off when Neon Auth is not configured, however the switch is set', () => {
    expect(googleSignInEnabled(env({ ...ready, NEON_AUTH_BASE_URL: '' }))).toBe(false);
    expect(googleSignInEnabled(env({ ...ready, NEON_AUTH_BASE_URL: 'http://auth.test' }))).toBe(
      false,
    );
    expect(googleSignInEnabled(env({ ...ready, NEON_AUTH_COOKIE_SECRET: 'short' }))).toBe(false);
  });
});

describe('safeProviderRedirect', () => {
  it('accepts secure web addresses only', () => {
    expect(safeProviderRedirect('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    );
    for (const bad of [
      'http://accounts.google.com',
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      'not a url',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(safeProviderRedirect(bad)).toBeNull();
    }
  });
});
