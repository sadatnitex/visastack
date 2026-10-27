import { PLATFORM_CAPABILITY_KEYS } from '@visastack/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Platform capability registry (master recovery directive §7): server-
 * authoritative. `agencyCollaboration`'s PR 1 authorization defects
 * (docs/audits/commercial-readiness-recovery-baseline.md §7) were repaired
 * and covered by the hostile-authorization suite in PR 2. `bulkExport`'s
 * PR 5 gap (EXPORT_PROFILE is a step-up action, and no real WorkOS step-up
 * mechanism existed anywhere in the app) was closed by a genuine WorkOS
 * reauthentication flow (apps/web/src/lib/step-up.ts). Both now report
 * `available` like any other configured capability; see
 * apps/web/src/lib/capabilities.ts.
 */

const ENV_KEYS = [
  'DEPLOYMENT_MODE',
  'VERCEL_ENV',
  'NEON_AUTH_BASE_URL',
  'NEON_AUTH_COOKIE_SECRET',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_SIGNING_SECRET',
  'STEP_UP_SIGNING_SECRET',
  'AI_ENABLED',
  'OPENAI_API_KEY',
  'MALWARE_SCANNER_PROVIDER',
  'CLAMAV_SOCKET_PATH',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'PAYMENT_PROVIDER',
  'SSLCOMMERZ_STORE_ID',
  'SSLCOMMERZ_STORE_PASSWORD',
  'SSLCOMMERZ_MODE',
] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];
  for (const key of ENV_KEYS) unsetEnv(key);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL[key];
    if (original === undefined) unsetEnv(key);
    else setEnv(key, original);
  }
});

