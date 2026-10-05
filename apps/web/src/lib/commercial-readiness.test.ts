import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The commercial readiness guard (master directive §7 "PR 11" / Commercial
 * V1 SEC-05): every named gate is either a live signal or an explicit
 * `COMMERCIAL_READINESS_ATTEST_*` flag. `realMalwareScanner` used to be
 * permanently unsatisfiable (no real scanner adapter existed); now that
 * `ClamAvScanner` exists (`packages/adapters/src/clamav-scanner.ts`), it is
 * a live signal like `privateProductionStorage`, satisfied only once
 * `MALWARE_SCANNER_PROVIDER=clamav` and a real connection are genuinely
 * configured, never by an attestation flag or by any OTHER gate being true.
 * "No normal administrator may override this guard" is the property under
 * test throughout: no single flag, and no combination of the other 19
 * gates, may substitute for a gate whose own condition isn't actually met.
 * `realKeyManagement` is the same kind of permanently-unsatisfiable LIVE
 * gate `realMalwareScanner` used to be: `LocalEnvelopeKeyProvider`
 * (KMS_PROVIDER=local, the only implementation today) is explicitly not a
 * real KMS, so no env var combination can satisfy it until a genuine KMS
 * vendor adapter is registered in providers.ts.
 */

/**
 * The Bangla review gate reads the review record in `@visastack/i18n`. The record is empty today,
 * so by default the gate is closed (the real behaviour); a test that needs every gate open says
 * the reviews are done by setting `override` to an empty list.
 */
const i18nMocks = vi.hoisted(() => ({ override: null as string[] | null }));
vi.mock('@visastack/i18n', async (importOriginal) => {
  const original = await importOriginal<typeof import('@visastack/i18n')>();
  return {
    ...original,
    banglaReviewPending: () => i18nMocks.override ?? original.banglaReviewPending(),
  };
});

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
  'MALWARE_SCANNER_PROVIDER',
  'CLAMAV_SOCKET_PATH',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'RESEND_FROM_ADDRESS',
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
  setEnv('EMAIL_PROVIDER', 'resend');
  setEnv('RESEND_API_KEY', 'x');
  setEnv('RESEND_FROM_ADDRESS', 'VisaStack <notifications@example.test>');
  for (const flag of ATTEST_FLAGS) setEnv(`COMMERCIAL_READINESS_ATTEST_${flag}`, 'true');
  i18nMocks.override = [];
}

/** Sets every gate, including a genuinely configured real malware scanner. */
function satisfyEveryGate(): void {
  satisfyEveryGateExceptMalwareScanner();
  setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
  setEnv('CLAMAV_SOCKET_PATH', '/var/run/clamav/clamd.ctl');
}

