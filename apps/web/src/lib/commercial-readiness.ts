import 'server-only';
import { isEnvAiExtractionConfigured } from './ai';
import { isClamAvConfigured, isPresent, isSignInConfigured, readEnv } from './env';
import { isProductionSite } from './hosting';
import { kmsSelfTestPassed } from './kms-self-test';
import {
  type AiProviderReadiness,
  type ReadinessSignals,
  rememberedReadinessSignals,
} from './readiness-signals';

/**
 * The commercial readiness guard (master directive §7 "PR 11"): every named
 * gate commercial mode must pass before it may serve real applicants.
 * "No normal administrator may override this guard" — there is deliberately
 * no escape hatch here; a gate is satisfied only by the condition it names
 * actually being true, never by a convenience flag that bypasses the check
 * itself. The one exception is narrow and owner-only: a gate in
 * `DEFERRABLE_GATES` may be deferred under its named register entry (S27,
 * see `applyOwnerDeferral` below), and that allowlist holds the external
 * penetration test and the virus scanner alone.
 *
 * Two kinds of gate:
 *  - LIVE: computed from real, current signals (env presence, configured
 *    adapters, and the database facts in `./readiness-signals.ts`).
 *  - ATTESTATION: an operational fact no server-side check can verify by
 *    itself (an external pentest happened; a named human owns incidents; a
 *    backup restore was actually rehearsed and verified). Each requires an
 *    explicit `COMMERCIAL_READINESS_ATTEST_*=true` env var — deliberately
 *    inert by default (unset = not attested = gate fails), so commercial
 *    mode can never silently inherit readiness nobody actually confirmed.
 *    `COMMERCIAL_READINESS_ATTESTATIONS` lists every one with its evidence.
 *
 * `realMalwareScanner` is a LIVE gate (Commercial V1 SEC-05/EVI-02). With
 * `clamav` it uses the one shared check (`isClamAvConfigured`, env.ts) that
 * `./providers.ts`'s `createMalwareScanner` also uses, so this gate and the
 * scanner constructed at run time can never disagree; like
 * `privateProductionStorage`, that checks configuration, not live
 * connectivity to clamd on every call (an unreachable daemon fails individual
 * scans closed, see `clamav-scanner.ts`). The private scan runner
 * (`github_clamav`, S4) cannot be reached from here, so it counts only on the
 * production deployment (the only place intake dispatches to it), with its
 * dispatch token set and while its own recent verification record exists:
 * the same `loadScannerEvidence` proof the capability registry uses. With
 * that provider, the few small uploads checked synchronously (agency logos,
 * photo proofs of payment, profile photos) get the structural checker
 * (`BasicSafetyScanner`, ADR-0011, not antivirus) AND are re-encoded server
 * side, so only image data is stored; a PDF proof is refused (S27).
 * `safeConversion` and `retentionDeletionWorkflow` are hardcoded
 * `true` because the underlying work (PR 3's bounded, hostile-tested
 * document conversion; PR 4's retention/erasure workflow) is genuinely
 * complete, not aspirational.
 */

/** Present on a gate only when the owner asked to defer it. */
export type GateDeferral =
  | {
      readonly status: 'deferred';
      readonly registerId: string;
      /** "Deferred by Owner (H01)": shown on the admin page and kept in the internal report. */
      readonly label: string;
    }
  | {
      readonly status: 'not_deferred';
      /** The gate is not in `DEFERRABLE_GATES`, or the value is not its register id. */
      readonly reason: 'gate_not_deferrable' | 'register_id_mismatch';
      readonly label: string;
    };

export interface ReadinessGate {
  readonly key: string;
  readonly label: string;
  /** The condition holds, or the owner deferred this gate under its allowlisted register id. */
  readonly satisfied: boolean;
  /** Why a live gate is unmet, in plain words, when the reason is worth naming. Never a value. */
  readonly detail?: string;
  readonly deferral?: GateDeferral;
}

