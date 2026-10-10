import 'server-only';
import { createAiExtractor } from './ai';
import { isPresent, isSignInConfigured, isWorkosConfigured, readEnv } from './env';

/**
 * The commercial readiness guard (master directive §7 "PR 11"): every named
 * gate commercial mode must pass before it may serve real applicants.
 * "No normal administrator may override this guard" — there is deliberately
 * no escape hatch here; a gate is satisfied only by the condition it names
 * actually being true, never by a convenience flag that bypasses the check
 * itself.
 *
 * Two kinds of gate:
 *  - LIVE: computed from real, current signals (env presence, configured
 *    adapters). Re-evaluated on every call.
 *  - ATTESTATION: an operational fact no server-side check can verify by
 *    itself (an external pentest happened; a named human owns incidents; a
 *    backup restore was actually rehearsed and verified). Each requires an
 *    explicit `COMMERCIAL_READINESS_ATTEST_*=true` env var — deliberately
 *    inert by default (unset = not attested = gate fails), so commercial
 *    mode can never silently inherit readiness nobody actually confirmed.
 *
 * `realMalwareScanner` is a LIVE gate (Commercial V1 SEC-05/EVI-02): it
 * checks the exact same `MALWARE_SCANNER_PROVIDER`/`CLAMAV_*` env vars
 * `./providers.ts`'s `createMalwareScanner` reads, so this gate and the
 * scanner actually constructed at runtime can never disagree. Before a real
 * scanner adapter existed, this was hardcoded `false`. `BasicSafetyScanner`
 * (`packages/adapters/src/scanner.ts`) is a structural/magic-byte validator,
 * not antivirus (ADR-0011), and remains the default when no real scanner is
 * configured. Like `privateProductionStorage` above, this checks
 * configuration presence, not live connectivity to clamd on every call;
 * an unreachable daemon fails individual scans (fail closed, see
 * `clamav-scanner.ts`), not this readiness gate.
 * `safeConversion` and `retentionDeletionWorkflow` are hardcoded
 * `true` because the underlying work (PR 3's bounded, hostile-tested
 * document conversion; PR 4's retention/erasure workflow) is genuinely
 * complete, not aspirational.
 */

export interface ReadinessGate {
  readonly key: string;
  readonly label: string;
  readonly satisfied: boolean;
}

export interface CommercialReadinessInput {
  /**
   * Live DB connectivity + migration state. The one gate this module cannot
   * check itself without an async round trip — supplied by the caller
   * (`/api/health/ready`, which already performs that check for its own
   * pilot-level `coreReady` decision) rather than duplicated here.
   */
  readonly databaseReady: boolean;
}

export interface CommercialReadinessResult {
  readonly ready: boolean;
  readonly gates: readonly ReadinessGate[];
}

function attested(flag: string): boolean {
  return readEnv(`COMMERCIAL_READINESS_ATTEST_${flag}`) === 'true';
}

/** AI is an optional pilot feature — this gate only applies when AI_ENABLED=true (master directive §5). */
function productionOpenAiProjectReady(): boolean {
  if (readEnv('AI_ENABLED') !== 'true') return true;
  return createAiExtractor() !== undefined && isPresent('OPENAI_PROJECT_ID');
}

