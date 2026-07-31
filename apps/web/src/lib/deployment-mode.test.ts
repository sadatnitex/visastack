import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Deployment-mode derivation (master recovery directive §3): the single
 * source of truth every capability/storage/readiness check now reads,
 * instead of each call site re-deriving "is this production" independently.
 */

const ENV_KEYS = ['DEPLOYMENT_MODE', 'VERCEL_ENV'] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];
  unsetEnv('DEPLOYMENT_MODE');
  unsetEnv('VERCEL_ENV');
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL[key];
    if (original === undefined) unsetEnv(key);
    else setEnv(key, original);
  }
});

describe('getDeploymentMode', () => {
  it('is "development" with no VERCEL_ENV (local dev / test)', async () => {
    const { getDeploymentMode } = await import('./deployment-mode');
    expect(getDeploymentMode()).toBe('development');
  });

  it('is "development" on a PR preview (VERCEL_ENV=preview)', async () => {
    setEnv('VERCEL_ENV', 'preview');
    const { getDeploymentMode } = await import('./deployment-mode');
    expect(getDeploymentMode()).toBe('development');
  });

  it('is "controlled_pilot" on the real Vercel production deployment', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { getDeploymentMode } = await import('./deployment-mode');
    expect(getDeploymentMode()).toBe('controlled_pilot');
  });

  it('honours an explicit DEPLOYMENT_MODE override over VERCEL_ENV', async () => {
    setEnv('VERCEL_ENV', 'production');
    setEnv('DEPLOYMENT_MODE', 'commercial');
    const { getDeploymentMode } = await import('./deployment-mode');
    expect(getDeploymentMode()).toBe('commercial');
  });

  it('ignores an invalid DEPLOYMENT_MODE value and falls back to VERCEL_ENV-derived mode', async () => {
    setEnv('DEPLOYMENT_MODE', 'not-a-real-mode');
    const { getDeploymentMode } = await import('./deployment-mode');
    expect(getDeploymentMode()).toBe('development');
  });

  it('never activates commercial mode through VERCEL_ENV alone — only an explicit override can', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { getDeploymentMode } = await import('./deployment-mode');
    expect(getDeploymentMode()).not.toBe('commercial');
  });
});

describe('isRealDeployment', () => {
  it('is false for development mode', async () => {
    const { isRealDeployment } = await import('./deployment-mode');
    expect(isRealDeployment()).toBe(false);
  });

  it('is true for controlled_pilot mode', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { isRealDeployment } = await import('./deployment-mode');
    expect(isRealDeployment()).toBe(true);
  });
});
