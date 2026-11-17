import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  googleAuthorizationUrl,
  googleSignInEnabled,
  onlyGoogleAccounts,
  requestOrigin,
  sessionSignInMethods,
  startedFromThisSite,
  withTimeout,
} from './social-sign-in';

vi.mock('server-only', () => ({}));
const getSession = vi.fn();
vi.mock('./neon-request-session', () => ({ requestSessionReader: () => ({ getSession }) }));
const listAccounts = vi.fn();
vi.mock('./neon-auth', () => ({ getNeonAuth: () => ({ listAccounts }) }));

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function configure(): void {
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
}

describe('googleSignInEnabled', () => {
  it('is on only when switched on and Neon Auth has everything it needs', () => {
    configure();
    vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
    expect(googleSignInEnabled()).toBe(true);
    vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', ' true ');
    expect(googleSignInEnabled()).toBe(true);
  });

  it('is off when the switch is missing, blank or anything but true', () => {
    configure();
    for (const value of ['', 'false', 'TRUE', '1', 'yes']) {
      vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', value);
      expect(googleSignInEnabled(), value).toBe(false);
    }
    vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', undefined);
    expect(googleSignInEnabled()).toBe(false);
  });

  it('is off when Neon Auth is not fully configured, however the switch is set', () => {
    vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'short');
    expect(googleSignInEnabled()).toBe(false);
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
    vi.stubEnv('NEON_AUTH_BASE_URL', 'http://auth.example.test');
    expect(googleSignInEnabled()).toBe(false);
    vi.stubEnv('NEON_AUTH_BASE_URL', '');
    expect(googleSignInEnabled()).toBe(false);
  });
});

