import 'server-only';
import {
  type CapabilityState,
  PLATFORM_CAPABILITY_KEYS,
  type PlatformCapabilities,
} from '@visastack/core';
import { getDeploymentMode } from './deployment-mode';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

export function isPresent(name: string): boolean {
  const value = readEnv(name);
  return typeof value === 'string' && value.length > 0;
}

const WORKOS_ENV_VARS = ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD'] as const;

/** The one canonical definition of "is WorkOS configured to sign anyone in." */
export function isWorkosConfigured(): boolean {
  return WORKOS_ENV_VARS.every(isPresent) && isPresent('NEXT_PUBLIC_WORKOS_REDIRECT_URI');
}

/**
 * Capabilities gated `disabled` in controlled pilot pending a specific,
 * tracked repair — not because the underlying feature is unimplemented, but
 * because the Phase 0 code audit confirmed a real authorization defect.
 *
 * Evidence: docs/audits/commercial-readiness-recovery-baseline.md §7/§12.
 *   - agencyCollaboration: addNote() has no authorization check at all;
 *     assignMember()/requestEvidence() don't verify the org actually has a
 *     grant covering the mission/applicant; setMembershipActive() is a
 *     confirmed cross-tenant IDOR (updates by membership id alone, without
 *     scoping to the caller's own organization).
 *   - bulkExport: constructs a synthetic actor with a hardcoded ADMIN role
 *     and a hardcoded `stepUpSatisfied: true`, silently bypassing the
 *     policy engine's step-up gate on every call.
 *
 * Remove an entry here only once its PR 2 repair has landed, is tested by
 * the hostile-authorization suite, and this comment is updated to say so.
 */
const KNOWN_SECURITY_GAPS: ReadonlySet<keyof PlatformCapabilities> = new Set([
  'agencyCollaboration',
  'bulkExport',
]);

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

  return {
    authentication: isWorkosConfigured() ? 'available' : 'unconfigured',
    manualProfile: 'available',
    documentUpload: blobConfigured ? 'available' : 'unconfigured',
    deterministicExtraction: 'available',
    aiExtraction: aiConfigured ? 'available' : 'unconfigured',
    structuralValidation: 'available',
    // Not antivirus — structural/magic-byte validation only (ADR-0011). No
    // production malware scanner exists yet; never conflate the two.
    malwareScanning: 'disabled',
    ownerPreview: gapAware(blobConfigured ? 'available' : 'unconfigured', 'ownerPreview'),
    // No redacted rendition pipeline exists yet — fail-closed by design,
    // not a new PR 1 restriction (see current-product-baseline.md).
    thirdPartyPreview: 'disabled',
    // No step-up authentication flow exists anywhere in the app yet.
    originalDownload: 'disabled',
    redactedDownload: 'disabled',
    sharing: gapAware('available', 'sharing'),
    agencyCollaboration: gapAware('available', 'agencyCollaboration'),
    bulkExport: gapAware('available', 'bulkExport'),
    missionWorkspace: 'available',
    packGeneration: 'available',
    publicSignup: isCommercial ? 'available' : 'disabled',
    payments: 'unconfigured',
    realApplicantData: isCommercial ? 'available' : 'disabled',
    commercialClaims: isCommercial ? 'available' : 'disabled',
  };
}

/** True only when the named capability is fully, currently usable. */
export function isCapabilityAvailable(
  capabilities: PlatformCapabilities,
  key: keyof PlatformCapabilities,
): boolean {
  return capabilities[key] === 'available';
}

const UNAVAILABLE_MESSAGES: Partial<Record<keyof PlatformCapabilities, string>> = {
  agencyCollaboration:
    'Agency case collaboration (assignments, case notes, evidence requests, and membership changes) is temporarily unavailable while its authorization checks are hardened for the controlled pilot. This is a planned, tracked gap, not an outage — see /status.',
  bulkExport:
    'Bulk export is temporarily unavailable while its authorization is rebuilt for the controlled pilot. Export an individual applicant’s own data from Privacy › Export instead.',
};

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
