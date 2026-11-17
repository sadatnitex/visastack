import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getSession = vi.fn();
vi.mock('./neon-request-session', () => ({ requestSessionReader: () => ({ getSession }) }));
const neonSessionAgeSeconds = vi.fn();
vi.mock('./neon-recency', () => ({ neonSessionAgeSeconds: () => neonSessionAgeSeconds() }));
vi.mock('./public-db', () => ({
  withPublicDb: async (work: (db: unknown) => Promise<unknown>) => work({ db: true }),
}));
const getAccountByEmail = vi.fn();
vi.mock('@visastack/services', () => ({
  getAccountByEmail: (...args: unknown[]) => getAccountByEmail(...args),
}));
const hasPasskey = vi.fn();
vi.mock('@visastack/services/passkeys', () => ({
  hasPasskey: (...args: unknown[]) => hasPasskey(...args),
}));
const isStaffContext = vi.fn();
vi.mock('./session-age', () => ({
  TRAVELLER_MAX_SESSION_AGE_SECONDS: 7 * 24 * 60 * 60,
  isStaffContext: (...args: unknown[]) => isStaffContext(...args),
}));
const withSession = vi.fn();
vi.mock('./session', () => ({ withSession }));
vi.mock('./server-error', () => ({ reportServerError: vi.fn() }));

import { reauthChoices } from './passkey-offer';

const BOTH = { passkey: true, link: true };
const NONE = { passkey: false, link: false };

beforeEach(() => {
  vi.stubEnv('PASSKEYS', 'on');
  vi.stubEnv('SIGN_IN_LINKS', 'on');
  getSession.mockReset().mockResolvedValue({
    data: { user: { id: 'u1', email: 'p@example.test', emailVerified: true } },
  });
  neonSessionAgeSeconds.mockReset().mockResolvedValue(3600);
  getAccountByEmail.mockReset().mockResolvedValue({ id: 'acct-1' });
  hasPasskey.mockReset().mockResolvedValue(true);
  isStaffContext.mockReset().mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe('reauthChoices', () => {
  it('offers a passkey and an email link to a signed-in traveller, without withSession', async () => {
    expect(await reauthChoices('/app/privacy')).toEqual(BOTH);
    expect(withSession).not.toHaveBeenCalled();
  });

  it('offers staff neither: password and authenticator app, as before', async () => {
    isStaffContext.mockResolvedValue(true);
    expect(await reauthChoices('/app/privacy')).toEqual(NONE);
  });

  it('follows each switch on its own', async () => {
    vi.stubEnv('PASSKEYS', '');
    expect(await reauthChoices('/app/privacy')).toEqual({ passkey: false, link: true });
    vi.stubEnv('PASSKEYS', 'on');
    vi.stubEnv('SIGN_IN_LINKS', '');
    expect(await reauthChoices('/app/privacy')).toEqual({ passkey: true, link: false });
    vi.stubEnv('PASSKEYS', '');
    expect(await reauthChoices('/app/privacy')).toEqual(NONE);
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('offers no passkey when it could not help', async () => {
    hasPasskey.mockResolvedValueOnce(false);
    expect((await reauthChoices('/app/privacy')).passkey).toBe(false);
    hasPasskey.mockResolvedValueOnce(null);
    expect((await reauthChoices('/app/privacy')).passkey).toBe(false);
    neonSessionAgeSeconds.mockResolvedValueOnce(8 * 24 * 60 * 60);
    expect((await reauthChoices('/app/privacy')).passkey).toBe(false);
    expect(await reauthChoices('/app/account/passkeys')).toEqual({ passkey: false, link: true });
    expect((await reauthChoices('/app/account/passkeys?n=added')).passkey).toBe(false);
    expect((await reauthChoices('/app/account/passkeys-other')).passkey).toBe(true);
  });

  it('offers nothing without a readable, confirmed sign-in and account', async () => {
    getSession.mockResolvedValueOnce({ data: null });
    expect(await reauthChoices('/app')).toEqual(NONE);
    getSession.mockResolvedValueOnce({ data: { user: { email: 'p@example.test' } } });
    expect(await reauthChoices('/app')).toEqual(NONE);
    getAccountByEmail.mockResolvedValueOnce(undefined);
    expect(await reauthChoices('/app')).toEqual(NONE);
    getSession.mockRejectedValueOnce(new Error('down'));
    expect(await reauthChoices('/app')).toEqual(NONE);
  });
});
