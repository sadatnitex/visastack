import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `establishStepUp` (master directive §7 "PR 5"): never trusts a client-supplied boolean. These
 * tests mock only how long ago the person last typed their password (`neonSessionAgeSeconds`);
 * the re-check link and everything downstream (the mint-and-verify assurance round trip) run for
 * real against `@visastack/services`.
 */

const neonSessionAgeSeconds = vi.fn();

vi.mock('./neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon-recency')>()),
  neonSessionAgeSeconds: (...args: unknown[]) => neonSessionAgeSeconds(...args),
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
  neonSessionAgeSeconds.mockReset();
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

describe('establishStepUp: genuine session recency, never a browser boolean', () => {
  // Module re-import (vi.resetModules in afterEach) plus the real HMAC
  // mint/verify round trip is fast in isolation (~1s) but can approach the
  // 5s default under full monorepo test-suite contention (7 packages'
  // vitest processes running concurrently): a generous explicit timeout
  // avoids a spurious CI failure that has nothing to do with this test's
  // own correctness.
  it('reports satisfied once a fresh session mints and self-verifies a real assurance record', async () => {
    neonSessionAgeSeconds.mockResolvedValue(10);
    const { establishStepUp } = await import('./step-up');
    const result = await establishStepUp(REQUEST, '/app/return');
    expect(result).toEqual({ satisfied: true });
  }, 15_000);

  it('accepts a password typed exactly 5 minutes ago and refuses one a second older', async () => {
    const { establishStepUp } = await import('./step-up');
    neonSessionAgeSeconds.mockResolvedValue(300);
    expect(await establishStepUp(REQUEST, '/app/return')).toEqual({ satisfied: true });
    neonSessionAgeSeconds.mockResolvedValue(301);
    expect((await establishStepUp(REQUEST, '/app/return')).satisfied).toBe(false);
  }, 15_000);

  it('never reports satisfied for a stale session: returns the password re-check page with the exact return path', async () => {
    neonSessionAgeSeconds.mockResolvedValue(301);
    const { establishStepUp } = await import('./step-up');
    const result = await establishStepUp(REQUEST, '/app/agency/org-1/export');
    expect(result).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp%2Fagency%2Forg-1%2Fexport',
    });
  });

  it('never sends a stale session back to another site', async () => {
    neonSessionAgeSeconds.mockResolvedValue(Number.POSITIVE_INFINITY);
    const { establishStepUp } = await import('./step-up');
    expect(await establishStepUp(REQUEST, 'https://other.example/steal')).toEqual({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp',
    });
  });

  it('throws rather than silently proceeding when STEP_UP_SIGNING_SECRET is not configured', async () => {
    unsetEnv('STEP_UP_SIGNING_SECRET');
    neonSessionAgeSeconds.mockResolvedValue(10);
    const { establishStepUp } = await import('./step-up');
    await expect(establishStepUp(REQUEST, '/app/return')).rejects.toThrow(/STEP_UP_SIGNING_SECRET/);
  });
});

describe('tryEstablishStepUp: never an unhandled exception for a missing signing secret', () => {
  // docs/audits/post-programme-defect-register.md finding D-RT1: this
  // genuinely happened on the deployed pilot (an opaque 500 on
  // /app/privacy/export). `establishStepUp` itself must keep throwing (see
  // the test above); this wrapper only translates that one specific,
  // known condition into a typed outcome for callers.
  it('reports a typed not_configured outcome instead of throwing', async () => {
    unsetEnv('STEP_UP_SIGNING_SECRET');
    neonSessionAgeSeconds.mockResolvedValue(10);
    const { tryEstablishStepUp } = await import('./step-up');
    const result = await tryEstablishStepUp(REQUEST, '/app/return');
    expect(result).toEqual({ kind: 'not_configured' });
  }, 15_000);

  it('still reports satisfied when properly configured and recently authenticated', async () => {
    neonSessionAgeSeconds.mockResolvedValue(10);
    const { tryEstablishStepUp } = await import('./step-up');
    const result = await tryEstablishStepUp(REQUEST, '/app/return');
    expect(result).toEqual({ kind: 'satisfied' });
  });

  it('still reports reauth_required with the password re-check page for a stale session', async () => {
    neonSessionAgeSeconds.mockResolvedValue(301);
    const { tryEstablishStepUp } = await import('./step-up');
    const result = await tryEstablishStepUp(REQUEST, '/app/return');
    expect(result).toEqual({
      kind: 'reauth_required',
      reauthUrl: '/auth/reauth?returnTo=%2Fapp%2Freturn',
    });
  });

  it('still throws for a genuine, unexpected failure (not the known missing-secret case)', async () => {
    neonSessionAgeSeconds.mockRejectedValue(new Error('session store is unreachable'));
    const { tryEstablishStepUp } = await import('./step-up');
    await expect(tryEstablishStepUp(REQUEST, '/app/return')).rejects.toThrow(
      /session store is unreachable/,
    );
  });
});
