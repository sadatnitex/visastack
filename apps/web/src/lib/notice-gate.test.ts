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

import {
  NOTICES_PROOF_COOKIE,
  acknowledgeNotices,
  markNoticesSettled,
  mustAcknowledgeNotices,
  signsInWithPassword,
} from './notice-gate';

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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('mustAcknowledgeNotices', () => {
  it('asks a new sign-in to agree, reading only the database and the proof (never Neon Auth)', async () => {
    expect(await mustAcknowledgeNotices(db, user)).toBe(true);
    expect(neonAccountExists).toHaveBeenCalledWith(db, {
      neonUserId: 'neon-user-1',
      email: 'person@example.test',
    });
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it('never asks when an account already exists', async () => {
    neonAccountExists.mockResolvedValue(true);
    expect(await mustAcknowledgeNotices(db, user)).toBe(false);
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
    await acknowledgeNotices(db, user.id);
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect(await mustAcknowledgeNotices(db, user)).toBe(true);
  });

  it('ignores a proof made for an older version of the notices', async () => {
    await acknowledgeNotices(db, user.id);
    const proof = jar.get(NOTICES_PROOF_COOKIE) ?? '';
    vi.resetModules();
    vi.doMock('@visastack/services', () => ({
      SIGNUP_TERMS_VERSION: '2027-01-01.1',
      SIGNUP_PRIVACY_VERSION: '2027-01-01.1',
      neonAccountExists: () => Promise.resolve(false),
      acknowledgeSignInNotices: () => Promise.resolve(true),
    }));
    const later = await import('./notice-gate');
    jar.set(NOTICES_PROOF_COOKIE, proof);
    expect(await later.mustAcknowledgeNotices(db, user)).toBe(true);
    vi.doUnmock('@visastack/services');
  });
});

describe('signsInWithPassword', () => {
  it('is true for a person who has a password, however the field is named', async () => {
    listAccounts.mockResolvedValueOnce({ data: [{ providerId: 'credential' }] });
    expect(await signsInWithPassword()).toBe(true);
    listAccounts.mockResolvedValueOnce({
      data: [{ provider: 'credential' }, { provider: 'google' }],
    });
    expect(await signsInWithPassword()).toBe(true);
  });

  it('is false for Google only, and for anything unreadable', async () => {
    expect(await signsInWithPassword()).toBe(false);
    listAccounts.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await signsInWithPassword()).toBe(false);
    listAccounts.mockRejectedValueOnce(new Error('network'));
    expect(await signsInWithPassword()).toBe(false);
  });

  it('gives up on a stalled Neon Auth instead of hanging', async () => {
    vi.useFakeTimers();
    listAccounts.mockReturnValueOnce(new Promise(() => {}));
    const pending = signsInWithPassword();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe(false);
  });
});

describe('markNoticesSettled', () => {
  it('keeps a proof for a person who came through the sign-up form, so nothing is asked', async () => {
    expect(await markNoticesSettled(user.id)).toBe(true);
    expect(await mustAcknowledgeNotices(db, user)).toBe(false);
    expect(acknowledgeSignInNotices).not.toHaveBeenCalled();
  });

  it('keeps nothing when the proof cannot be signed', async () => {
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'short');
    expect(await markNoticesSettled(user.id)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});

describe('a proof the reader would refuse is never kept', () => {
  it('keeps nothing for an identity id too long to read back', async () => {
    expect(await markNoticesSettled('x'.repeat(400))).toBe(false);
    expect(await acknowledgeNotices(db, 'x'.repeat(400))).toBe(false);
    expect(set).not.toHaveBeenCalled();
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
    expect(set.mock.calls[0]?.[2]).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    });
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
