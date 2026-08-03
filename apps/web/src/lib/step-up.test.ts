import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `establishStepUp` (master directive §7 "PR 5"): never trusts a
 * client-supplied boolean. These tests mock only the two WorkOS entry
 * points (`checkRecentAuth`/`getSignInUrl`) — everything downstream (the
 * mint-and-verify assurance round trip) runs for real against
 * `@visastack/services`.
 */

const checkRecentAuth = vi.fn();
const getSignInUrl = vi.fn();

vi.mock('@workos-inc/authkit-nextjs', () => ({
  checkRecentAuth: (...args: unknown[]) => checkRecentAuth(...args),
  getSignInUrl: (...args: unknown[]) => getSignInUrl(...args),
}));

const ENV_KEYS = ['STEP_UP_SIGNING_SECRET'] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];
  setEnv('STEP_UP_SIGNING_SECRET', 'test-step-up-secret');
  checkRecentAuth.mockReset();
  getSignInUrl.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL[key];
    if (original === undefined) unsetEnv(key);
    else setEnv(key, original);
  }
  vi.resetModules();
});

const REQUEST = { accountId: 'acct-1', action: 'EXPORT_PROFILE', resourceId: 'org-1' };

describe('establishStepUp — genuine WorkOS recency, never a browser boolean', () => {
  // Module re-import (vi.resetModules in afterEach) plus the real HMAC
  // mint/verify round trip is fast in isolation (~1s) but can approach the
  // 5s default under full monorepo test-suite contention (7 packages'
  // vitest processes running concurrently) — a generous explicit timeout
  // avoids a spurious CI failure that has nothing to do with this test's
  // own correctness.
  it('reports satisfied once a fresh WorkOS session mints and self-verifies a real assurance record', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: new Date(), isStale: false });
    const { establishStepUp } = await import('./step-up');
    const result = await establishStepUp(REQUEST, 'https://app.example/return');
    expect(result).toEqual({ satisfied: true });
    expect(getSignInUrl).not.toHaveBeenCalled();
  }, 15_000);

  it('never reports satisfied for a stale session — returns a genuine WorkOS reauth URL instead', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: null, isStale: true });
    getSignInUrl.mockResolvedValue('https://auth.workos.com/sign-in?reauth=1');
    const { establishStepUp } = await import('./step-up');
    const result = await establishStepUp(REQUEST, 'https://app.example/return');
    expect(result).toEqual({
      satisfied: false,
      reauthUrl: 'https://auth.workos.com/sign-in?reauth=1',
    });
  });

  it('forwards the step-up max age and the exact returnTo to getSignInUrl, never a different destination', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: null, isStale: true });
    getSignInUrl.mockResolvedValue('https://auth.workos.com/sign-in?reauth=1');
    const { establishStepUp } = await import('./step-up');
    await establishStepUp(REQUEST, 'https://app.example/agency/org-1/export');
    expect(checkRecentAuth).toHaveBeenCalledWith({ maxAge: 300 });
    expect(getSignInUrl).toHaveBeenCalledWith({
      maxAge: 300,
      returnTo: 'https://app.example/agency/org-1/export',
    });
  });

  it('throws rather than silently proceeding when STEP_UP_SIGNING_SECRET is not configured', async () => {
    unsetEnv('STEP_UP_SIGNING_SECRET');
    checkRecentAuth.mockResolvedValue({ authenticatedAt: new Date(), isStale: false });
    const { establishStepUp } = await import('./step-up');
    await expect(establishStepUp(REQUEST, 'https://app.example/return')).rejects.toThrow(
      /STEP_UP_SIGNING_SECRET/,
    );
  });
});

describe('tryEstablishStepUp — never an unhandled exception for a missing signing secret', () => {
  // docs/audits/post-programme-defect-register.md finding D-RT1: this
  // genuinely happened on the deployed pilot (an opaque 500 on
  // /app/privacy/export). `establishStepUp` itself must keep throwing (see
  // the test above) — this wrapper only translates that one specific,
  // known condition into a typed outcome for callers.
  it('reports a typed not_configured outcome instead of throwing', async () => {
    unsetEnv('STEP_UP_SIGNING_SECRET');
    checkRecentAuth.mockResolvedValue({ authenticatedAt: new Date(), isStale: false });
    const { tryEstablishStepUp } = await import('./step-up');
    const result = await tryEstablishStepUp(REQUEST, 'https://app.example/return');
    expect(result).toEqual({ kind: 'not_configured' });
  }, 15_000);

  it('still reports satisfied when properly configured and recently authenticated', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: new Date(), isStale: false });
    const { tryEstablishStepUp } = await import('./step-up');
    const result = await tryEstablishStepUp(REQUEST, 'https://app.example/return');
    expect(result).toEqual({ kind: 'satisfied' });
  });

  it('still reports reauth_required with the real WorkOS URL for a stale session', async () => {
    checkRecentAuth.mockResolvedValue({ authenticatedAt: null, isStale: true });
    getSignInUrl.mockResolvedValue('https://auth.workos.com/sign-in?reauth=1');
    const { tryEstablishStepUp } = await import('./step-up');
    const result = await tryEstablishStepUp(REQUEST, 'https://app.example/return');
    expect(result).toEqual({
      kind: 'reauth_required',
      reauthUrl: 'https://auth.workos.com/sign-in?reauth=1',
    });
  });

  it('still throws for a genuine, unexpected failure (not the known missing-secret case)', async () => {
    checkRecentAuth.mockRejectedValue(new Error('WorkOS is unreachable'));
    const { tryEstablishStepUp } = await import('./step-up');
    await expect(tryEstablishStepUp(REQUEST, 'https://app.example/return')).rejects.toThrow(
      /WorkOS is unreachable/,
    );
  });
});
