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
  isStaffContext: (...args: unknown[]) => isStaffContext(...args),
}));
const withSession = vi.fn();
vi.mock('./session', () => ({ withSession }));
vi.mock('./server-error', () => ({ reportServerError: vi.fn() }));

import { passkeyOfferedAtReauth } from './passkey-offer';

beforeEach(() => {
  vi.stubEnv('PASSKEYS', 'on');
  getSession.mockReset().mockResolvedValue({
    data: { user: { id: 'u1', email: 'p@example.test', emailVerified: true } },
  });
  neonSessionAgeSeconds.mockReset().mockResolvedValue(3600);
  getAccountByEmail.mockReset().mockResolvedValue({ id: 'acct-1' });
  hasPasskey.mockReset().mockResolvedValue(true);
  isStaffContext.mockReset().mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe('passkeyOfferedAtReauth', () => {
  it('offers a passkey to a signed-in traveller who has one', async () => {
    expect(await passkeyOfferedAtReauth()).toBe(true);
    expect(withSession).not.toHaveBeenCalled();
  });

  it('offers nothing when it could not help', async () => {
    vi.stubEnv('PASSKEYS', '');
    expect(await passkeyOfferedAtReauth()).toBe(false);
    vi.stubEnv('PASSKEYS', 'on');
    hasPasskey.mockResolvedValueOnce(false);
    expect(await passkeyOfferedAtReauth()).toBe(false);
    hasPasskey.mockResolvedValueOnce(null);
    expect(await passkeyOfferedAtReauth()).toBe(false);
    isStaffContext.mockResolvedValueOnce(true);
    expect(await passkeyOfferedAtReauth()).toBe(false);
    neonSessionAgeSeconds.mockResolvedValueOnce(8 * 24 * 60 * 60);
    expect(await passkeyOfferedAtReauth()).toBe(false);
    getSession.mockResolvedValueOnce({ data: null });
    expect(await passkeyOfferedAtReauth()).toBe(false);
    getAccountByEmail.mockResolvedValueOnce(undefined);
    expect(await passkeyOfferedAtReauth()).toBe(false);
    getSession.mockRejectedValueOnce(new Error('down'));
    expect(await passkeyOfferedAtReauth()).toBe(false);
  });
});
