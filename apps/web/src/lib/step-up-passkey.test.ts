import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Step-up with a passkey (Q8). The password age and the passkey age are mocked; the assurance
 * round trip runs for real. A passkey may stand in for a recently typed password, but only inside
 * the five-minute window, never for the staff authenticator code, and never for the absolute
 * session limit.
 */

const neonSessionAgeSeconds = vi.fn();
const passkeyConfirmationAgeSeconds = vi.fn();
const staffFactorGate = vi.fn();

vi.mock('./neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon-recency')>()),
  neonSessionAgeSeconds: (...args: unknown[]) => neonSessionAgeSeconds(...args),
}));
vi.mock('./passkey-recency', () => ({
  passkeyConfirmationAgeSeconds: (...args: unknown[]) => passkeyConfirmationAgeSeconds(...args),
}));
vi.mock('./staff-factor', () => ({
  staffFactorGate: (...args: unknown[]) => staffFactorGate(...args),
}));

beforeEach(() => {
  vi.stubEnv('STEP_UP_SIGNING_SECRET', 'test-step-up-secret');
  neonSessionAgeSeconds.mockReset();
  passkeyConfirmationAgeSeconds.mockReset();
  staffFactorGate.mockReset();
  staffFactorGate.mockResolvedValue({ kind: 'ok' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const REQUEST = { accountId: 'acct-1', action: 'EXPORT_PROFILE', resourceId: 'acct-1' } as const;

describe('step-up with a passkey', () => {
  it('accepts a passkey used in this sign-in in the last five minutes when the password is old', async () => {
    neonSessionAgeSeconds.mockResolvedValue(3600);
    passkeyConfirmationAgeSeconds.mockResolvedValue(30);
    const { establishStepUp, establishStepUpProof } = await import('./step-up');
    expect(await establishStepUp(REQUEST, '/app/privacy')).toEqual({ satisfied: true });
    const proof = await establishStepUpProof(REQUEST, '/app/privacy');
    expect(proof.kind).toBe('proof');
    expect(passkeyConfirmationAgeSeconds).toHaveBeenCalledWith('acct-1');
  }, 15_000);

  it('asks for the password when the passkey use is older than five minutes or absent', async () => {
    neonSessionAgeSeconds.mockResolvedValue(3600);
    passkeyConfirmationAgeSeconds.mockResolvedValue(301);
    const { establishStepUp, establishStepUpProof } = await import('./step-up');
    expect(await establishStepUp(REQUEST, '/app/privacy')).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp%2Fprivacy',
    });
    passkeyConfirmationAgeSeconds.mockResolvedValue(Number.POSITIVE_INFINITY);
    expect((await establishStepUpProof(REQUEST, '/app/privacy')).kind).toBe('reauth_required');
  }, 15_000);

  it('does not look at passkeys at all when the password is recent', async () => {
    neonSessionAgeSeconds.mockResolvedValue(10);
    const { establishStepUp } = await import('./step-up');
    expect(await establishStepUp(REQUEST, '/app/privacy')).toEqual({ satisfied: true });
    expect(passkeyConfirmationAgeSeconds).not.toHaveBeenCalled();
  }, 15_000);

  it('still asks staff for the authenticator code after a passkey', async () => {
    neonSessionAgeSeconds.mockResolvedValue(3600);
    passkeyConfirmationAgeSeconds.mockResolvedValue(5);
    staffFactorGate.mockResolvedValue({ kind: 'redirect', url: '/app/staff-code?returnTo=%2Fx' });
    const { establishStepUp } = await import('./step-up');
    expect(await establishStepUp(REQUEST, '/x')).toEqual({
      satisfied: false,
      reauthUrl: '/app/staff-code?returnTo=%2Fx',
    });
  }, 15_000);
});

describe('the absolute session limit ignores passkeys', () => {
  it('a passkey used a second ago does not keep an eight-day-old traveller sign-in alive', async () => {
    neonSessionAgeSeconds.mockResolvedValue(8 * 24 * 60 * 60);
    passkeyConfirmationAgeSeconds.mockResolvedValue(1);
    const { enforceSessionAgeLimit } = await import('./session-age');
    expect((await enforceSessionAgeLimit(false, '/app')).satisfied).toBe(false);
    expect(passkeyConfirmationAgeSeconds).not.toHaveBeenCalled();
  }, 15_000);
});
