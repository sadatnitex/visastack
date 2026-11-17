import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Email me a sign-in link" (Q8). The answer never depends on whether the address has an
 * account, the email limit is checked first and refuses when it cannot be read, the link always
 * returns to this site, and nothing about the address is logged.
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('server-only', () => ({}));
/** Cookies the response would set, by name, in the order they were set. */
const setCookies: string[] = [];
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string) => {
      setCookies.push(name);
    },
  }),
}));

const magicLink = vi.fn();
const signInEmail = vi.fn();
const getSession = vi.fn();
vi.mock('../../lib/neon-auth', () => ({
  getNeonAuth: () => ({ signIn: { magicLink, email: signInEmail }, getSession }),
}));
const withinAuthLimits = vi.fn(async (_input?: unknown) => true);
vi.mock('../../lib/auth-throttle', () => ({
  withinAuthLimits: (input: unknown) => withinAuthLimits(input),
}));
vi.mock('../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://app.example.test' }));
const signupAccountExists = vi.fn();
vi.mock('../../lib/signup-account', () => ({
  signupAccountExists: (email: string) => signupAccountExists(email),
}));
const reportServerError = vi.fn();
vi.mock('../../lib/server-error', () => ({
  reportServerError: (...args: unknown[]) => reportServerError(...args),
}));

import { reauthLinkAction, signInLinkAction } from './actions';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function outcome(values: Record<string, string>): Promise<string> {
  try {
    await signInLinkAction(form(values));
  } catch (error) {
    return (error as Error).message.replace('REDIRECT:', '');
  }
  throw new Error('expected a redirect');
}

beforeEach(() => {
  vi.stubEnv('SIGN_IN_LINKS', 'on');
  setCookies.length = 0;
  // Neon Auth's answer sets its own short-lived check cookie in this browser.
  magicLink.mockReset().mockImplementation(async () => {
    const { cookies } = await import('next/headers');
    (await cookies()).set('__Secure-neon-auth.session_challenge', 'x', {});
    return { data: { status: true }, error: null };
  });
  withinAuthLimits.mockReset().mockResolvedValue(true);
  reportServerError.mockReset();
  signupAccountExists.mockReset();
  redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('signInLinkAction', () => {
  it('sends the link through Neon Auth with a return address on this site', async () => {
    expect(await outcome({ email: ' person@example.com ', next: '/app/cases' })).toBe(
      '/auth/sign-in?n=link_sent&next=%2Fapp%2Fcases',
    );
    expect(magicLink).toHaveBeenCalledWith({
      email: 'person@example.com',
      callbackURL: 'https://app.example.test/auth/link-return?next=%2Fapp%2Fcases',
      errorCallbackURL: 'https://app.example.test/auth/sign-in?e=link_expired&next=%2Fapp%2Fcases',
    });
  });

  it('gives the same answer, cookies and limits for an address with or without an account', async () => {
    signupAccountExists.mockImplementation(async (email: string) => email === 'known@example.com');
    const known = await outcome({ email: 'known@example.com' });
    const knownCookies = [...setCookies];
    const knownLimit = withinAuthLimits.mock.calls[0]?.[0] as {
      byEmail: string;
      byAddress: string;
    };
    setCookies.length = 0;
    const unknown = await outcome({ email: 'nobody@example.com' });
    const unknownLimit = withinAuthLimits.mock.calls[1]?.[0] as {
      byEmail: string;
      byAddress: string;
    };
    expect(known).toBe('/auth/sign-in?n=link_sent');
    expect(unknown).toBe(known);
    expect(setCookies).toEqual(knownCookies);
    expect(knownCookies).toEqual(['__Secure-neon-auth.session_challenge']);
    expect({ ...unknownLimit, email: '' }).toEqual({ ...knownLimit, email: '' });
    expect(magicLink).toHaveBeenCalledTimes(2);
    expect(signupAccountExists).not.toHaveBeenCalled();
  });

  it('gives the same answer when Neon Auth fails, and logs no address', async () => {
    magicLink.mockResolvedValueOnce({ data: null, error: { status: 500, code: 'X' } });
    expect(await outcome({ email: 'secret-person@example.com' })).toBe('/auth/sign-in?n=link_sent');
    magicLink.mockRejectedValueOnce(new Error('network'));
    expect(await outcome({ email: 'secret-person@example.com' })).toBe('/auth/sign-in?n=link_sent');
    expect(reportServerError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(reportServerError.mock.calls)).not.toContain('secret-person');
  });

  it('checks the email limit first, refuses when it cannot be read, and then sends nothing', async () => {
    withinAuthLimits.mockResolvedValueOnce(false);
    expect(await outcome({ email: 'person@example.com' })).toBe('/auth/sign-in?e=slow');
    expect(magicLink).not.toHaveBeenCalled();
    expect(withinAuthLimits).toHaveBeenCalledWith({
      email: 'person@example.com',
      byEmail: 'AUTH_EMAIL_SEND_EMAIL',
      byAddress: 'AUTH_EMAIL_SEND_IP',
      onFailure: 'deny',
    });
  });

  it('refuses an invalid address and never leaves the site through next', async () => {
    expect(await outcome({ email: 'not-an-address' })).toBe('/auth/sign-in?e=link_invalid');
    expect(magicLink).not.toHaveBeenCalled();
    expect(await outcome({ email: 'person@example.com', next: '//evil.example/x' })).toBe(
      '/auth/sign-in?n=link_sent',
    );
    expect(magicLink.mock.calls[0]?.[0]).toMatchObject({
      callbackURL: 'https://app.example.test/auth/link-return?next=%2Fapp',
    });
  });

  it('does nothing while switched off', async () => {
    vi.stubEnv('SIGN_IN_LINKS', 'true');
    expect(await outcome({ email: 'person@example.com', next: '/app/cases' })).toBe(
      '/auth/sign-in?next=%2Fapp%2Fcases',
    );
    expect(magicLink).not.toHaveBeenCalled();
    expect(withinAuthLimits).not.toHaveBeenCalled();
  });
});

describe('reauthLinkAction', () => {
  async function reauthOutcome(returnTo: string): Promise<string> {
    try {
      await reauthLinkAction(form({ returnTo, email: 'someone-else@example.com' }));
    } catch (error) {
      return (error as Error).message.replace('REDIRECT:', '');
    }
    throw new Error('expected a redirect');
  }

  it("sends the link to the signed-in person's own address, never one from the form", async () => {
    getSession.mockResolvedValue({ data: { user: { email: 'me@example.com' } } });
    expect(await reauthOutcome('/app/privacy')).toBe(
      '/auth/reauth?returnTo=%2Fapp%2Fprivacy&n=link_sent',
    );
    expect(magicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'me@example.com',
        callbackURL: 'https://app.example.test/auth/link-return?next=%2Fapp%2Fprivacy',
      }),
    );
  });

  it('needs a sign-in, respects the email limit, and does nothing while switched off', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await reauthOutcome('/app/privacy')).toBe('/auth/sign-in');
    getSession.mockResolvedValue({ data: { user: { email: 'me@example.com' } } });
    withinAuthLimits.mockResolvedValueOnce(false);
    expect(await reauthOutcome('/app/privacy')).toBe(
      '/auth/reauth?returnTo=%2Fapp%2Fprivacy&e=slow',
    );
    vi.stubEnv('SIGN_IN_LINKS', '');
    expect(await reauthOutcome('/app/privacy')).toBe('/auth/reauth?returnTo=%2Fapp%2Fprivacy');
    expect(magicLink).not.toHaveBeenCalled();
  });
});
