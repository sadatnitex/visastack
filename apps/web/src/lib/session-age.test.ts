import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `enforceSessionAgeLimit`/`isStaffContext` (Commercial V1 SEC-01; directive
 * Part 2 §5). Mocks the same two WorkOS entry points `step-up.test.ts`
 * already mocks, plus the two service-layer lookups `isStaffContext`
 * composes, real DB access is exercised separately by
 * `listMembershipsForAccount`'s and `isPlatformAdmin`'s own tests.
 */

const checkRecentAuth = vi.fn();
const getSignInUrl = vi.fn();
const listMembershipsForAccount = vi.fn();
const isPlatformAdmin = vi.fn();

vi.mock('@workos-inc/authkit-nextjs', () => ({
  checkRecentAuth: (...args: unknown[]) => checkRecentAuth(...args),
  getSignInUrl: (...args: unknown[]) => getSignInUrl(...args),
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
  checkRecentAuth.mockReset();
  getSignInUrl.mockReset();
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
  it('applies the 12-hour staff threshold when staffContext is true', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: new Date(), isStale: false });
    const { enforceSessionAgeLimit } = await import('./session-age');
    const result = await enforceSessionAgeLimit(true, '/app');
    expect(result).toEqual({ satisfied: true });
    expect(checkRecentAuth).toHaveBeenCalledWith({ maxAge: 12 * 60 * 60 });
  });

  it('applies the 7-day traveller threshold when staffContext is false', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: new Date(), isStale: false });
    const { enforceSessionAgeLimit } = await import('./session-age');
    const result = await enforceSessionAgeLimit(false, '/app');
    expect(result).toEqual({ satisfied: true });
    expect(checkRecentAuth).toHaveBeenCalledWith({ maxAge: 7 * 24 * 60 * 60 });
  });

  it('returns a genuine WorkOS reauth URL, never a bare boolean, once the threshold is exceeded', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: null, isStale: true });
    getSignInUrl.mockResolvedValue('https://auth.workos.com/sign-in?reauth=1');
    const { enforceSessionAgeLimit } = await import('./session-age');
    const result = await enforceSessionAgeLimit(true, '/app');
    expect(result).toEqual({
      satisfied: false,
      reauthUrl: 'https://auth.workos.com/sign-in?reauth=1',
    });
    expect(getSignInUrl).toHaveBeenCalledWith({ maxAge: 12 * 60 * 60, returnTo: '/app' });
  });

  it('forwards the exact returnTo given, never a different destination', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: null, isStale: true });
    getSignInUrl.mockResolvedValue('https://auth.workos.com/sign-in?reauth=1');
    const { enforceSessionAgeLimit } = await import('./session-age');
    await enforceSessionAgeLimit(false, '/app/applicant/123');
    expect(getSignInUrl).toHaveBeenCalledWith({
      maxAge: 7 * 24 * 60 * 60,
      returnTo: '/app/applicant/123',
    });
  });
});
