import 'server-only';
import {
  type CapabilityState,
  PLATFORM_CAPABILITY_KEYS,
  type PlatformCapabilities,
} from '@visastack/core';
import { type Db, loadScannerEvidence } from '@visastack/services';
import { isEnvAiExtractionConfigured, resolveAiExtractionAvailability } from './ai';
import { aiConnectorEnabled } from './ai-connector';
import {
  commercialConfigurationReady,
  operationalConfigurationReady,
} from './commercial-readiness';
import { getDeploymentMode } from './deployment-mode';
import { isClamAvConfigured, isPresent, isSignInConfigured, readEnv } from './env';
import { runKmsSelfTest } from './kms-self-test';
import { createKeyManagementPort, isPaymentProviderConfigured } from './providers';
import { isPublicBetaOpen } from './public-beta';
import { reportCapabilityLookupFailure } from './server-error';

export { isPresent, isSignInConfigured } from './env';

/**
 * Capabilities gated `disabled` in controlled pilot pending a specific,
 * tracked dependency — not because the underlying feature is unimplemented.
 *
 * `agencyCollaboration`'s PR 1 gap (addNote/assignMember/requestEvidence/
 * setMembershipActive — see
 * docs/audits/commercial-readiness-recovery-baseline.md §7) was repaired and
 * covered by the hostile-authorization suite in PR 2 (see
 * packages/services/src/agency.test.ts /
 * packages/services/src/organizations.test.ts); it is no longer gated here.
 *
 * `bulkExport`'s PR 5 gap (EXPORT_PROFILE is a step-up action, and no real
 * step-up mechanism existed anywhere in the app) is closed:
 * `apps/web/src/lib/step-up.ts` checks genuine Neon Auth session recency
 * server-side and forces a real password re-check when it's stale, never a
 * client-supplied boolean. The export route
 * (`app/agency/[orgId]/export/route.ts`) threads a genuinely-earned
 * `stepUpSatisfied` through. It is no longer gated here.
 *
 * Remove an entry here only once its blocking dependency has actually
 * landed and this comment is updated to say so.
 */
const KNOWN_SECURITY_GAPS: ReadonlySet<keyof PlatformCapabilities> = new Set([]);

function gapAware(state: CapabilityState, key: keyof PlatformCapabilities): CapabilityState {
  return KNOWN_SECURITY_GAPS.has(key) ? 'disabled' : state;
}

/**
 * Server-authoritative platform capability registry (master recovery
 * directive §7 "PR 1" / §3-4). Every UI surface and every gated server
 * action/route reads this (or the one field it needs) — the client never
 * decides whether a capability is active.
 *
 * Deliberately synchronous and free of I/O: capability state here is about
 * configuration and code maturity, not live infrastructure health (that's
 * `/api/health/ready`'s separate, complementary concern — a real DB round
 * trip). Recomputed per call rather than cached, so a mid-lifetime env
 * change (unlikely on Vercel, common in tests) is always reflected.
 */
