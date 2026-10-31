import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadinessSignals } from './readiness-signals';

/**
 * The commercial readiness guard (master directive §7 "PR 11" / Commercial
 * V1 SEC-05, reconciled by S27): every named gate is either a live signal or
 * an explicit `COMMERCIAL_READINESS_ATTEST_*` flag. "No normal administrator
 * may override this guard" is the property under test throughout: no single
 * flag, and no combination of the other gates, may substitute for a gate
 * whose own condition is not actually met. The one owner deferral (the
 * external penetration test, register H01) is pinned and every other gate is
 * proved not deferrable.
 */

const ATTEST_FLAGS = [
  'NEON_AUTH_PRODUCTION',
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

const GATE_KEYS = [
  'hosting',
  'signInProduction',
  'productionDatabase',
  'privateProductionStorage',
  'realMalwareScanner',
  'realEmailProvider',
  'realKeyManagement',
  'safeConversion',
  'stepUp',
  'externalObjectDeletionVerification',
  'tenantIsolationSuite',
  'permissionMatrix',
  'productionAiProvider',
  'privacyConsentConfiguration',
  'retentionDeletionWorkflow',
  'backupRestoreVerification',
  'authenticatedProductionE2e',
  'incidentOwner',
  'termsAndPrivacyNotice',
  'noCriticalHighFindings',
  'externalPenetrationTest',
] as const;

const deferEnv = (key: string) =>
  `COMMERCIAL_READINESS_DEFER_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;

const ENV_KEYS = [
  'VERCEL_ENV',
  'HOSTING_PLATFORM',
  'NEON_AUTH_BASE_URL',
  'NEON_AUTH_COOKIE_SECRET',
  'BLOB_READ_WRITE_TOKEN',
  'STORAGE_PROVIDER',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT_URL',
  'STEP_UP_SIGNING_SECRET',
  'AI_ENABLED',
  'AI_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_PROJECT_ID',
  'MALWARE_SCANNER_PROVIDER',
  'CLAMAV_SOCKET_PATH',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'GITHUB_INTAKE_DISPATCH_TOKEN',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'RESEND_FROM_ADDRESS',
  'KMS_PROVIDER',
  'KMS_KEY_ID',
  'KMS_AWS_REGION',
  'KMS_LOCAL_MASTER_KEY_BASE64',
  ...ATTEST_FLAGS.map((flag) => `COMMERCIAL_READINESS_ATTEST_${flag}` as const),
  ...[...GATE_KEYS, 'authentication'].map(deferEnv),
] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

/** AI settings saved but none active: dispatch off, so the AI gate passes. */
const DISPATCH_OFF: ReadinessSignals = {
  aiProvider: { kind: 'none_active' },
  scannerEvidenceFresh: false,
};

function input(databaseReady: boolean, signals: Partial<ReadinessSignals> = {}) {
  return { databaseReady, signals: { ...DISPATCH_OFF, ...signals } };
}

/** Sets every live gate and every attestation flag to its satisfied value, everything except realMalwareScanner. */
function satisfyEveryGateExceptMalwareScanner(): void {
  setEnv('VERCEL_ENV', 'production');
  setEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
  setEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(40));
  setEnv('BLOB_READ_WRITE_TOKEN', 'x');
  setEnv('STEP_UP_SIGNING_SECRET', 'x');
  setEnv('EMAIL_PROVIDER', 'resend');
  setEnv('RESEND_API_KEY', 'x');
  setEnv('RESEND_FROM_ADDRESS', 'VisaStack <notifications@example.test>');
  for (const flag of ATTEST_FLAGS) setEnv(`COMMERCIAL_READINESS_ATTEST_${flag}`, 'true');
}

/** Sets every gate, including a genuinely configured real malware scanner. */
function satisfyEveryGate(): void {
  satisfyEveryGateExceptMalwareScanner();
  setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
  setEnv('CLAMAV_SOCKET_PATH', '/var/run/clamav/clamd.ctl');
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

async function gateOf(
  key: string,
  signals: Partial<ReadinessSignals> = {},
): Promise<{ satisfied: boolean; detail?: string; deferral?: unknown } | undefined> {
  const { evaluateCommercialReadiness } = await import('./commercial-readiness');
  return evaluateCommercialReadiness(input(true, signals)).gates.find((g) => g.key === key);
}

describe('evaluateCommercialReadiness', () => {
  // The first dynamic import in this file pulls in ./ai -> @visastack/adapters'
  // OpenAI SDK transform, which is fast in isolation (~1s) but can approach
  // the 5s default under full monorepo test-suite contention. A generous
  // explicit timeout avoids a spurious CI failure that has nothing to do with
  // this test's own correctness.
  it('is not ready when nothing is configured or attested', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness(input(false));
    expect(result.ready).toBe(false);
    expect(result.gates.find((g) => g.key === 'realMalwareScanner')?.satisfied).toBe(false);
    expect(result.gates.find((g) => g.key === 'realKeyManagement')?.satisfied).toBe(false);
  }, 15_000);

  it('reports every gate with its label, none silently missing or renamed', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const gates = evaluateCommercialReadiness(input(true)).gates.map((g) => [g.key, g.label]);
    expect(gates).toEqual([
      ['hosting', 'commercial-compatible hosting'],
      ['signInProduction', 'production sign-in'],
      ['productionDatabase', 'production database'],
      ['privateProductionStorage', 'private production storage'],
      ['realMalwareScanner', 'real malware scanner'],
      ['realEmailProvider', 'real email provider'],
      ['realKeyManagement', 'real key management (KMS)'],
      ['safeConversion', 'safe conversion'],
      ['stepUp', 'step-up'],
      ['externalObjectDeletionVerification', 'external-object deletion verification'],
      ['tenantIsolationSuite', 'tenant-isolation suite'],
      ['permissionMatrix', 'permission matrix'],
      ['productionAiProvider', 'production AI provider with recorded data terms where AI is on'],
      ['privacyConsentConfiguration', 'privacy/consent configuration'],
      ['retentionDeletionWorkflow', 'retention/deletion workflow'],
      ['backupRestoreVerification', 'backup restore verification'],
      ['authenticatedProductionE2e', 'authenticated production E2E'],
      ['incidentOwner', 'incident owner'],
      ['termsAndPrivacyNotice', 'terms and privacy notice'],
      ['noCriticalHighFindings', 'no Critical/High findings'],
      ['externalPenetrationTest', 'external penetration test'],
    ]);
    expect(gates.map(([key]) => key)).toEqual([...GATE_KEYS]);
  });

  it('stays not-ready even when every other gate is satisfied, realMalwareScanner needs its own genuine configuration, not a stand-in', async () => {
    satisfyEveryGateExceptMalwareScanner();
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness(input(true));
    const failing = result.gates.filter((g) => !g.satisfied);
    expect(failing).toEqual([
      { key: 'realMalwareScanner', label: 'real malware scanner', satisfied: false },
      { key: 'realKeyManagement', label: 'real key management (KMS)', satisfied: false },
    ]);
    expect(result.ready).toBe(false);
  });

  it('realMalwareScanner responds to genuine configuration, but overall readiness still needs realKeyManagement', async () => {
    satisfyEveryGate();
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness(input(true));
    expect(result.gates.find((g) => g.key === 'realMalwareScanner')?.satisfied).toBe(true);
    const failing = result.gates.filter((g) => !g.satisfied);
    expect(failing).toEqual([
      { key: 'realKeyManagement', label: 'real key management (KMS)', satisfied: false },
    ]);
    expect(result.ready).toBe(false);
  });

  it('does not satisfy realMalwareScanner from MALWARE_SCANNER_PROVIDER=clamav alone, without a real connection configured', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    expect((await gateOf('realMalwareScanner'))?.satisfied).toBe(false);
  });

  describe('realMalwareScanner with the private scan runner (github_clamav, shared with S4)', () => {
    function runner(): void {
      setEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
      setEnv('VERCEL_ENV', 'production');
      setEnv('GITHUB_INTAKE_DISPATCH_TOKEN', 'x');
    }

    it('is satisfied on production with the dispatch token and the runner proof still fresh', async () => {
      runner();
      expect(await gateOf('realMalwareScanner', { scannerEvidenceFresh: true })).toEqual({
        key: 'realMalwareScanner',
        label: 'real malware scanner',
        satisfied: true,
      });
    });

    it('is not satisfied without a recent verification record, and says so', async () => {
      runner();
      expect(await gateOf('realMalwareScanner', { scannerEvidenceFresh: false })).toEqual({
        key: 'realMalwareScanner',
        label: 'real malware scanner',
        satisfied: false,
        detail: 'The private virus scanner has not proved it works in the last 72 hours.',
      });
    });

    it('is not satisfied by fresh proof without the dispatch token the scanner needs to start', async () => {
      runner();
      unsetEnv('GITHUB_INTAKE_DISPATCH_TOKEN');
      const gate = await gateOf('realMalwareScanner', { scannerEvidenceFresh: true });
      expect(gate?.satisfied).toBe(false);
      expect(gate?.detail).toMatch(/start token is not set/);
    });

    it('is not satisfied outside the production deployment, where intake never dispatches to the runner', async () => {
      runner();
      for (const where of ['preview', 'development']) {
        setEnv('VERCEL_ENV', where);
        const gate = await gateOf('realMalwareScanner', { scannerEvidenceFresh: true });
        expect(gate?.satisfied).toBe(false);
        expect(gate?.detail).toMatch(/only runs for the production site/);
      }
      unsetEnv('VERCEL_ENV');
      expect((await gateOf('realMalwareScanner', { scannerEvidenceFresh: true }))?.satisfied).toBe(
        false,
      );
    });

    it('is satisfied on the Render fallback production site, and hosting stays unsatisfied there', async () => {
      runner();
      unsetEnv('VERCEL_ENV');
      setEnv('HOSTING_PLATFORM', 'render');
      expect((await gateOf('realMalwareScanner', { scannerEvidenceFresh: true }))?.satisfied).toBe(
        true,
      );
      // A free fallback host is not commercial hosting: that gate still asks for Vercel production.
      expect((await gateOf('hosting'))?.satisfied).toBe(false);
    });

    it('ignores the runner proof when the scanner chosen is the built-in structural one', async () => {
      setEnv('VERCEL_ENV', 'production');
      setEnv('GITHUB_INTAKE_DISPATCH_TOKEN', 'x');
      expect((await gateOf('realMalwareScanner', { scannerEvidenceFresh: true }))?.satisfied).toBe(
        false,
      );
    });
  });

  describe('realEmailProvider', () => {
    it('is not satisfied when nothing is configured', async () => {
      expect((await gateOf('realEmailProvider'))?.satisfied).toBe(false);
    });

    it('is not satisfied by EMAIL_PROVIDER=resend alone, without RESEND_API_KEY/RESEND_FROM_ADDRESS', async () => {
      setEnv('EMAIL_PROVIDER', 'resend');
      expect((await gateOf('realEmailProvider'))?.satisfied).toBe(false);
    });

    it('is not satisfied by RESEND_API_KEY/RESEND_FROM_ADDRESS alone, without EMAIL_PROVIDER=resend', async () => {
      setEnv('RESEND_API_KEY', 'x');
      setEnv('RESEND_FROM_ADDRESS', 'VisaStack <notifications@example.test>');
      expect((await gateOf('realEmailProvider'))?.satisfied).toBe(false);
    });

    it('is satisfied only once EMAIL_PROVIDER=resend, RESEND_API_KEY, and RESEND_FROM_ADDRESS are all configured', async () => {
      setEnv('EMAIL_PROVIDER', 'resend');
      setEnv('RESEND_API_KEY', 'x');
      setEnv('RESEND_FROM_ADDRESS', 'VisaStack <notifications@example.test>');
      expect((await gateOf('realEmailProvider'))?.satisfied).toBe(true);
    });
  });

  it('never satisfies signInProduction from Neon Auth config alone, without the explicit production attestation', async () => {
    setEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
    setEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(40));
    expect((await gateOf('signInProduction'))?.satisfied).toBe(false);
  });

  it('treats productionDatabase strictly as the caller-supplied live signal', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    expect(
      evaluateCommercialReadiness(input(false)).gates.find((g) => g.key === 'productionDatabase')
        ?.satisfied,
    ).toBe(false);
    expect(
      evaluateCommercialReadiness(input(true)).gates.find((g) => g.key === 'productionDatabase')
        ?.satisfied,
    ).toBe(true);
  });

  describe('productionAiProvider', () => {
    const ai = async (aiProvider: ReadinessSignals['aiProvider']) =>
      (await gateOf('productionAiProvider', { aiProvider }))?.satisfied;

    it('is satisfied when AI dispatch is off because no saved configuration is active', async () => {
      expect(await ai({ kind: 'none_active' })).toBe(true);
    });

    it('is satisfied on a fresh install while the environment does not turn AI on', async () => {
      expect(await ai({ kind: 'no_configuration' })).toBe(true);
      setEnv('OPENAI_API_KEY', 'sk-test');
      expect(await ai({ kind: 'no_configuration' })).toBe(true);
    });

    it('is not satisfied by the old environment-only OpenAI path, even with a project id: it has no recorded data terms', async () => {
      setEnv('AI_ENABLED', 'true');
      setEnv('OPENAI_API_KEY', 'sk-test');
      expect(await ai({ kind: 'no_configuration' })).toBe(false);
      setEnv('OPENAI_PROJECT_ID', 'proj_123');
      expect(await ai({ kind: 'no_configuration' })).toBe(false);
      expect(
        (await gateOf('productionAiProvider', { aiProvider: { kind: 'no_configuration' } }))
          ?.detail,
      ).toMatch(/old environment settings/);
    });

    const ok = { hasKey: true, termsRecorded: true };

    it('is satisfied by an active configuration with a key and recorded data terms, whatever the environment says', async () => {
      setEnv('AI_ENABLED', 'true');
      setEnv('OPENAI_API_KEY', 'sk-test');
      expect(await ai({ kind: 'active', primary: ok, fallback: null })).toBe(true);
    });

    it('is not satisfied by an active configuration with a key but no recorded terms, and names it', async () => {
      const state = {
        kind: 'active',
        primary: { hasKey: true, termsRecorded: false },
        fallback: null,
      } as const;
      expect(await ai(state)).toBe(false);
      expect((await gateOf('productionAiProvider', { aiProvider: state }))?.detail).toBe(
        'The active AI provider has no recorded data terms.',
      );
    });

    it('is not satisfied by an active configuration with recorded terms but no usable key', async () => {
      const state = {
        kind: 'active',
        primary: { hasKey: false, termsRecorded: true },
        fallback: null,
      } as const;
      expect(await ai(state)).toBe(false);
      expect((await gateOf('productionAiProvider', { aiProvider: state }))?.detail).toBe(
        'The active AI provider has no usable key.',
      );
    });

    it('needs recorded terms for a fallback documents would really be sent to, and names the fallback', async () => {
      // `fallback: null` covers a fallback the gateway would not use (switched off, missing, no
      // usable key, same provider, unapproved data policy): nothing is sent there.
      expect(await ai({ kind: 'active', primary: ok, fallback: null })).toBe(true);
      expect(await ai({ kind: 'active', primary: ok, fallback: { termsRecorded: true } })).toBe(
        true,
      );
      const gate = await gateOf('productionAiProvider', {
        aiProvider: { kind: 'active', primary: ok, fallback: { termsRecorded: false } },
      });
      expect(gate?.satisfied).toBe(false);
      expect(gate?.detail).toBe('The fallback AI provider has no recorded data terms.');
      const both = await gateOf('productionAiProvider', {
        aiProvider: {
          kind: 'active',
          primary: { hasKey: false, termsRecorded: false },
          fallback: { termsRecorded: false },
        },
      });
      expect(both?.detail).toBe(
        'The active AI provider has no usable key. The active AI provider has no recorded data terms. The fallback AI provider has no recorded data terms.',
      );
    });

    it('fails closed when the settings could not be read (a missing table) or were never read', async () => {
      expect(await ai({ kind: 'unreadable' })).toBe(false);
      expect(await ai({ kind: 'unknown' })).toBe(false);
    });
  });
});

describe('owner deferrals', () => {
  /** The safety gates the S27 contract names, by key. Each must exist and never be deferrable. */
  const SAFETY_GATES = [
    'realKeyManagement',
    'realMalwareScanner',
    'privateProductionStorage',
    'signInProduction',
    'authentication',
    'stepUp',
    'realEmailProvider',
    'tenantIsolationSuite',
    'permissionMatrix',
    'backupRestoreVerification',
  ];

  async function everyGate(databaseReady: boolean) {
    const { evaluateCommercialReadiness, evaluateOperationalReadiness } = await import(
      './commercial-readiness'
    );
    return [
      ...evaluateCommercialReadiness(input(databaseReady)).gates,
      ...evaluateOperationalReadiness(input(databaseReady)).gates,
    ];
  }

  it('allows exactly two deferrable gates: the external penetration test (H01) and the virus scanner (H20)', async () => {
    const { DEFERRABLE_GATES } = await import('./commercial-readiness');
    expect([...DEFERRABLE_GATES]).toEqual([
      ['externalPenetrationTest', 'H01'],
      ['realMalwareScanner', 'H20'],
    ]);
  });

  it('defers the virus scanner with exactly H20, and a wrong id or an unset variable does not count', async () => {
    const { evaluateOperationalReadiness } = await import('./commercial-readiness');
    const find = () =>
      evaluateOperationalReadiness(input(true)).gates.find((g) => g.key === 'realMalwareScanner');
    unsetEnv('MALWARE_SCANNER_PROVIDER');
    unsetEnv(deferEnv('realMalwareScanner'));
    expect(find()?.satisfied).toBe(false);
    setEnv(deferEnv('realMalwareScanner'), 'H01');
    expect(find()?.satisfied).toBe(false);
    expect(find()?.deferral).toMatchObject({ status: 'not_deferred' });
    setEnv(deferEnv('realMalwareScanner'), 'H20');
    expect(find()?.satisfied).toBe(true);
    expect(find()?.deferral).toMatchObject({ status: 'deferred' });
    unsetEnv(deferEnv('realMalwareScanner'));
  });

  it('names the deferral variable after the gate key', async () => {
    const { deferralEnvName } = await import('./commercial-readiness');
    expect(deferralEnvName('externalPenetrationTest')).toBe(
      'COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST',
    );
    expect(deferralEnvName('authenticatedProductionE2e')).toBe(
      'COMMERCIAL_READINESS_DEFER_AUTHENTICATED_PRODUCTION_E2E',
    );
    for (const key of GATE_KEYS) expect(deferralEnvName(key)).toBe(deferEnv(key));
  });

  it('defers the penetration test with exactly H01: it shows "Deferred by Owner (H01)" and counts as passing', async () => {
    satisfyEveryGate();
    unsetEnv('COMMERCIAL_READINESS_ATTEST_EXTERNAL_PENTEST');
    setEnv('COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST', 'H01');
    const { evaluateCommercialReadiness, gateStatus } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness(input(true));
    const gate = result.gates.find((g) => g.key === 'externalPenetrationTest');
    expect(gate).toEqual({
      key: 'externalPenetrationTest',
      label: 'external penetration test',
      satisfied: true,
      deferral: { status: 'deferred', registerId: 'H01', label: 'Deferred by Owner (H01)' },
    });
    expect(gate && gateStatus(gate)).toEqual({ label: 'Deferred by Owner (H01)', tone: 'warning' });
    // The only gate still failing is the one no deferral can touch.
    expect(result.gates.filter((g) => !g.satisfied).map((g) => g.key)).toEqual([
      'realKeyManagement',
    ]);
  });

  it.each(['h01', ' H01', 'H01 ', 'H02', 'true', 'yes'])(
    'ignores the penetration test deferral %j and says it is not deferred',
    async (value) => {
      setEnv('COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST', value);
      const gate = await gateOf('externalPenetrationTest');
      expect(gate).toEqual({
        key: 'externalPenetrationTest',
        label: 'external penetration test',
        satisfied: false,
        deferral: {
          status: 'not_deferred',
          reason: 'register_id_mismatch',
          label: 'Deferral Not Accepted',
        },
      });
    },
  );

  it('gives every gate one status word and colour', async () => {
    const { gateStatus } = await import('./commercial-readiness');
    expect(gateStatus({ key: 'a', label: 'a', satisfied: true })).toEqual({
      label: 'satisfied',
      tone: 'success',
    });
    expect(gateStatus({ key: 'a', label: 'a', satisfied: false })).toEqual({
      label: 'unmet',
      tone: 'danger',
    });
  });

  it('needs no deferral once the penetration test is genuinely attested', async () => {
    setEnv('COMMERCIAL_READINESS_ATTEST_EXTERNAL_PENTEST', 'true');
    setEnv('COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST', 'H01');
    expect(await gateOf('externalPenetrationTest')).toEqual({
      key: 'externalPenetrationTest',
      label: 'external penetration test',
      satisfied: true,
    });
  });

  it('names every safety gate in the gate lists, so none can drop out of this guard by a rename', async () => {
    const keys = new Set((await everyGate(true)).map((g) => g.key));
    for (const key of SAFETY_GATES) expect(keys.has(key)).toBe(true);
  });

  it('can never defer any gate outside the allowlist, whatever value is set: every gate, current and future', async () => {
    const { DEFERRABLE_GATES } = await import('./commercial-readiness');
    for (const databaseReady of [false, true]) {
      const baseline = await everyGate(databaseReady);
      const keys = [...new Set(baseline.map((g) => g.key))].filter(
        (key) => !DEFERRABLE_GATES.has(key),
      );
      expect(keys.length).toBeGreaterThan(19);
      for (const value of ['H01', 'H20', 'true', ...keys]) {
        for (const key of keys) setEnv(deferEnv(key), value);
        const deferred = await everyGate(databaseReady);
        for (const key of keys) unsetEnv(deferEnv(key));
        expect(deferred.map((g) => [g.key, g.satisfied])).toEqual(
          baseline.map((g) => [g.key, g.satisfied]),
        );
        for (const gate of deferred.filter((g) => !DEFERRABLE_GATES.has(g.key))) {
          expect(gate.deferral).toEqual({
            status: 'not_deferred',
            reason: 'gate_not_deferrable',
            label: 'Deferral Not Accepted',
          });
        }
      }
    }
  });
});

describe('attestations the owner may set', () => {
  const ROOT = join(process.cwd(), '..', '..');

  it('lists every attestation the gates read, exactly once, each feeding its own gate', async () => {
    const { COMMERCIAL_READINESS_ATTESTATIONS } = await import('./commercial-readiness');
    const listed = COMMERCIAL_READINESS_ATTESTATIONS.map((a) => a.env);
    expect(listed).toEqual(ATTEST_FLAGS.map((flag) => `COMMERCIAL_READINESS_ATTEST_${flag}`));
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(COMMERCIAL_READINESS_ATTESTATIONS.map((a) => a.gateKey)).size).toBe(
      listed.length,
    );

    setEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
    setEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(40));
    for (const attestation of COMMERCIAL_READINESS_ATTESTATIONS) {
      expect((await gateOf(attestation.gateKey))?.satisfied).toBe(false);
      setEnv(attestation.env, 'yes');
      expect((await gateOf(attestation.gateKey))?.satisfied).toBe(false);
      setEnv(attestation.env, 'true');
      expect((await gateOf(attestation.gateKey))?.satisfied).toBe(true);
      unsetEnv(attestation.env);
    }
  });

  it('gives each one an evidence document that exists in the repository', async () => {
    const { COMMERCIAL_READINESS_ATTESTATIONS } = await import('./commercial-readiness');
    for (const attestation of COMMERCIAL_READINESS_ATTESTATIONS) {
      expect(attestation.evidence).toMatch(/^docs\/[a-z0-9/.-]+\.md$/i);
      expect(existsSync(join(ROOT, attestation.evidence))).toBe(true);
      expect(attestation.claim.length).toBeGreaterThan(10);
    }
  });

  it('matches the evidence table the owner and the S24 report read', async () => {
    const { COMMERCIAL_READINESS_ATTESTATIONS } = await import('./commercial-readiness');
    const doc = readFileSync(
      join(ROOT, 'docs/operations/pilot-to-commercial-activation.md'),
      'utf8',
    );
    const section = doc.slice(doc.indexOf('### Attestation evidence'));
    const rows = [
      ...section.matchAll(
        /^\| `(COMMERCIAL_READINESS_ATTEST_[A-Z0-9_]+)` \| (\w+) \| `([^`]+)` \|$/gm,
      ),
    ].map(([, env, gateKey, evidence]) => ({ env, gateKey, evidence }));
    expect(rows).toEqual(
      COMMERCIAL_READINESS_ATTESTATIONS.map(({ env, gateKey, evidence }) => ({
        env,
        gateKey,
        evidence,
      })),
    );
  });
});