export interface CommercialReadinessInput {
  /**
   * Live DB connectivity + migration state. The one gate this module cannot
   * check itself without an async round trip — supplied by the caller
   * (`/api/health/ready`, which already performs that check for its own
   * pilot-level `coreReady` decision) rather than duplicated here.
   */
  readonly databaseReady: boolean;
  /** The database facts behind `productionAiProvider` and `realMalwareScanner`, read by the caller. */
  readonly signals: ReadinessSignals;
}

export interface CommercialReadinessResult {
  readonly ready: boolean;
  readonly gates: readonly ReadinessGate[];
}

export interface ReadinessAttestation {
  /** The full variable name. The only accepted value is exactly `true`. */
  readonly env: `COMMERCIAL_READINESS_ATTEST_${string}`;
  /** The gate it feeds. */
  readonly gateKey: string;
  /** What setting it claims, in plain words. */
  readonly claim: string;
  /** The repository document holding, or due to hold, the evidence. Set the value only once that evidence exists. */
  readonly evidence: string;
}

/**
 * Every attestation the owner may set (owner action O11), each with its evidence. The S24
 * acceptance report reads this list; `docs/operations/pilot-to-commercial-activation.md`
 * (section "Attestation evidence") repeats it, and a test keeps the two equal and checks
 * every evidence path exists.
 */
export const COMMERCIAL_READINESS_ATTESTATIONS = [
  {
    env: 'COMMERCIAL_READINESS_ATTEST_NEON_AUTH_PRODUCTION',
    gateKey: 'signInProduction',
    claim: 'The configured Neon Auth project is the production one, not staging.',
    evidence: 'docs/operations/current-platform.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_EXTERNAL_DELETION_VERIFIED',
    gateKey: 'externalObjectDeletionVerification',
    claim: 'Erasure was checked against the live storage provider and removed the stored files.',
    evidence: 'docs/security/erasure-and-retention-boundary.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_TENANT_ISOLATION_SUITE',
    gateKey: 'tenantIsolationSuite',
    claim: 'The tenant-isolation suite passed on the deployed commit.',
    evidence: 'docs/security/tenant-isolation-matrix.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_PERMISSION_MATRIX',
    gateKey: 'permissionMatrix',
    claim: 'The role, resource and action matrix was reviewed against the deployed commit.',
    evidence: 'docs/security/tenant-isolation-matrix.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_PRIVACY_CONSENT_CONFIG',
    gateKey: 'privacyConsentConfiguration',
    claim: 'Consent wording and settings were reviewed and are not placeholders.',
    evidence: 'docs/commercial-v1/privacy-data-map.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_BACKUP_RESTORE_VERIFIED',
    gateKey: 'backupRestoreVerification',
    claim: 'A backup was restored in an isolated drill and the result was measured.',
    evidence: 'docs/operations/database-restore-drill.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_PRODUCTION_E2E',
    gateKey: 'authenticatedProductionE2e',
    claim: 'The signed-in browser journeys passed against the deployed commercial environment.',
    evidence: 'docs/commercial-v1/part-10-journeys.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_INCIDENT_OWNER',
    gateKey: 'incidentOwner',
    claim: 'A named person owns incident response.',
    evidence: 'docs/operations/incidents/README.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_TERMS_AND_PRIVACY_NOTICE',
    gateKey: 'termsAndPrivacyNotice',
    claim: 'The published terms and privacy notice were reviewed for commercial use.',
    evidence: 'docs/legal/2026-10-26-small-commercial-v1-changes-for-counsel.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_NO_CRITICAL_HIGH_FINDINGS',
    gateKey: 'noCriticalHighFindings',
    claim: 'The latest dependency audit and security review of the deployed commit are clean.',
    evidence: 'docs/commercial-v1/part-10-security-scans.md',
  },
  {
    env: 'COMMERCIAL_READINESS_ATTEST_EXTERNAL_PENTEST',
    gateKey: 'externalPenetrationTest',
    claim:
      'An external penetration test was completed with no open Critical or High finding. Until then the owner may defer this gate under H01 instead.',
    evidence: 'docs/security/external-penetration-test.md',
  },
] as const satisfies readonly ReadinessAttestation[];