describe('getPlatformCapabilities', () => {
  // This file's first dynamic import transitively pulls in ./commercial-readiness
  // -> ./ai -> the OpenAI SDK transform (same cost providers.test.ts/
  // commercial-readiness.test.ts already flag) — fast in isolation but can
  // exceed the 5s default under full monorepo test-suite contention
  // (docs/audits/post-programme-defect-register.md finding D-T1). A generous
  // explicit timeout avoids a spurious CI failure unrelated to this test's
  // own correctness.
  it('reports every one of the 20 registry fields (no gap left undefined)', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    const capabilities = getPlatformCapabilities();
    for (const key of PLATFORM_CAPABILITY_KEYS) {
      expect(capabilities[key]).toBeDefined();
    }
    expect(PLATFORM_CAPABILITY_KEYS.length).toBe(20);
  }, 15_000);

  it('reports agencyCollaboration available once its PR 1 defects are repaired (PR 2) and everything else is configured', async () => {
    setEnv('VERCEL_ENV', 'production');
    setEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
    setEnv('NEON_AUTH_COOKIE_SECRET', 'c'.repeat(40));
    setEnv('BLOB_READ_WRITE_TOKEN', 'x');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().agencyCollaboration).toBe('available');
  });

  it('reports bulkExport available now that a genuine step-up flow backs it (PR 5)', async () => {
    setEnv('VERCEL_ENV', 'production');
    setEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
    setEnv('NEON_AUTH_COOKIE_SECRET', 'c'.repeat(40));
    setEnv('BLOB_READ_WRITE_TOKEN', 'x');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().bulkExport).toBe('available');
  });

  it('leaves direct individual-to-individual sharing available (not among the confirmed defects)', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().sharing).toBe('available');
  });

  it('reports authentication unconfigured when the Neon Auth settings are absent', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().authentication).toBe('unconfigured');
  });

  it('reports authentication available once the Neon Auth address and cookie secret are present', async () => {
    setEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
    setEnv('NEON_AUTH_COOKIE_SECRET', 'c'.repeat(40));
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().authentication).toBe('available');
  });

  it('reports documentUpload/ownerPreview unconfigured on a real deployment with no blob token', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { getPlatformCapabilities } = await import('./capabilities');
    const capabilities = getPlatformCapabilities();
    expect(capabilities.documentUpload).toBe('unconfigured');
    expect(capabilities.ownerPreview).toBe('unconfigured');
  });

  it('reports documentUpload available in development without a blob token (NeonBlobStorage fallback)', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().documentUpload).toBe('available');
  });

  it('reports malwareScanning unconfigured by default, structural validation alone is not antivirus', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().malwareScanning).toBe('unconfigured');
  });

  it('reports malwareScanning available once a real ClamAV adapter is genuinely configured (SEC-05)', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    setEnv('CLAMAV_SOCKET_PATH', '/var/run/clamav/clamd.ctl');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().malwareScanning).toBe('available');
  });

  it('reports malwareScanning unconfigured when clamav is selected but no connection is given', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().malwareScanning).toBe('unconfigured');
  });

  it('reports aiExtraction unconfigured when AI_ENABLED is not exactly "true"', async () => {
    setEnv('OPENAI_API_KEY', 'sk-x');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().aiExtraction).toBe('unconfigured');
  });

  it('reports aiExtraction available when fully configured', async () => {
    setEnv('AI_ENABLED', 'true');
    setEnv('OPENAI_API_KEY', 'sk-x');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().aiExtraction).toBe('available');
  });

  it('keeps publicSignup/realApplicantData/commercialClaims disabled outside commercial mode', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { getPlatformCapabilities } = await import('./capabilities');
    const capabilities = getPlatformCapabilities();
    expect(capabilities.publicSignup).toBe('disabled');
    expect(capabilities.realApplicantData).toBe('disabled');
    expect(capabilities.commercialClaims).toBe('disabled');
  });

  it('keeps publicSignup/realApplicantData/commercialClaims disabled in commercial mode alone — DEPLOYMENT_MODE is not the commercial readiness guard (master directive §7 "PR 11")', async () => {
    setEnv('DEPLOYMENT_MODE', 'commercial');
    const { getPlatformCapabilities } = await import('./capabilities');
    const capabilities = getPlatformCapabilities();
    expect(capabilities.publicSignup).toBe('disabled');
    expect(capabilities.realApplicantData).toBe('disabled');
    expect(capabilities.commercialClaims).toBe('disabled');
  });

  it('reports payments unconfigured by default, whatever the deployment mode', async () => {
    setEnv('DEPLOYMENT_MODE', 'commercial');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().payments).toBe('unconfigured');
  });

  it('reports payments available only when the provider is chosen and fully configured (S11)', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    setEnv('SSLCOMMERZ_STORE_ID', 'store-1');
    setEnv('SSLCOMMERZ_STORE_PASSWORD', 'synthetic-password');
    setEnv('SSLCOMMERZ_MODE', 'sandbox');
    expect(getPlatformCapabilities().payments).toBe('unconfigured');
    setEnv('PAYMENT_PROVIDER', 'sslcommerz');
    expect(getPlatformCapabilities().payments).toBe('available');
    unsetEnv('SSLCOMMERZ_MODE');
    expect(getPlatformCapabilities().payments).toBe('unconfigured');
  });
});

describe('capabilityUnavailableMessage', () => {
  it('falls back to a generic honest message for any other capability', async () => {
    const { capabilityUnavailableMessage } = await import('./capabilities');
    expect(capabilityUnavailableMessage('payments').length).toBeGreaterThan(0);
  });
});

it('enables owner original downloads only with storage and both server signing keys', async () => {
  const { getPlatformCapabilities } = await import('./capabilities');
  setEnv('DEPLOYMENT_MODE', 'controlled_pilot');
  setEnv('BLOB_READ_WRITE_TOKEN', 'test-only');
  expect(getPlatformCapabilities().originalDownload).toBe('unconfigured');
  setEnv('BLOB_SIGNING_SECRET', 'test-only');
  expect(getPlatformCapabilities().originalDownload).toBe('unconfigured');
  setEnv('STEP_UP_SIGNING_SECRET', 'test-only');
  expect(getPlatformCapabilities().originalDownload).toBe('available');
  expect(getPlatformCapabilities().redactedDownload).toBe('disabled');
  unsetEnv('BLOB_READ_WRITE_TOKEN');
  expect(getPlatformCapabilities().originalDownload).toBe('unconfigured');
});
