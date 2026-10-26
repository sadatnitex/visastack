import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3: the authenticator rule sits inside the step-up functions, so every one of the existing
 * call sites is covered without being edited, and it reuses the three outcomes they already
 * handle (a new outcome kind would fall through to "go ahead"). Here the gate and the password
 * age are mocked; the staff-factor tests cover the gate itself.
 */

const neonSessionAgeSeconds = vi.fn();
const staffFactorGate = vi.fn();

vi.mock('./neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon-recency')>()),
  neonSessionAgeSeconds: (...args: unknown[]) => neonSessionAgeSeconds(...args),
}));
vi.mock('./staff-factor', () => ({
  staffFactorGate: (...args: unknown[]) => staffFactorGate(...args),
}));

const REQUEST = { accountId: 'acct-1', action: 'PLATFORM_ROLE_REVOKE', resourceId: 'grant-1' };
const PROOF_REQUEST = {
  accountId: 'acct-1',
  action: 'DOWNLOAD_ORIGINAL' as const,
  resourceId: 'd-1',
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  setEnv('STEP_UP_SIGNING_SECRET', 'test-step-up-secret');
  neonSessionAgeSeconds.mockReset();
  staffFactorGate.mockReset();
  neonSessionAgeSeconds.mockResolvedValue(10);
});

afterEach(() => {
  setEnv('STEP_UP_SIGNING_SECRET', undefined);
  vi.resetModules();
});

describe('step-up asks staff for an authenticator code', () => {
  it('passes when the gate is satisfied', async () => {
    staffFactorGate.mockResolvedValue({ kind: 'ok' });
    const { establishStepUp, tryEstablishStepUp, establishStepUpProof } = await import('./step-up');
    expect(await establishStepUp(REQUEST, '/app/admin')).toEqual({ satisfied: true });
    expect(await tryEstablishStepUp(REQUEST, '/app/admin')).toEqual({ kind: 'satisfied' });
    expect((await establishStepUpProof(PROOF_REQUEST, '/app/x')).kind).toBe('proof');
    expect(staffFactorGate).toHaveBeenCalledWith('acct-1', '/app/admin');
  }, 15_000);

  it('sends staff to the code page through the existing reauth outcomes', async () => {
    staffFactorGate.mockResolvedValue({
      kind: 'redirect',
      url: '/app/staff-code?returnTo=%2Fapp%2Fadmin',
    });
    const { establishStepUp, tryEstablishStepUp, establishStepUpProof } = await import('./step-up');
    expect(await establishStepUp(REQUEST, '/app/admin')).toEqual({
      satisfied: false,
      reauthUrl: '/app/staff-code?returnTo=%2Fapp%2Fadmin',
    });
    expect(await tryEstablishStepUp(REQUEST, '/app/admin')).toEqual({
      kind: 'reauth_required',
      reauthUrl: '/app/staff-code?returnTo=%2Fapp%2Fadmin',
    });
    // No proof is handed back, so the access gate cannot be reached without the code.
    expect(await establishStepUpProof(PROOF_REQUEST, '/app/x')).toEqual({
      kind: 'reauth_required',
      reauthUrl: '/app/staff-code?returnTo=%2Fapp%2Fadmin',
    });
  }, 15_000);

  it('refuses through the not-configured path when the check cannot be made', async () => {
    staffFactorGate.mockResolvedValue({ kind: 'unavailable' });
    const { establishStepUp, tryEstablishStepUp, establishStepUpProof } = await import('./step-up');
    await expect(establishStepUp(REQUEST, '/app/admin')).rejects.toThrow();
    expect(await tryEstablishStepUp(REQUEST, '/app/admin')).toEqual({ kind: 'not_configured' });
    expect(await establishStepUpProof(PROOF_REQUEST, '/app/x')).toEqual({ kind: 'not_configured' });
  }, 15_000);

  it('asks for the password first: a stale sign-in never reaches the code check', async () => {
    neonSessionAgeSeconds.mockResolvedValue(301);
    staffFactorGate.mockResolvedValue({ kind: 'ok' });
    const { establishStepUp, establishStepUpProof } = await import('./step-up');
    const result = await establishStepUp(REQUEST, '/app/admin');
    expect(result.satisfied).toBe(false);
    expect((await establishStepUpProof(PROOF_REQUEST, '/app/x')).kind).toBe('reauth_required');
    expect(staffFactorGate).not.toHaveBeenCalled();
  }, 15_000);

  it('keeps the three outcomes every caller handles, and adds no fourth', async () => {
    const { tryEstablishStepUp } = await import('./step-up');
    type Kind = Awaited<ReturnType<typeof tryEstablishStepUp>>['kind'];
    const kinds: Record<Kind, true> = {
      satisfied: true,
      reauth_required: true,
      not_configured: true,
    };
    expect(Object.keys(kinds).sort()).toEqual(['not_configured', 'reauth_required', 'satisfied']);
  });
});
