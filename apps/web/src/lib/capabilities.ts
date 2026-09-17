import 'server-only';
import {
  type CapabilityState,
  PLATFORM_CAPABILITY_KEYS,
  type PlatformCapabilities,
} from '@visastack/core';
import { commercialConfigurationReady } from './commercial-readiness';
import { getDeploymentMode } from './deployment-mode';
import { isPresent, isWorkosConfigured, readEnv } from './env';

export { isPresent, isWorkosConfigured } from './env';

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
 * WorkOS step-up mechanism existed anywhere in the app) is closed:
 * `apps/web/src/lib/step-up.ts` checks genuine WorkOS session recency
 * (`checkRecentAuth`, the real `auth_time` JWT claim) and forces a real
 * reauthentication challenge (`getSignInUrl({ maxAge })`) when it's stale —
 * never a client-supplied boolean. The export route
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
  const aiConfigured = readEnv('AI_ENABLED') === 'true' && isPresent('OPENAI_API_KEY');
  // Same condition commercial-readiness.ts's `realMalwareScanner` gate and
  // providers.ts's `createMalwareScanner` both check, so all three can never
  // disagree about whether a real scanner is actually configured.
  const clamAvConfigured =
    readEnv('MALWARE_SCANNER_PROVIDER') === 'clamav' &&
    (isPresent('CLAMAV_SOCKET_PATH') || (isPresent('CLAMAV_HOST') && isPresent('CLAMAV_PORT')));

  return {
    authentication: isWorkosConfigured() ? 'available' : 'unconfigured',
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
    // A real step-up mechanism exists now (apps/web/src/lib/step-up.ts, PR
    // 5) and the policy engine already requires it for DOWNLOAD_ORIGINAL
    // (packages/policy/src/authorize.ts's STEP_UP_ACTIONS) — step-up is no
    // longer why these are disabled. What's still missing is the UI/route
    // itself: nothing in the app calls `downloadDocument` to request an
    // original or redacted download (only preview — ownerPreview/
    // thirdPartyPreview above — is wired up). Disabled for that reason.
    originalDownload: 'disabled',
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
    publicSignup: isCommercial && commercialConfigurationReady() ? 'available' : 'disabled',
    payments: 'unconfigured',
    realApplicantData: isCommercial && commercialConfigurationReady() ? 'available' : 'disabled',
    commercialClaims: isCommercial && commercialConfigurationReady() ? 'available' : 'disabled',
  };
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