describe('readiness output never shows a secret value', () => {
  const MARK = 'S27SECRETMARK';

  it('keeps every configured value, and every deferral value, out of the result', async () => {
    satisfyEveryGate();
    setEnv('NEON_AUTH_COOKIE_SECRET', `${MARK}-cookie-${'x'.repeat(40)}`);
    setEnv('BLOB_READ_WRITE_TOKEN', `vercel_blob_rw_${MARK}`);
    setEnv('STEP_UP_SIGNING_SECRET', `${MARK}-step-up`);
    setEnv('RESEND_API_KEY', `re_${MARK}`);
    setEnv('OPENAI_API_KEY', `sk-${MARK}`);
    setEnv('GITHUB_INTAKE_DISPATCH_TOKEN', `ghp_${MARK}`);
    setEnv('CLAMAV_SOCKET_PATH', `/run/${MARK}.ctl`);
    setEnv('COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST', `sk-${MARK}-pasted`);
    setEnv('COMMERCIAL_READINESS_DEFER_REAL_KEY_MANAGEMENT', `sk-${MARK}-pasted`);
    const { evaluateCommercialReadiness, evaluateOperationalReadiness } = await import(
      './commercial-readiness'
    );
    const output = JSON.stringify([
      evaluateCommercialReadiness(input(true, { scannerEvidenceFresh: true })),
      evaluateOperationalReadiness(input(true)),
    ]);
    expect(output).not.toContain(MARK);
    expect(output).toContain('Deferral Not Accepted');
  });
});