export function getPlatformCapabilities(): PlatformCapabilities {
  const mode = getDeploymentMode();
  const isDev = mode === 'development';
  const isCommercial = mode === 'commercial';

  // Local dev/tests/PR previews run without any blob token by design
  // (NeonBlobStorage fallback); a real deployment without one is a genuine
  // misconfiguration that `createStorage()` already fails closed on
  // (apps/web/src/lib/storage.ts) — the registry should say so honestly
  // rather than claim upload/preview are "available" when they'd throw.
  const blobConfigured = isDev || isPresent('BLOB_READ_WRITE_TOKEN');
  // The environment-only view; the database-managed AI settings can change
  // it, so anything that reports AI to a person reads
  // `resolvePlatformCapabilities` instead (see below).
  const aiConfigured = isEnvAiExtractionConfigured();
  // The one shared ClamAV check (env.ts `isClamAvConfigured`), also used by
  // providers.ts's `createMalwareScanner` and the readiness gate. The private
  // scan runner (`github_clamav`) needs its recent proof from the database:
  // `resolveMalwareScanning` below adds it.
  const clamAvConfigured = isClamAvConfigured();

  return {
    authentication: isSignInConfigured() ? 'available' : 'unconfigured',
    manualProfile: 'available',
    documentUpload: blobConfigured ? 'available' : 'unconfigured',
    deterministicExtraction: 'available',
    aiExtraction: aiConfigured ? 'available' : 'unconfigured',
    structuralValidation: 'available',
    // Real antivirus (ClamAV, SEC-05/EVI-02), distinct from
    // structuralValidation above (ADR-0011's magic-byte checks, never
    // sufficient alone), 'available' only once MALWARE_SCANNER_PROVIDER
    // and its connection env vars are genuinely configured, never assumed.
    malwareScanning: clamAvConfigured ? 'available' : 'unconfigured',
    // Real safe-preview rendering now exists (EVI-02/EVI-06:
    // `BuiltinPreviewRenderer`, wired into `/api/blob/[key]`); every
    // preview, owner or third party, is the rendered `redacted` derivative;
    // neither ever reaches the stored original (`documents.ts`'s
    // `accessDocument`). Both gate on the same blob-storage-configured
    // condition; the policy engine, not this registry, decides WHO may
    // preview a given document.
    ownerPreview: gapAware(blobConfigured ? 'available' : 'unconfigured', 'ownerPreview'),
    thirdPartyPreview: gapAware(blobConfigured ? 'available' : 'unconfigured', 'thirdPartyPreview'),
    // Originals use the owner action, fresh authentication, policy checks and
    // revocable signed delivery. Redacted downloads remain disabled until actual
    // protected-content redaction is implemented and verified.
    originalDownload:
      blobConfigured && isPresent('BLOB_SIGNING_SECRET') && isPresent('STEP_UP_SIGNING_SECRET')
        ? gapAware('available', 'originalDownload')
        : 'unconfigured',
    redactedDownload: 'disabled',
    sharing: gapAware('available', 'sharing'),
    agencyCollaboration: gapAware('available', 'agencyCollaboration'),
    bulkExport: gapAware('available', 'bulkExport'),
    missionWorkspace: 'available',
    packGeneration: 'available',
    // The commercial readiness guard (master directive §7 "PR 11") gates
    // these three, not deployment mode alone — DEPLOYMENT_MODE=commercial by
    // itself must never be enough to serve real applicants or make public
    // claims. See commercial-readiness.ts; `/api/health/ready` is the
    // authoritative, live-checked enforcement point for this same guard.
    publicSignup:
      (isCommercial && commercialConfigurationReady()) || isPublicBetaOpen()
        ? 'available'
        : 'disabled',
    // Available only when a payment provider is chosen AND fully configured (ADR 0020); the
    // default, with nothing set, stays unconfigured.
    payments: isPaymentProviderConfigured() ? 'available' : 'unconfigured',
    // The AI connector (ADR 0021 section 7): off unless AI_CONNECTOR_ENABLED is exactly "true",
    // the same switch every connector address reads. Turning it on for real people is an owner
    // decision tied to the real-data gate.
    aiConnector: aiConnectorEnabled() ? 'available' : 'disabled',
    realApplicantData: !isDev && operationalConfigurationReady() ? 'available' : 'disabled',
    commercialClaims: isCommercial && commercialConfigurationReady() ? 'available' : 'disabled',
  };
}

/** How long one live answer about AI is reused before the database is asked again. */
export const AI_CAPABILITY_TTL_MS = 60_000;

let aiCapabilityCache:
  | { readonly state: Promise<CapabilityState>; readonly expiresAt: number }
  | undefined;

/** Forget the cached AI answer (tests, and any code that has just changed AI settings). */
export function clearAiCapabilityCache(): void {
  aiCapabilityCache = undefined;
}

async function lookUpAiExtractionState(db: Db): Promise<CapabilityState> {
  return resolveAiExtractionAvailability(db, createKeyManagementPort() !== undefined);
}

