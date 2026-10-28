/**
 * Deployment modes and the platform capability registry (master commercial
 * recovery directive §3/§4 — see docs/roadmap/commercial-recovery-completion-ux-directive.md).
 *
 * Pure vocabulary only — no env reading, no framework dependency. The
 * runtime derivation (`getDeploymentMode()`, `getPlatformCapabilities()`)
 * lives at the application edge (`apps/web/src/lib/`), consistent with
 * every other provider-facing decision in this codebase (ADR-0004).
 */

/** One codebase, three operating modes. Never a separate codebase per mode. */
export type DeploymentMode = 'development' | 'controlled_pilot' | 'commercial';

export const DEPLOYMENT_MODES: readonly DeploymentMode[] = [
  'development',
  'controlled_pilot',
  'commercial',
];

/**
 * `available` — implemented, connected, verified for the current mode.
 * `degraded` — implemented but running with a reduced-control fallback.
 * `disabled` — implemented but deliberately gated off (a known defect
 *   pending repair, or a capability this mode never permits).
 * `unconfigured` — implemented but the provider/credentials aren't present.
 */
export type CapabilityState = 'available' | 'degraded' | 'disabled' | 'unconfigured';

/**
 * Server-authoritative. The client never decides whether a capability is
 * active — every UI surface and every gated server action/route reads this
 * (or the one field it needs) at request time.
 */
export interface PlatformCapabilities {
  readonly authentication: CapabilityState;
  readonly manualProfile: CapabilityState;
  readonly documentUpload: CapabilityState;
  readonly deterministicExtraction: CapabilityState;
  readonly aiExtraction: CapabilityState;
  readonly structuralValidation: CapabilityState;
  readonly malwareScanning: CapabilityState;
  readonly ownerPreview: CapabilityState;
  readonly thirdPartyPreview: CapabilityState;
  readonly originalDownload: CapabilityState;
  readonly redactedDownload: CapabilityState;
  readonly sharing: CapabilityState;
  readonly agencyCollaboration: CapabilityState;
  readonly bulkExport: CapabilityState;
  readonly missionWorkspace: CapabilityState;
  readonly packGeneration: CapabilityState;
  readonly publicSignup: CapabilityState;
  readonly payments: CapabilityState;
  /** AI apps reading a person's chosen context (ADR 0021): `disabled` unless switched on. */
  readonly aiConnector: CapabilityState;
  readonly realApplicantData: CapabilityState;
  readonly commercialClaims: CapabilityState;
}

export const PLATFORM_CAPABILITY_KEYS: readonly (keyof PlatformCapabilities)[] = [
  'authentication',
  'manualProfile',
  'documentUpload',
  'deterministicExtraction',
  'aiExtraction',
  'structuralValidation',
  'malwareScanning',
  'ownerPreview',
  'thirdPartyPreview',
  'originalDownload',
  'redactedDownload',
  'sharing',
  'agencyCollaboration',
  'bulkExport',
  'missionWorkspace',
  'packGeneration',
  'publicSignup',
  'payments',
  'aiConnector',
  'realApplicantData',
  'commercialClaims',
];