beforeEach(() => {
  i18nMocks.override = null;
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
  // The first dynamic import in this file pulls in ./ai -> @visastack/adapters'
  // OpenAI SDK transform, which is fast in isolation (~1s) but can approach
  // the 5s default under full monorepo test-suite contention (7 packages'
  // vitest processes running concurrently) — the same documented cause as
  // ai.test.ts's and step-up.test.ts's own first tests. A generous explicit
  // timeout avoids a spurious CI failure that has nothing to do with this
  // test's own correctness.
  it('is not ready when nothing is configured or attested', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness({ databaseReady: false });
    expect(result.ready).toBe(false);
    expect(result.gates.find((g) => g.key === 'realMalwareScanner')?.satisfied).toBe(false);
    expect(result.gates.find((g) => g.key === 'realKeyManagement')?.satisfied).toBe(false);
  }, 15_000);

  it('reports every gate the master directive names, none silently missing', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const keys = evaluateCommercialReadiness({ databaseReady: true }).gates.map((g) => g.key);
    expect(keys).toEqual([
      'hosting',
      'workosProduction',
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
      'productionOpenAiProject',
      'privacyConsentConfiguration',
      'retentionDeletionWorkflow',
      'backupRestoreVerification',
      'authenticatedProductionE2e',
      'incidentOwner',
      'termsAndPrivacyNotice',
      'banglaTranslationReview',
      'noCriticalHighFindings',
      'externalPenetrationTest',
    ]);
  });

  it('keeps the Bangla review gate closed while any Bangla consent, privacy or legal wording is unreviewed', async () => {
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const gate = evaluateCommercialReadiness({ databaseReady: true }).gates.find(
      (g) => g.key === 'banglaTranslationReview',
    );
    expect(gate?.satisfied).toBe(false);
  });

  it('opens the Bangla review gate only through the review record, never through an environment flag', async () => {
    // Every attestation flag set, including one named for it, still leaves the gate closed.
    for (const flag of ATTEST_FLAGS) setEnv(`COMMERCIAL_READINESS_ATTEST_${flag}`, 'true');
    setEnv('COMMERCIAL_READINESS_ATTEST_BANGLA_TRANSLATION_REVIEW', 'true');
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    try {
      expect(
        evaluateCommercialReadiness({ databaseReady: true }).gates.find(
          (g) => g.key === 'banglaTranslationReview',
        )?.satisfied,
      ).toBe(false);
      // Recording the reviews (an empty pending list) is what opens it.
      i18nMocks.override = [];
      expect(
        evaluateCommercialReadiness({ databaseReady: true }).gates.find(
          (g) => g.key === 'banglaTranslationReview',
        )?.satisfied,
      ).toBe(true);
    } finally {
      unsetEnv('COMMERCIAL_READINESS_ATTEST_BANGLA_TRANSLATION_REVIEW');
    }
  });

  it('is not ready while only the Bangla review is outstanding', async () => {
    satisfyEveryGate();
    i18nMocks.override = null;
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const failing = evaluateCommercialReadiness({ databaseReady: true })
      .gates.filter((g) => !g.satisfied)
      .map((g) => g.key);
    expect(failing).toEqual(['realKeyManagement', 'banglaTranslationReview']);
  });

  it('stays not-ready even when every other gate is satisfied, realMalwareScanner needs its own genuine configuration, not a stand-in', async () => {
    satisfyEveryGateExceptMalwareScanner();
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness({ databaseReady: true });
    const failing = result.gates.filter((g) => !g.satisfied);
    expect(failing).toEqual([
      { key: 'realMalwareScanner', label: 'real malware scanner', satisfied: false },
      {
        key: 'realKeyManagement',
        label: 'real key management (KMS)',
        satisfied: false,
      },
    ]);
    expect(result.ready).toBe(false);
  });

  it('realMalwareScanner responds to genuine configuration, but overall readiness still needs realKeyManagement, since no real KMS vendor adapter exists yet', async () => {
    satisfyEveryGate();
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness({ databaseReady: true });
    expect(result.gates.find((g) => g.key === 'realMalwareScanner')?.satisfied).toBe(true);
    const failing = result.gates.filter((g) => !g.satisfied);
    expect(failing).toEqual([
      { key: 'realKeyManagement', label: 'real key management (KMS)', satisfied: false },
    ]);
    expect(result.ready).toBe(false);
  });

  it('does not satisfy realMalwareScanner from MALWARE_SCANNER_PROVIDER=clamav alone, without a real connection configured', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'clamav');
    const { evaluateCommercialReadiness } = await import('./commercial-readiness');
    const result = evaluateCommercialReadiness({ databaseReady: true });
    expect(result.gates.find((g) => g.key === 'realMalwareScanner')?.satisfied).toBe(false);
  });

  describe('realEmailProvider', () => {
    it('is not satisfied when nothing is configured', async () => {
      const { evaluateCommercialReadiness } = await import('./commercial-readiness');
      const result = evaluateCommercialReadiness({ databaseReady: true });
      expect(result.gates.find((g) => g.key === 'realEmailProvider')?.satisfied).toBe(false);
    });

    it('is not satisfied by EMAIL_PROVIDER=resend alone, without RESEND_API_KEY/RESEND_FROM_ADDRESS', async () => {
      setEnv('EMAIL_PROVIDER', 'resend');
      const { evaluateCommercialReadiness } = await import('./commercial-readiness');
      const result = evaluateCommercialReadiness({ databaseReady: true });
      expect(result.gates.find((g) => g.key === 'realEmailProvider')?.satisfied).toBe(false);
    });

    it('is not satisfied by RESEND_API_KEY/RESEND_FROM_ADDRESS alone, without EMAIL_PROVIDER=resend', async () => {
      setEnv('RESEND_API_KEY', 'x');
      setEnv('RESEND_FROM_ADDRESS', 'VisaStack <notifications@example.test>');
      const { evaluateCommercialReadiness } = await import('./commercial-readiness');
      const result = evaluateCommercialReadiness({ databaseReady: true });
      expect(result.gates.find((g) => g.key === 'realEmailProvider')?.satisfied).toBe(false);
    });

    it('is satisfied only once EMAIL_PROVIDER=resend, RESEND_API_KEY, and RESEND_FROM_ADDRESS are all configured -- the same vars createEmailPort reads', async () => {
      setEnv('EMAIL_PROVIDER', 'resend');
      setEnv('RESEND_API_KEY', 'x');
      setEnv('RESEND_FROM_ADDRESS', 'VisaStack <notifications@example.test>');
      const { evaluateCommercialReadiness } = await import('./commercial-readiness');
      const result = evaluateCommercialReadiness({ databaseReady: true });
      expect(result.gates.find((g) => g.key === 'realEmailProvider')?.satisfied).toBe(true);
    });
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

  it('stays false when every other gate is satisfied but the malware scanner is not yet configured', async () => {
    satisfyEveryGateExceptMalwareScanner();
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(commercialConfigurationReady()).toBe(false);
  });

  it('stays false even with a genuinely configured real malware scanner, since realKeyManagement has no real KMS vendor adapter to configure yet', async () => {
    satisfyEveryGate();
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(commercialConfigurationReady()).toBe(false);
  });

  it('never consults live DB connectivity (it has none to consult)', async () => {
    const { commercialConfigurationReady } = await import('./commercial-readiness');
    expect(() => commercialConfigurationReady()).not.toThrow();
  });
});
