import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The commercial readiness guard (master directive §7 "PR 11"): every named
 * gate is either a live signal, an explicit `COMMERCIAL_READINESS_ATTEST_*`
 * flag, or — for `realMalwareScanner` — permanently unsatisfiable until a
 * real scanner adapter is built. "No normal administrator may override this
 * guard" is the property under test throughout: no single flag, and no
 * combination of the OTHER 18 gates, may substitute for the one gate that
 * genuinely isn't true yet.
 */

const ATTEST_FLAGS = [
  'WORKOS_PRODUCTION',
  'EXTERNAL_DELETION_VERIFIED',
  'TENANT_ISOLATION_SUITE',
  'PERMISSION_MATRIX',
  'PRIVACY_CONSENT_CONFIG',
  'BACKUP_RESTORE_VERIFIED',
  'PRODUCTION_E2E',
  'INCIDENT_OWNER',
  'TERMS_AND_PRIVACY_NOTICE',
  'NO_CRITICAL_HIGH_FINDINGS',
  'EXTERNAL_PENTEST',
] as const;

const ENV_KEYS = [
  'VERCEL_ENV',
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  'BLOB_READ_WRITE_TOKEN',
  'STEP_UP_SIGNING_SECRET',
  'AI_ENABLED',
  'OPENAI_API_KEY',
  'OPENAI_PROJECT_ID',
  ...ATTEST_FLAGS.map((flag) => `COMMERCIAL_READINESS_ATTEST_${flag}` as const),
] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

/** Sets every live gate and every attestation flag to its satisfied value — everything except realMalwareScanner. */
function satisfyEveryGateExceptMalwareScanner(): void {
  setEnv('VERCEL_ENV', 'production');
  setEnv('WORKOS_API_KEY', 'x');
  setEnv('WORKOS_CLIENT_ID', 'x');
  setEnv('WORKOS_COOKIE_PASSWORD', 'x');
  setEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI', 'https://example.test/callback');
  setEnv('BLOB_READ_WRITE_TOKEN', 'x');
  setEnv('STEP_UP_SIGNING_SECRET', 'x');
  for (const flag of ATTEST_FLAGS) setEnv(`COMMERCIAL_READINESS_ATTEST_${flag}`, 'true');
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

describe('evaluateCommercialReadiness', () => {
  it('is not ready when nothing is configured or attested', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness({ databaseReady: false });
    expect(result.ready).toBe(false);
    expect(result.gates.find((g) => g.key === 'realMalwareScanner')?.satisfied).toBe(false);
  });

  it('reports every gate the master directive names, none silently missing', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const keys = evaluateCommercialReadiness({ databaseReady: true }).gates.map((g) => g.key);
    expect(keys).toEqual([
      'hosting',
      'workosProduction',
      'productionDatabase',
      'privateProductionStorage',
      'realMalwareScanner',
      'safeConversion',
      'stepUp',
      'externalObjectDeletionVerification',
      'tenantIsolationSuite',
      'permissionMatrix',
      'productionOpenAiProject',
      'privacyConsentConfiguration',
      'retentionDeletionWorkflow',
      'backupRestoreVerification',
      'authenticatedProductionE2e',
      'incidentOwner',
      'termsAndPrivacyNotice',
      'noCriticalHighFindings',
      'externalPenetrationTest',
    ]);
  });

  it('stays not-ready even when every other gate is satisfied — realMalwareScanner cannot be attested past', async () => {
    satisfyEveryGateExceptMalwareScanner();
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness({ databaseReady: true });
    const failing = result.gates.filter((g) => !g.satisfied);
    expect(failing).toEqual([
      { key: 'realMalwareScanner', label: 'real malware scanner', satisfied: false },
    ]);
    expect(result.ready).toBe(false);
  });

  it('never satisfies workosProduction from WorkOS config alone, without the explicit production attestation', async () => {
    setEnv('WORKOS_API_KEY', 'x');
    setEnv('WORKOS_CLIENT_ID', 'x');
    setEnv('WORKOS_COOKIE_PASSWORD', 'x');
    setEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI', 'https://example.test/callback');
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness({ databaseReady: true });
    expect(result.gates.find((g) => g.key === 'workosProduction')?.satisfied).toBe(false);
  });

  it('treats productionDatabase strictly as the caller-supplied live signal', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    expect(
      evaluateCommercialReadiness({ databaseReady: false }).gates.find(
        (g) => g.key === 'productionDatabase',
      )?.satisfied,
    ).toBe(false);
    expect(
      evaluateCommercialReadiness({ databaseReady: true }).gates.find(
        (g) => g.key === 'productionDatabase',
      )?.satisfied,
    ).toBe(true);
  });

  describe('productionOpenAiProject', () => {
    it('is satisfied trivially when AI is not enabled', async () => {
      const { evaluateCommercialReadiness } = await import('./commercial-readiness');
      expect(
        evaluateCommercialReadiness({ databaseReady: true }).gates.find(
          (g) => g.key === 'productionOpenAiProject',
        )?.satisfied,
      ).toBe(true);
    });

    it('is not satisfied when AI is enabled but no OPENAI_PROJECT_ID is configured', async () => {
      setEnv('AI_ENABLED', 'true');
      setEnv('OPENAI_API_KEY', 'sk-test');
      const { evaluateCommercialReadiness } = await import('./commercial-readiness');
      expect(
        evaluateCommercialReadiness({ databaseReady: true }).gates.find(
          (g) => g.key === 'productionOpenAiProject',
        )?.satisfied,
      ).toBe(false);
    });

    it('is satisfied once AI is enabled with a real key and an explicit project id', async () => {
      setEnv('AI_ENABLED', 'true');
      setEnv('OPENAI_API_KEY', 'sk-test');
      setEnv('OPENAI_PROJECT_ID', 'proj_123');
      const { evaluateCommercialReadiness } = await import('./commercial-readiness');
      expect(
        evaluateCommercialReadiness({ databaseReady: true }).gates.find(
          (g) => g.key === 'productionOpenAiProject',
        )?.satisfied,
      ).toBe(true);
    });
  });
});

describe('commercialConfigurationReady', () => {
  it('is false by default', async () => {
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(commercialConfigurationReady()).toBe(false);
  });

  it('stays false even with every attestable/live gate satisfied — the malware-scanner gate always blocks it', async () => {
    satisfyEveryGateExceptMalwareScanner();
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(commercialConfigurationReady()).toBe(false);
  });

  it('never consults live DB connectivity (it has none to consult)', async () => {
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(() => commercialConfigurationReady()).not.toThrow();
  });
});