describe('the synchronous configuration checks', () => {
  afterEach(() => {
    vi.doUnmock('./readiness-signals');
    vi.doUnmock('./kms-self-test');
    vi.resetModules();
  });

  it('commercialConfigurationReady is false by default', async () => {
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(commercialConfigurationReady()).toBe(false);
  });

  it('stays false when every other gate is satisfied but the malware scanner is not yet configured', async () => {
    satisfyEveryGateExceptMalwareScanner();
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(commercialConfigurationReady()).toBe(false);
  });

  it('never consults live DB connectivity (it has none to consult)', async () => {
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(() => commercialConfigurationReady()).not.toThrow();
  });

  it('reads the remembered database facts: unknown fails closed, a recent read can pass', async () => {
    satisfyEveryGate();
    setEnv('KMS_PROVIDER', 'aws_kms');
    setEnv('KMS_KEY_ID', 'alias/visastack');
    setEnv('KMS_AWS_REGION', 'us-east-1');
    const remembered = { value: null as ReadinessSignals | null };
    vi.resetModules();
    vi.doMock('./kms-self-test', () => ({ kmsSelfTestPassed: () => true }));
    vi.doMock('./readiness-signals', () => ({
      rememberedReadinessSignals: () =>
        remembered.value ?? { aiProvider: { kind: 'unknown' }, scannerEvidenceFresh: false },
    }));
    const { commercialConfigurationReady, operationalConfigurationReady } = await import(
      './commercial-readiness'
    );
    expect(commercialConfigurationReady()).toBe(false);
    expect(operationalConfigurationReady()).toBe(false);
    remembered.value = { aiProvider: { kind: 'no_configuration' }, scannerEvidenceFresh: false };
    expect(commercialConfigurationReady()).toBe(true);
    expect(operationalConfigurationReady()).toBe(true);
    remembered.value = {
      aiProvider: {
        kind: 'active',
        primary: { hasKey: true, termsRecorded: false },
        fallback: null,
      },
      scannerEvidenceFresh: false,
    };
    expect(commercialConfigurationReady()).toBe(false);
    expect(operationalConfigurationReady()).toBe(false);
  }, 15_000);
});

it('evaluates real-record safeguards without requiring payment, commercial hosting certification or a production sign-in attestation', async () => {
  const { evaluateOperationalReadiness } = await import('./commercial-readiness');
  const result = evaluateOperationalReadiness(input(false));
  const keys = result.gates.map((gate) => gate.key);
  expect(keys).toEqual([
    'authentication',
    'productionDatabase',
    'privateProductionStorage',
    'realMalwareScanner',
    'realKeyManagement',
    'safeConversion',
    'stepUp',
    'externalObjectDeletionVerification',
    'tenantIsolationSuite',
    'permissionMatrix',
    'productionAiProvider',
    'privacyConsentConfiguration',
    'retentionDeletionWorkflow',
    'backupRestoreVerification',
    'authenticatedProductionE2e',
    'incidentOwner',
    'termsAndPrivacyNotice',
    'noCriticalHighFindings',
  ]);
  expect(result.ready).toBe(false);
  expect(result.gates.find((gate) => gate.key === 'productionDatabase')?.satisfied).toBe(false);
  expect(result.gates.find((gate) => gate.key === 'realKeyManagement')?.satisfied).toBe(false);
}, 15_000);
