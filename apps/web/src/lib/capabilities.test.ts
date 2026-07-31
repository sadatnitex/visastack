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
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  'BLOB_READ_WRITE_TOKEN',
  'AI_ENABLED',
  'OPENAI_API_KEY',
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
  it('reports every one of the 20 registry fields (no gap left undefined)', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    const capabilities = getPlatformCapabilities();
    for (const key of PLATFORM_CAPABILITY_KEYS) {
      expect(capabilities[key]).toBeDefined();
    }
    expect(PLATFORM_CAPABILITY_KEYS.length).toBe(20);
  });

  it('reports agencyCollaboration available once its PR 1 defects are repaired (PR 2) and everything else is configured', async () => {
    setEnv('VERCEL_ENV', 'production');
    setEnv('WORKOS_API_KEY', 'x');
    setEnv('WORKOS_CLIENT_ID', 'x');
    setEnv('WORKOS_COOKIE_PASSWORD', 'x');
    setEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI', 'https://example.test/callback');
    setEnv('BLOB_READ_WRITE_TOKEN', 'x');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().agencyCollaboration).toBe('available');
  });

  it('reports bulkExport available now that a genuine WorkOS step-up flow backs it (PR 5)', async () => {
    setEnv('VERCEL_ENV', 'production');
    setEnv('WORKOS_API_KEY', 'x');
    setEnv('WORKOS_CLIENT_ID', 'x');
    setEnv('WORKOS_COOKIE_PASSWORD', 'x');
    setEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI', 'https://example.test/callback');
    setEnv('BLOB_READ_WRITE_TOKEN', 'x');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().bulkExport).toBe('available');
  });

  it('leaves direct individual-to-individual sharing available (not among the confirmed defects)', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().sharing).toBe('available');
  });

  it('reports authentication unconfigured when WorkOS env vars are absent', async () => {
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().authentication).toBe('unconfigured');
  });

  it('reports authentication available once all required WorkOS vars are present', async () => {
    setEnv('WORKOS_API_KEY', 'x');
    setEnv('WORKOS_CLIENT_ID', 'x');
    setEnv('WORKOS_COOKIE_PASSWORD', 'x');
    setEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI', 'https://example.test/callback');
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

  it('never reports malwareScanning as available — structural validation is not antivirus', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().malwareScanning).not.toBe('available');
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

  it('never reports payments as anything other than unconfigured — no provider exists', async () => {
    setEnv('DEPLOYMENT_MODE', 'commercial');
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().payments).toBe('unconfigured');
  });
});

describe('capabilityUnavailableMessage', () => {
  it('falls back to a generic honest message for any other capability', async () => {
    const { capabilityUnavailableMessage } = await import('./capabilities');
    expect(capabilityUnavailableMessage('payments').length).toBeGreaterThan(0);
  });
});
