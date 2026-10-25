import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `enforceSessionAgeLimit`/`isStaffContext` (Commercial V1 SEC-01; directive Part 2 §5). Mocks
 * how long ago the person last typed their password (`neonSessionAgeSeconds`) plus the two
 * service-layer lookups `isStaffContext` composes; real DB access is exercised separately by
 * `listMembershipsForAccount`'s and `isPlatformAdmin`'s own tests. The re-check link is built for
 * real.
 */

const neonSessionAgeSeconds = vi.fn();
const listMembershipsForAccount = vi.fn();
const isPlatformAdmin = vi.fn();

vi.mock('./neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon-recency')>()),
  neonSessionAgeSeconds: (...args: unknown[]) => neonSessionAgeSeconds(...args),
}));

vi.mock('@visastack/services', () => ({
  listMembershipsForAccount: (...args: unknown[]) => listMembershipsForAccount(...args),
}));

vi.mock('./admin', () => ({
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdmin(...args),
}));

const CTX = { accountId: 'acct-1', email: 'traveller@example.com' };
const DB = {} as never;

beforeEach(() => {
  neonSessionAgeSeconds.mockReset();
  listMembershipsForAccount.mockReset();
  isPlatformAdmin.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('isStaffContext', () => {
  it('is false for an account with no active membership and no platform role', async () => {
    listMembershipsForAccount.mockResolvedValue([]);
    isPlatformAdmin.mockResolvedValue(false);
    const { isStaffContext } = await import('./session-age');
    expect(await isStaffContext(DB, CTX)).toBe(false);
  });

  it('is true for an account with at least one ACTIVE organization membership', async () => {
    listMembershipsForAccount.mockResolvedValue([
      { organization: {}, membershipId: 'm1', role: 'MEMBER', active: true },
    ]);
    isPlatformAdmin.mockResolvedValue(false);
    const { isStaffContext } = await import('./session-age');
    expect(await isStaffContext(DB, CTX)).toBe(true);
  });

  it('is false when the account only has an INACTIVE (deactivated) membership', async () => {
    listMembershipsForAccount.mockResolvedValue([
      { organization: {}, membershipId: 'm1', role: 'MEMBER', active: false },
    ]);
    isPlatformAdmin.mockResolvedValue(false);
    const { isStaffContext } = await import('./session-age');
    expect(await isStaffContext(DB, CTX)).toBe(false);
  });

  it('is true for a platform admin with zero organization memberships', async () => {
    listMembershipsForAccount.mockResolvedValue([]);
    isPlatformAdmin.mockResolvedValue(true);
    const { isStaffContext } = await import('./session-age');
    expect(await isStaffContext(DB, CTX)).toBe(true);
  });
});

describe('enforceSessionAgeLimit', () => {
  const STAFF = 12 * 60 * 60;
  const TRAVELLER = 7 * 24 * 60 * 60;

  it('applies the 12-hour staff threshold when staffContext is true', async () => {
    const { enforceSessionAgeLimit } = await import('./session-age');
    neonSessionAgeSeconds.mockResolvedValue(STAFF);
    expect(await enforceSessionAgeLimit(true, '/app')).toEqual({ satisfied: true });
    neonSessionAgeSeconds.mockResolvedValue(STAFF + 1);
    expect((await enforceSessionAgeLimit(true, '/app')).satisfied).toBe(false);
  });

  it('applies the 7-day traveller threshold when staffContext is false', async () => {
    const { enforceSessionAgeLimit } = await import('./session-age');
    // Older than the staff limit, still inside the traveller limit.
    neonSessionAgeSeconds.mockResolvedValue(STAFF + 1);
    expect(await enforceSessionAgeLimit(false, '/app')).toEqual({ satisfied: true });
    neonSessionAgeSeconds.mockResolvedValue(TRAVELLER + 1);
    expect((await enforceSessionAgeLimit(false, '/app')).satisfied).toBe(false);
  });

  it('returns the password re-check page, never a bare boolean, once the threshold is exceeded', async () => {
    neonSessionAgeSeconds.mockResolvedValue(STAFF + 1);
    const { enforceSessionAgeLimit } = await import('./session-age');
    expect(await enforceSessionAgeLimit(true, '/app')).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp',
    });
  });

  it('forwards the exact returnTo given, never a different destination', async () => {
    neonSessionAgeSeconds.mockResolvedValue(TRAVELLER + 1);
    const { enforceSessionAgeLimit } = await import('./session-age');
    expect(await enforceSessionAgeLimit(false, '/app/applicant/123')).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp%2Fapplicant%2F123',
    });
  });
});
