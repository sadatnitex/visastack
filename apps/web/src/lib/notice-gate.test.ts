import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const jar = new Map<string, string>();
const set = vi.fn((name: string, value: string, _options?: unknown) => {
  jar.set(name, value);
});
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set,
  }),
}));
const neonAccountExists = vi.fn();
const acknowledgeSignInNotices = vi.fn();
vi.mock('@visastack/services', () => ({
  SIGNUP_TERMS_VERSION: '2026-11-12.1',
  SIGNUP_PRIVACY_VERSION: '2026-11-12.1',
  neonAccountExists: (...args: unknown[]) => neonAccountExists(...args),
  acknowledgeSignInNotices: (...args: unknown[]) => acknowledgeSignInNotices(...args),
}));
const listAccounts = vi.fn();
vi.mock('./neon-auth', () => ({ getNeonAuth: () => ({ listAccounts }) }));

import { NOTICES_PROOF_COOKIE, acknowledgeNotices, mustAcknowledgeNotices } from './notice-gate';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';
const db = {} as never;
const user = { id: 'neon-user-1', email: 'person@example.test' };

beforeEach(() => {
  jar.clear();
  set.mockClear();
  neonAccountExists.mockReset().mockResolvedValue(false);
  acknowledgeSignInNotices.mockReset().mockResolvedValue(true);
  listAccounts.mockReset().mockResolvedValue({ data: [{ providerId: 'google' }], error: null });
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe('mustAcknowledgeNotices', () => {
  it('asks a new Google-only sign-in to agree', async () => {
    expect(await mustAcknowledgeNotices(db, user)).toBe(true);
    expect(neonAccountExists).toHaveBeenCalledWith(db, {
      neonUserId: 'neon-user-1',
      email: 'person@example.test',
    });
  });

  it('never asks when an account already exists, and asks nothing else of Neon Auth', async () => {
    neonAccountExists.mockResolvedValue(true);
    expect(await mustAcknowledgeNotices(db, user)).toBe(false);
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it('does not ask a person who came through the sign-up form (they have a password)', async () => {
    listAccounts.mockResolvedValue({ data: [{ providerId: 'credential' }], error: null });
    expect(await mustAcknowledgeNotices(db, user)).toBe(false);
    listAccounts.mockResolvedValue({
      data: [{ providerId: 'credential' }, { providerId: 'google' }],
      error: null,
    });
    expect(await mustAcknowledgeNotices(db, user)).toBe(false);
  });

  it('asks when Neon Auth cannot say how the person signs in (a mistake only asks once more)', async () => {
    listAccounts.mockRejectedValue(new Error('network'));
    expect(await mustAcknowledgeNotices(db, user)).toBe(true);
    listAccounts.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await mustAcknowledgeNotices(db, user)).toBe(true);
  });

  it('does not ask again once the person has agreed, and the proof is theirs alone', async () => {
    expect(await acknowledgeNotices(db, user.id)).toBe(true);
    expect(await mustAcknowledgeNotices(db, user)).toBe(false);
    expect(await mustAcknowledgeNotices(db, { ...user, id: 'neon-user-2' })).toBe(true);
  });

  it('ignores a proof that was forged, edited or made with another secret', async () => {
    await acknowledgeNotices(db, user.id);
    const good = jar.get(NOTICES_PROOF_COOKIE) ?? '';
    for (const bad of [
      '',
      'x',
      `${good}x`,
      `${good.split('.')[0]}.AAAA`,
      good.split('.')[0] ?? '',
    ]) {
      jar.set(NOTICES_PROOF_COOKIE, bad);
      expect(await mustAcknowledgeNotices(db, user), bad).toBe(true);
    }
    jar.set(NOTICES_PROOF_COOKIE, good);
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', `${SECRET}-different`);
    expect(await mustAcknowledgeNotices(db, user)).toBe(true);
  });

  it('ignores a proof that has expired', async () => {
    vi.useFakeTimers();
    try {
      await acknowledgeNotices(db, user.id);
      vi.setSystemTime(Date.now() + 61 * 60 * 1000);
      expect(await mustAcknowledgeNotices(db, user)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('acknowledgeNotices', () => {
  it('records first and keeps a proof only after the record was written', async () => {
    expect(await acknowledgeNotices(db, user.id)).toBe(true);
    expect(acknowledgeSignInNotices).toHaveBeenCalledWith(db, {
      neonUserId: 'neon-user-1',
      termsVersion: '2026-11-12.1',
      privacyVersion: '2026-11-12.1',
    });
    expect(set).toHaveBeenCalledOnce();
    const options = set.mock.calls[0]?.[2];
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600 });
  });

  it('keeps no proof when nothing was recorded, and passes a write failure on', async () => {
    acknowledgeSignInNotices.mockResolvedValueOnce(false);
    expect(await acknowledgeNotices(db, user.id)).toBe(false);
    expect(set).not.toHaveBeenCalled();
    acknowledgeSignInNotices.mockRejectedValueOnce(new Error('audit down'));
    await expect(acknowledgeNotices(db, user.id)).rejects.toThrow('audit down');
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps no proof when it cannot be signed', async () => {
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'short');
    expect(await acknowledgeNotices(db, user.id)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
