import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkRecentAuth = vi.fn(async () => {
  throw new Error('WorkOS must not be consulted when Neon Auth is selected');
});
vi.mock('@workos-inc/authkit-nextjs', () => ({
  checkRecentAuth: () => checkRecentAuth(),
  getSignInUrl: () => checkRecentAuth(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listMembershipsForAccount: vi.fn(async () => []),
}));
vi.mock('./admin', () => ({ isPlatformAdmin: vi.fn(async () => false) }));

const age = vi.fn();
vi.mock('./neon-recency', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  neonSessionAgeSeconds: () => age(),
}));

const DAY = 24 * 60 * 60;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv('STEP_UP_SIGNING_SECRET', 'x'.repeat(40));
});

describe('session age limit with Neon Auth', () => {
  it('lets a traveller session through for 7 days and a staff session for 12 hours', async () => {
    const { enforceSessionAgeLimit } = await import('./session-age');
    age.mockResolvedValue(6 * DAY);
    expect(await enforceSessionAgeLimit(false, '/app')).toEqual({ satisfied: true });
    age.mockResolvedValue(11 * 60 * 60);
    expect(await enforceSessionAgeLimit(true, '/app')).toEqual({ satisfied: true });
  });

  it('asks for the password again past the limit, with a same-site return address', async () => {
    const { enforceSessionAgeLimit } = await import('./session-age');
    age.mockResolvedValue(8 * DAY);
    expect(await enforceSessionAgeLimit(false, '/app')).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp',
    });
    age.mockResolvedValue(13 * 60 * 60);
    expect((await enforceSessionAgeLimit(true, '/app')).satisfied).toBe(false);
    age.mockResolvedValue(Number.POSITIVE_INFINITY);
    expect((await enforceSessionAgeLimit(false, '/app')).satisfied).toBe(false);
    expect(checkRecentAuth).not.toHaveBeenCalled();
  });
});

describe('step-up with Neon Auth', () => {
  const request = { accountId: 'a1', action: 'EXPORT', resourceId: 'r1' };

  it('is satisfied only within 5 minutes of the last password entry', async () => {
    const { establishStepUp } = await import('./step-up');
    age.mockResolvedValue(60);
    expect(await establishStepUp(request, '/app/x')).toEqual({ satisfied: true });
    age.mockResolvedValue(6 * 60);
    expect(await establishStepUp(request, '/app/x')).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp%2Fx',
    });
    expect(checkRecentAuth).not.toHaveBeenCalled();
  });

  it('never trusts a return address that leaves the site', async () => {
    const { establishStepUp } = await import('./step-up');
    age.mockResolvedValue(10 * 60);
    expect(await establishStepUp(request, 'https://evil.test')).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp',
    });
  });
});