function buildGates(input: CommercialReadinessInput): readonly ReadinessGate[] {
  return [
    {
      key: 'hosting',
      label: 'commercial-compatible hosting',
      satisfied: readEnv('VERCEL_ENV') === 'production',
    },
    {
      key: 'workosProduction',
      label: 'WorkOS production',
      // isWorkosConfigured() only proves SOME WorkOS project is wired up —
      // it cannot distinguish a production project from the pilot's staging
      // one from env var presence alone, so genuine production use is an
      // explicit attestation on top.
      satisfied: isWorkosConfigured() && attested('WORKOS_PRODUCTION'),
    },
    {
      key: 'productionDatabase',
      label: 'production database',
      satisfied: input.databaseReady,
    },
    {
      key: 'privateProductionStorage',
      label: 'private production storage',
      satisfied:
        readEnv('STORAGE_PROVIDER') === 'r2'
          ? ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT_URL'].every(isPresent)
          : isPresent('BLOB_READ_WRITE_TOKEN'),
    },
    {
      key: 'realMalwareScanner',
      label: 'real malware scanner',
      satisfied:
        readEnv('MALWARE_SCANNER_PROVIDER') === 'clamav' &&
        (isPresent('CLAMAV_SOCKET_PATH') || (isPresent('CLAMAV_HOST') && isPresent('CLAMAV_PORT'))),
    },
    {
      key: 'realEmailProvider',
      label: 'real email provider',
      // Matches the exact env vars `./providers.ts`'s `createEmailPort` reads
      // (EMAIL_PROVIDER=resend, RESEND_API_KEY, RESEND_FROM_ADDRESS) -- same
      // "gate and constructed adapter can never disagree" pairing as
      // `realMalwareScanner` above. NullEmailPort itself refuses to
      // construct at all once DEPLOYMENT_MODE=commercial (its own
      // `assertNotCommercialMode` guard, packages/adapters/src/email.ts);
      // this gate is what stops commercial mode from ever reporting READY
      // while still silently defaulted to it.
      satisfied:
        readEnv('EMAIL_PROVIDER') === 'resend' &&
        isPresent('RESEND_API_KEY') &&
        isPresent('RESEND_FROM_ADDRESS'),
    },
    {
      key: 'realKeyManagement',
      label: 'real key management (KMS)',
      // LocalEnvelopeKeyProvider (KMS_PROVIDER=local, the only
      // implementation today, ./providers.ts's createKeyManagementPort) is
      // explicitly NOT a real KMS (packages/adapters/src/key-management.ts's
      // own doc comment) and refuses to construct at all once
      // DEPLOYMENT_MODE=commercial. Hardcoded false, same pattern
      // `realMalwareScanner` used before ClamAvScanner existed, until a
      // genuine KMS vendor adapter (e.g. AWS KMS, GCP Cloud KMS) is
      // registered in ./providers.ts and this gate checks for it
      // specifically.
      satisfied: false,
    },
    {
      key: 'safeConversion',
      label: 'safe conversion',
      satisfied: true,
    },
    {
      key: 'stepUp',
      label: 'step-up',
      satisfied: isPresent('STEP_UP_SIGNING_SECRET'),
    },
    {
      key: 'externalObjectDeletionVerification',
      label: 'external-object deletion verification',
      satisfied: attested('EXTERNAL_DELETION_VERIFIED'),
    },
    {
      key: 'tenantIsolationSuite',
      label: 'tenant-isolation suite',
      satisfied: attested('TENANT_ISOLATION_SUITE'),
    },
    {
      key: 'permissionMatrix',
      label: 'permission matrix',
      satisfied: attested('PERMISSION_MATRIX'),
    },
    {
      key: 'productionOpenAiProject',
      label: 'production OpenAI project where AI is enabled',
      satisfied: productionOpenAiProjectReady(),
    },
    {
      key: 'privacyConsentConfiguration',
      label: 'privacy/consent configuration',
      satisfied: attested('PRIVACY_CONSENT_CONFIG'),
    },
    {
      key: 'retentionDeletionWorkflow',
      label: 'retention/deletion workflow',
      satisfied: true,
    },
    {
      key: 'backupRestoreVerification',
      label: 'backup restore verification',
      satisfied: attested('BACKUP_RESTORE_VERIFIED'),
    },
    {
      key: 'authenticatedProductionE2e',
      label: 'authenticated production E2E',
      satisfied: attested('PRODUCTION_E2E'),
    },
    {
      key: 'incidentOwner',
      label: 'incident owner',
      satisfied: attested('INCIDENT_OWNER'),
    },
    {
      key: 'termsAndPrivacyNotice',
      label: 'terms and privacy notice',
      satisfied: attested('TERMS_AND_PRIVACY_NOTICE'),
    },
    {
      key: 'noCriticalHighFindings',
      label: 'no Critical/High findings',
      satisfied: attested('NO_CRITICAL_HIGH_FINDINGS'),
    },
    {
      key: 'externalPenetrationTest',
      label: 'external penetration test',
      satisfied: attested('EXTERNAL_PENTEST'),
    },
  ];
}

/** The full guard — every gate, including live DB connectivity. This is what `/api/health/ready` evaluates. */
export function evaluateCommercialReadiness(
  input: CommercialReadinessInput,
): CommercialReadinessResult {
  const gates = buildGates(input);
  return { ready: gates.every((gate) => gate.satisfied), gates };
}

/**
 * The configuration-only subset — every gate except live DB connectivity,
 * which a deliberately synchronous, I/O-free check cannot perform (see
 * capabilities.ts's own doc comment on why it stays synchronous). Used to
 * decide whether `publicSignup`/`realApplicantData`/`commercialClaims` may
 * report 'available' from the general-purpose capability registry used
 * throughout the app.
 *
 * This is NOT the authoritative readiness decision — `/api/health/ready`
 * (via `evaluateCommercialReadiness`, which also checks live DB state) is,
 * and it force-disables those same three capabilities in its own response
 * whenever the full guard fails, regardless of what this function reports.
 * In practice the two cannot currently diverge in the unsafe direction: the
 * hardcoded `realKeyManagement` gate alone keeps this `false` until a real
 * KMS vendor adapter exists.
 */
export function commercialConfigurationReady(): boolean {
  return buildGates({ databaseReady: true })
    .filter((gate) => gate.key !== 'productionDatabase')
    .every((gate) => gate.satisfied);
}

/** Safety for real records is independent of charging and commercial certification. */
export function evaluateOperationalReadiness(
  input: CommercialReadinessInput,
): CommercialReadinessResult {
  const applicable = new Set([
    'productionDatabase',
    'privateProductionStorage',
    'realMalwareScanner',
    'realKeyManagement',
    'safeConversion',
    'stepUp',
    'externalObjectDeletionVerification',
    'tenantIsolationSuite',
    'permissionMatrix',
    'privacyConsentConfiguration',
    'retentionDeletionWorkflow',
    'backupRestoreVerification',
    'authenticatedProductionE2e',
    'productionOpenAiProject',
    'incidentOwner',
    'termsAndPrivacyNotice',
    'noCriticalHighFindings',
  ]);
  const gates = [
    {
      key: 'authentication',
      label: 'configured identity provider',
      satisfied: isSignInConfigured(),
    },
    ...buildGates(input).filter((gate) => applicable.has(gate.key)),
  ];
  return { ready: gates.every((gate) => gate.satisfied), gates };
}

export function operationalConfigurationReady(): boolean {
  return evaluateOperationalReadiness({ databaseReady: true }).ready;
}
