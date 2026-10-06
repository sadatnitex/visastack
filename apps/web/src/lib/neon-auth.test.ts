import { beforeEach, describe, expect, it, vi } from 'vitest';

const createNeonAuth = vi.fn((config: unknown) => ({ config }));
vi.mock('@neondatabase/auth/next/server', () => ({
  createNeonAuth: (config: unknown) => createNeonAuth(config),
}));

import {
  NeonAuthNotConfiguredError,
  getNeonAuth,
  readNeonAuthSettings,
  resetNeonAuthForTests,
} from './neon-auth';

const env =
  (values: Record<string, string | undefined>) =>
  (name: string): string | undefined =>
    values[name];
const GOOD = 'x'.repeat(32);

describe('readNeonAuthSettings', () => {
  it('returns the settings when both are present and valid', () => {
    expect(
      readNeonAuthSettings(
        env({ NEON_AUTH_BASE_URL: ' https://auth.example.test ', NEON_AUTH_COOKIE_SECRET: GOOD }),
      ),
    ).toEqual({ baseUrl: 'https://auth.example.test', cookieSecret: GOOD });
  });

  it.each([
    ['no base address', { NEON_AUTH_COOKIE_SECRET: GOOD }, /NEON_AUTH_BASE_URL is missing/],
    [
      'a base address that is not https',
      { NEON_AUTH_BASE_URL: 'http://auth.example.test', NEON_AUTH_COOKIE_SECRET: GOOD },
      /https/,
    ],
    [
      'no cookie secret',
      { NEON_AUTH_BASE_URL: 'https://auth.example.test' },
      /NEON_AUTH_COOKIE_SECRET is missing/,
    ],
    [
      'a cookie secret under 32 characters',
      { NEON_AUTH_BASE_URL: 'https://auth.example.test', NEON_AUTH_COOKIE_SECRET: 'short' },
      /at least 32/,
    ],
  ])('refuses %s', (_label, values, message) => {
    expect(() => readNeonAuthSettings(env(values))).toThrow(NeonAuthNotConfiguredError);
    expect(() => readNeonAuthSettings(env(values))).toThrow(message);
  });

  it('never puts the secret in the error text', () => {
    try {
      readNeonAuthSettings(
        env({ NEON_AUTH_BASE_URL: 'http://auth.example.test', NEON_AUTH_COOKIE_SECRET: GOOD }),
      );
    } catch (error) {
      expect(String(error)).not.toContain(GOOD);
    }
  });
});

describe('getNeonAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNeonAuthForTests();
  });

  it('creates one instance from the environment and reuses it', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', GOOD);
    const first = getNeonAuth();
    expect(getNeonAuth()).toBe(first);
    expect(createNeonAuth).toHaveBeenCalledTimes(1);
    expect(createNeonAuth).toHaveBeenCalledWith({
      baseUrl: 'https://auth.example.test',
      cookies: { secret: GOOD },
    });
  });

  it('fails closed, without creating anything, when the settings are missing', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', '');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', '');
    expect(() => getNeonAuth()).toThrow(NeonAuthNotConfiguredError);
    expect(createNeonAuth).not.toHaveBeenCalled();
  });
});