/**
 * The live `aiExtraction` state: the same decision `resolveAiExtractor` makes
 * before every AI call (database-managed settings first, then the environment
 * with its `AI_ENABLED` switch), reused for `AI_CAPABILITY_TTL_MS` so a public
 * page polled by many visitors does not query the database on every request.
 * Concurrent callers share one lookup. With no database to ask, or when the
 * lookup fails, it reports `disabled` (the product cannot run AI then either)
 * and never throws; a failed lookup is not kept, so the next request asks again.
 */
export async function resolveAiExtractionCapability(
  db: Db | undefined,
  now: number = Date.now(),
): Promise<CapabilityState> {
  if (!db) return 'disabled';
  const cached = aiCapabilityCache;
  if (cached && cached.expiresAt > now) return cached.state;
  const state: Promise<CapabilityState> = lookUpAiExtractionState(db).catch((error: unknown) => {
    reportCapabilityLookupFailure('aiExtraction', error);
    if (aiCapabilityCache?.state === state) aiCapabilityCache = undefined;
    return 'disabled';
  });
  aiCapabilityCache = { state, expiresAt: now + AI_CAPABILITY_TTL_MS };
  return state;
}

/**
 * `getPlatformCapabilities` with the parts that depend on live,
 * database-managed settings filled in. Use this wherever capability state is
 * shown to a person (the readiness probe behind the public status page, the
 * admin overview); the synchronous registry stays I/O-free for gates. A
 * caller that has just read the scan runner's proof (readiness.ts) passes it
 * in, so the database is not asked twice.
 */
export async function resolvePlatformCapabilities(
  db: Db | undefined,
  known: { readonly scannerEvidenceFresh?: boolean } = {},
): Promise<PlatformCapabilities> {
  const base = getPlatformCapabilities();
  const [aiExtraction, malwareScanning] = await Promise.all([
    resolveAiExtractionCapability(db),
    resolveMalwareScanning(db, base.malwareScanning, known.scannerEvidenceFresh),
    // The key service answer feeds the synchronous gates read inside `getPlatformCapabilities`.
    readEnv('KMS_PROVIDER') === 'aws_kms' ? runKmsSelfTest() : Promise.resolve(false),
  ]);
  return { ...base, aiExtraction, malwareScanning };
}

/**
 * The scanner in the private worker (`MALWARE_SCANNER_PROVIDER=github_clamav`) cannot be pinged
 * from here, so it counts as available only while the worker's own recent verification record
 * exists (S4). Nothing readable, or no recent record, keeps it unconfigured.
 */
async function resolveMalwareScanning(
  db: Db | undefined,
  fromEnvironment: PlatformCapabilities['malwareScanning'],
  knownFresh: boolean | undefined,
): Promise<PlatformCapabilities['malwareScanning']> {
  if (fromEnvironment === 'available') return fromEnvironment;
  if (readEnv('MALWARE_SCANNER_PROVIDER') !== 'github_clamav') return fromEnvironment;
  if (knownFresh !== undefined) return knownFresh ? 'available' : fromEnvironment;
  if (!db) return fromEnvironment;
  return (await loadScannerEvidence(db)) ? 'available' : fromEnvironment;
}

/** True only when the named capability is fully, currently usable. */
export function isCapabilityAvailable(
  capabilities: PlatformCapabilities,
  key: keyof PlatformCapabilities,
): boolean {
  return capabilities[key] === 'available';
}

const UNAVAILABLE_MESSAGES: Partial<Record<keyof PlatformCapabilities, string>> = {};

/**
 * A safe, user-facing explanation for a disabled/unconfigured capability.
 * Never exposes the underlying security defect — only that the capability
 * is unavailable and, where relevant, why in general terms.
 */
export function capabilityUnavailableMessage(key: keyof PlatformCapabilities): string {
  return (
    UNAVAILABLE_MESSAGES[key] ??
    'This capability is not currently available in the controlled pilot.'
  );
}

export { PLATFORM_CAPABILITY_KEYS };