type AttestedGateKey = (typeof COMMERCIAL_READINESS_ATTESTATIONS)[number]['gateKey'];

/** The gate's own attestation, looked up in `COMMERCIAL_READINESS_ATTESTATIONS`, the single list. */
function attested(gateKey: AttestedGateKey): boolean {
  const attestation = COMMERCIAL_READINESS_ATTESTATIONS.find((a) => a.gateKey === gateKey);
  return attestation !== undefined && readEnv(attestation.env) === 'true';
}

/**
 * The only gates an owner may defer, each with the register entry
 * (docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md) that records the decision. It holds the
 * external penetration test (H01) and the virus scanner (H20, owner decision of 31 Oct 2026,
 * ADR 0024) and nothing else; a guard test pins it and proves no other gate can be deferred.
 */
export const DEFERRABLE_GATES: ReadonlyMap<string, string> = new Map([
  ['externalPenetrationTest', 'H01'],
  ['realMalwareScanner', 'H20'],
]);

/** `externalPenetrationTest` -> `COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST`. */
export function deferralEnvName(gateKey: string): string {
  return `COMMERCIAL_READINESS_DEFER_${gateKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

export const NOT_DEFERRED_LABEL = 'Deferral Not Accepted';

export function deferredByOwnerLabel(registerId: string): string {
  return `Deferred by Owner (${registerId})`;
}

/**
 * `COMMERCIAL_READINESS_DEFER_<GATE>=<register id>` (owner action O17). It counts only for
 * a gate in `DEFERRABLE_GATES` and only when the value is exactly that gate's register id;
 * anything else is ignored and reported as not deferred. The value itself is never copied
 * into the result. A gate whose own condition already holds needs no deferral.
 */
function applyOwnerDeferral(gate: ReadinessGate): ReadinessGate {
  const requested = readEnv(deferralEnvName(gate.key));
  if (requested === undefined || requested === '') return gate;
  const registerId = DEFERRABLE_GATES.get(gate.key);
  if (registerId === undefined || requested !== registerId) {
    return {
      ...gate,
      deferral: {
        status: 'not_deferred',
        reason: registerId === undefined ? 'gate_not_deferrable' : 'register_id_mismatch',
        label: NOT_DEFERRED_LABEL,
      },
    };
  }
  if (gate.satisfied) return gate;
  return {
    ...gate,
    satisfied: true,
    deferral: { status: 'deferred', registerId, label: deferredByOwnerLabel(registerId) },
  };
}

export type GateTone = 'success' | 'warning' | 'danger';

/** What the admin page and the internal report show for a gate: its status word and its colour. */
export function gateStatus(gate: ReadinessGate): {
  readonly label: string;
  readonly tone: GateTone;
} {
  if (gate.deferral?.status === 'deferred') return { label: gate.deferral.label, tone: 'warning' };
  return gate.satisfied
    ? { label: 'satisfied', tone: 'success' }
    : { label: 'unmet', tone: 'danger' };
}

interface GateCheck {
  readonly satisfied: boolean;
  readonly detail?: string;
}

function check(problems: readonly string[]): GateCheck {
  return problems.length === 0
    ? { satisfied: true }
    : { satisfied: false, detail: problems.join(' ') };
}

/**
 * Provider-neutral AI gate (S27). Satisfied when AI dispatch is off, or when the ACTIVE
 * database configuration has a usable key and recorded provider data terms, and, when its
 * fallback would really be used (switched on, and the gateway's `resolveFallbackExtractor` would
 * send documents there: it exists, is another callable provider, has an approved data policy and
 * a usable key), that fallback's terms are recorded too. A fallback the gateway would treat as
 * absent receives nothing, so it does not fail the gate. "Off" means what `ai.ts` decides before
 * every call: with configurations saved, no ACTIVE one (the kill switch); on a fresh install, the
 * environment not turning AI on. The old environment-only OpenAI path, when it would run, does
 * not satisfy the gate: it has no recorded data terms, so commercial mode needs a database
 * configuration instead. Unknown or unreadable settings (a missing table included) fail closed.
 */
function productionAiProviderCheck(state: AiProviderReadiness): GateCheck {
  switch (state.kind) {
    case 'none_active':
      return { satisfied: true };
    case 'no_configuration':
      return isEnvAiExtractionConfigured()
        ? check([
            'AI is switched on through the old environment settings, which record no data terms. Set up the provider in AI Settings and record its data terms.',
          ])
        : { satisfied: true };
    case 'active': {
      const problems: string[] = [];
      if (!state.primary.hasKey) problems.push('The active AI provider has no usable key.');
      if (!state.primary.termsRecorded) {
        problems.push('The active AI provider has no recorded data terms.');
      }
      if (state.fallback && !state.fallback.termsRecorded) {
        problems.push('The fallback AI provider has no recorded data terms.');
      }
      return check(problems);
    }
    case 'unreadable':
      return check(['AI settings could not be read.']);
    default:
      return check(['AI settings have not been checked on this server in the last few minutes.']);
  }
}

function realMalwareScannerCheck(signals: ReadinessSignals): GateCheck {
  const provider = readEnv('MALWARE_SCANNER_PROVIDER');
  if (provider === 'clamav') return { satisfied: isClamAvConfigured() };
  if (provider === 'github_clamav') {
    const problems: string[] = [];
    // Intake dispatches to the runner only from the production site (Vercel production or the
    // Render fallback, hosting.ts), the same rule github-intake.ts applies.
    if (!isProductionSite(readEnv)) {
      problems.push('The private virus scanner only runs for the production site.');
    }
    // The same token `createMalwareScanner` refuses to start without.
    if (!isPresent('GITHUB_INTAKE_DISPATCH_TOKEN')) {
      problems.push('The private virus scanner cannot be started: its start token is not set.');
    }
    if (!signals.scannerEvidenceFresh) {
      problems.push('The private virus scanner has not proved it works in the last 72 hours.');
    }
    return check(problems);
  }
  return { satisfied: false };
}

function buildGates(input: CommercialReadinessInput): readonly ReadinessGate[] {
  const gates: readonly ReadinessGate[] = [
    {
      key: 'hosting',
      label: 'commercial-compatible hosting',
      satisfied: readEnv('VERCEL_ENV') === 'production',
    },
    {
      key: 'signInProduction',
      label: 'production sign-in',
      // isSignInConfigured() only proves SOME Neon Auth project is wired up;
      // it cannot tell a production project from the staging one by presence
      // alone, so genuine production use is an explicit attestation on top.
      satisfied: isSignInConfigured() && attested('signInProduction'),
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
      ...realMalwareScannerCheck(input.signals),
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
      // LocalEnvelopeKeyProvider (KMS_PROVIDER=local) is explicitly NOT a real KMS
      // and refuses to construct at all once DEPLOYMENT_MODE=commercial. This gate
      // is satisfied only by the real key service (S26): KMS_PROVIDER=aws_kms with
      // its key id and region present AND a self-test that has just passed (a
      // throwaway key wrapped and opened with the configured credentials, see
      // ./kms-self-test.ts). The self-test answer is the latest remembered one:
      // false until a run has passed, so this gate can only fail closed.
      satisfied:
        readEnv('KMS_PROVIDER') === 'aws_kms' &&
        isPresent('KMS_KEY_ID') &&
        isPresent('KMS_AWS_REGION') &&
        // Once every data key has been moved, the local master key is removed: a database copy
        // plus that one value must not be able to open protected data.
        !isPresent('KMS_LOCAL_MASTER_KEY_BASE64') &&
        // A redirected endpoint would not be the real service.
        !isPresent('AWS_ENDPOINT_URL') &&
        !isPresent('AWS_ENDPOINT_URL_KMS') &&
        kmsSelfTestPassed(),
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
      satisfied: attested('externalObjectDeletionVerification'),
    },
    {
      key: 'tenantIsolationSuite',
      label: 'tenant-isolation suite',
      satisfied: attested('tenantIsolationSuite'),
    },
    {
      key: 'permissionMatrix',
      label: 'permission matrix',
      satisfied: attested('permissionMatrix'),
    },
    {
      key: 'productionAiProvider',
      label: 'production AI provider with recorded data terms where AI is on',
      ...productionAiProviderCheck(input.signals.aiProvider),
    },
    {
      key: 'privacyConsentConfiguration',
      label: 'privacy/consent configuration',
      satisfied: attested('privacyConsentConfiguration'),
    },
    {
      key: 'retentionDeletionWorkflow',
      label: 'retention/deletion workflow',
      satisfied: true,
    },
    {
      key: 'backupRestoreVerification',
      label: 'backup restore verification',
      satisfied: attested('backupRestoreVerification'),
    },
    {
      key: 'authenticatedProductionE2e',
      label: 'authenticated production E2E',
      satisfied: attested('authenticatedProductionE2e'),
    },
    {
      key: 'incidentOwner',
      label: 'incident owner',
      satisfied: attested('incidentOwner'),
    },
    {
      key: 'termsAndPrivacyNotice',
      label: 'terms and privacy notice',
      satisfied: attested('termsAndPrivacyNotice'),
    },
    {
      key: 'noCriticalHighFindings',
      label: 'no Critical/High findings',
      satisfied: attested('noCriticalHighFindings'),
    },
    {
      key: 'externalPenetrationTest',
      label: 'external penetration test',
      satisfied: attested('externalPenetrationTest'),
    },
  ];
  return gates.map(applyOwnerDeferral);
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
 * capabilities.ts's own doc comment on why it stays synchronous). The two
 * database-backed gates read the remembered signals (`./readiness-signals.ts`),
 * which are unknown, and so fail closed, until readiness has been evaluated
 * recently on this server. Used to decide whether
 * `publicSignup`/`realApplicantData`/`commercialClaims` may report 'available'
 * from the general-purpose capability registry used throughout the app.
 *
 * This is NOT the authoritative readiness decision — `/api/health/ready`
 * (via `evaluateCommercialReadiness`, which also checks live DB state) is,
 * and it force-disables those same three capabilities in its own response
 * whenever the full guard fails, regardless of what this function reports.
 */
export function commercialConfigurationReady(): boolean {
  return buildGates({ databaseReady: true, signals: rememberedReadinessSignals() })
    .filter((gate) => gate.key !== 'productionDatabase')
    .every((gate) => gate.satisfied);
}

/** The gates that protect real records, independent of charging and commercial certification. */
const OPERATIONAL_GATE_KEYS: ReadonlySet<string> = new Set([
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
  'productionAiProvider',
  'incidentOwner',
  'termsAndPrivacyNotice',
  'noCriticalHighFindings',
]);

/** Safety for real records is independent of charging and commercial certification. */
export function evaluateOperationalReadiness(
  input: CommercialReadinessInput,
): CommercialReadinessResult {
  const gates = [
    applyOwnerDeferral({
      key: 'authentication',
      label: 'configured identity provider',
      satisfied: isSignInConfigured(),
    }),
    ...buildGates(input).filter((gate) => OPERATIONAL_GATE_KEYS.has(gate.key)),
  ];
  return { ready: gates.every((gate) => gate.satisfied), gates };
}

export function operationalConfigurationReady(): boolean {
  return evaluateOperationalReadiness({
    databaseReady: true,
    signals: rememberedReadinessSignals(),
  }).ready;
}
