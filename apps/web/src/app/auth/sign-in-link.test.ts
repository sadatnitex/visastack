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

const magicLink = vi.fn();
const signInEmail = vi.fn();
vi.mock('../../lib/neon-auth', () => ({
  getNeonAuth: () => ({ signIn: { magicLink, email: signInEmail } }),
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

import { signInLinkAction } from './actions';

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
  magicLink.mockReset().mockResolvedValue({ data: { status: true }, error: null });
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

  it('gives the same answer and takes the same steps for any valid address', async () => {
    const known = await outcome({ email: 'known@example.com' });
    const unknown = await outcome({ email: 'nobody@example.com' });
    expect(known).toBe('/auth/sign-in?n=link_sent');
    expect(unknown).toBe(known);
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