describe('googleAuthorizationUrl', () => {
  it('accepts only a secure address on Google sign-in host', () => {
    expect(googleAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?state=1')).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?state=1',
    );
    for (const bad of [
      'http://accounts.google.com/o/oauth2/v2/auth',
      'https://evil.example/o/oauth2/v2/auth',
      'https://accounts.google.com.evil.example/auth',
      'https://evil.example/?u=https://accounts.google.com',
      'https://user@evil.example/',
      'javascript:alert(1)',
      '//accounts.google.com/auth',
      'not a url',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(googleAuthorizationUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('googleAuthorizationUrl with the Neon Auth address', () => {
  const BASE = 'https://auth.example.test/neondb/auth';
  it("accepts only Neon Auth's own start address under the configured base", () => {
    const start = `${BASE}/sign-in/social/init?token=t`;
    expect(googleAuthorizationUrl(start, BASE)).toBe(start);
    expect(googleAuthorizationUrl(start, `${BASE}/`)).toBe(start);
    expect(googleAuthorizationUrl(start)).toBeNull();
    for (const bad of [
      'https://auth.example.test/neondb/auth/sign-in/social',
      'https://auth.example.test/other/sign-in/social/init',
      'https://auth.example.test:8443/neondb/auth/sign-in/social/init',
      'http://auth.example.test/neondb/auth/sign-in/social/init',
      'https://x@auth.example.test/neondb/auth/sign-in/social/init',
    ]) {
      expect(googleAuthorizationUrl(bad, BASE), bad).toBeNull();
    }
    expect(googleAuthorizationUrl(start, 'http://auth.example.test/neondb/auth')).toBeNull();
    expect(googleAuthorizationUrl(start, 'not a url')).toBeNull();
  });
});

describe('startedFromThisSite', () => {
  const ORIGIN = 'https://app.example.test';
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  });

  it('accepts a click on our own page, with or without the browser fetch headers', () => {
    expect(startedFromThisSite(headers({ referer: `${ORIGIN}/auth/sign-in?e=x` }), ORIGIN)).toBe(
      true,
    );
    expect(startedFromThisSite(headers({ origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(
      startedFromThisSite(
        headers({
          referer: `${ORIGIN}/auth/sign-up`,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
        }),
        ORIGIN,
      ),
    ).toBe(true);
  });

  it('refuses another site, a typed or bookmarked visit, and anything that is not a page navigation', () => {
    const refused: Record<string, string>[] = [
      {},
      { referer: 'https://evil.example/page' },
      { origin: 'https://evil.example' },
      { referer: `${ORIGIN}.evil.example/` },
      { referer: 'not a url' },
      { referer: `${ORIGIN}/auth/sign-in`, 'sec-fetch-site': 'cross-site' },
      { referer: `${ORIGIN}/auth/sign-in`, 'sec-fetch-site': 'same-site' },
      { referer: `${ORIGIN}/auth/sign-in`, 'sec-fetch-site': 'none' },
      { referer: `${ORIGIN}/auth/sign-in`, 'sec-fetch-dest': 'image' },
      { referer: `${ORIGIN}/auth/sign-in`, 'sec-fetch-dest': 'iframe' },
      { referer: `${ORIGIN}/auth/sign-in`, 'sec-fetch-dest': 'empty' },
    ];
    for (const values of refused) {
      expect(startedFromThisSite(headers(values), ORIGIN), JSON.stringify(values)).toBe(false);
    }
  });
});

describe('onlyGoogleAccounts', () => {
  it('is true only for a person whose sign-in methods are Google and nothing else', () => {
    expect(onlyGoogleAccounts([{ providerId: 'google' }])).toBe(true);
    expect(onlyGoogleAccounts([{ provider: 'google' }])).toBe(true);
  });

  it('is false with a password, with nothing readable, or with another provider only', () => {
    expect(onlyGoogleAccounts([{ providerId: 'credential' }])).toBe(false);
    expect(onlyGoogleAccounts([{ providerId: 'google' }, { providerId: 'credential' }])).toBe(
      false,
    );
    expect(onlyGoogleAccounts([{ providerId: 'github' }])).toBe(false);
    for (const unreadable of [[], null, undefined, 'google', {}, [null], [42], [{}]]) {
      expect(onlyGoogleAccounts(unreadable)).toBe(false);
    }
  });
});

describe('withTimeout', () => {
  it('returns the answer when it arrives in time and leaves no timer behind', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve('done'), 1000)).resolves.toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects when the call stalls', async () => {
    vi.useFakeTimers();
    const stalled = withTimeout(new Promise<string>(() => {}), 1000);
    const outcome = expect(stalled).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
  });

  it('passes a failure of the call through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});

describe('requestOrigin', () => {
  const at = (url: string, headers: Record<string, string> = {}) =>
    requestOrigin(new Request(url, { headers }));

  it('is the address the framework gave when nothing is forwarded', () => {
    expect(at('https://app.example.test/auth/google')).toBe('https://app.example.test');
    expect(at('http://localhost:3100/auth/google')).toBe('http://localhost:3100');
  });

  it('is the forwarded host and scheme behind a proxy, first value only, in lower case', () => {
    expect(
      at('https://0.0.0.0:10000/auth/google', {
        'x-forwarded-host': 'WWW.Example.test, other.example',
        'x-forwarded-proto': 'https, http',
      }),
    ).toBe('https://www.example.test');
  });

  it('ignores a forwarded value that is not a plain host and scheme', () => {
    for (const headers of [
      { 'x-forwarded-host': 'evil.example/path' },
      { 'x-forwarded-host': 'evil.example@host' },
      { 'x-forwarded-host': 'a b' },
      { 'x-forwarded-proto': 'javascript' },
    ]) {
      expect(at('https://app.example.test/auth/google', headers)).toBe('https://app.example.test');
    }
  });
});

describe('sessionSignInMethods', () => {
  beforeEach(() => {
    getSession.mockReset();
    listAccounts.mockReset();
  });

  it('says nobody is signed in without asking for accounts', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await sessionSignInMethods()).toBe('signed-out');
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it('tells a person with no password from everyone else', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } } });
    listAccounts.mockResolvedValueOnce({ data: [{ providerId: 'google' }] });
    expect(await sessionSignInMethods()).toBe('google-only');
    listAccounts.mockResolvedValueOnce({ data: [{ providerId: 'credential' }] });
    expect(await sessionSignInMethods()).toBe('other');
    listAccounts.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await sessionSignInMethods()).toBe('other');
  });

  it('lets a failure reach the caller', async () => {
    getSession.mockRejectedValue(new Error('network'));
    await expect(sessionSignInMethods()).rejects.toThrow('network');
  });
});
