/**
 * Canonical domain vocabularies.
 *
 * These enumerations are lifted verbatim from the Build Specification so the
 * whole system speaks one language. Each is a readonly tuple (usable at
 * runtime for validation) plus a derived union type (used at compile time).
 * Authority: Build Spec §2, §3.3, §4.3, §6, §8, §9, §11, §13.
 */

/** Build Spec §11 — authorization actions. */
export const PERMISSION_ACTIONS = [
  'VIEW_METADATA',
  'PREVIEW',
  'COMMENT',
  'PROPOSE_EDIT',
  'APPROVE_EDIT',
  'DOWNLOAD_ORIGINAL',
  'DOWNLOAD_REDACTED',
  'DOWNLOAD_PACK',
  'EXPORT_PROFILE',
  'SHARE',
  'MANAGE',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Build Spec §4.3 — mission lifecycle. */
export const MISSION_STATES = [
  'DRAFT',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'UNDER_REVIEW',
  'READY_TO_EXPORT',
  'LOCKED',
  'CLOSED',
  'CANCELLED',
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

/** Build Spec §2 — agency organization lifecycle. */
export const ORGANIZATION_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
  'CLOSED',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Build Spec §2 — agency membership roles (roles never grant resource access). */
export const MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'CASE_MANAGER', 'REVIEWER'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Build Spec §9 — fact version statuses. Generic "Verified" is forbidden. */
export const FACT_STATUSES = [
  'DECLARED',
  'EXTRACTED_PENDING',
  'APPLICANT_CONFIRMED',
  'DOCUMENT_SUPPORTED',
  'AGENCY_REVIEWED',
  'CONFLICTED',
  'STALE',
  'SUPERSEDED',
] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

/** Build Spec §8 — AI field-proposal types. */
export const PROPOSAL_TYPES = [
  'NEW',
  'MATCH',
  'UPDATE',
  'CONFLICT',
  'UNMAPPED',
  'UNCERTAIN',
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/** Build Spec §6 — document intake state machine. */
export const DOCUMENT_STATES = [
  'UPLOADING',
  'QUARANTINED',
  'SCANNING',
  'NORMALIZING',
  'EXTRACTING',
  'AWAITING_REVIEW',
  'APPROVED',
  'NEEDS_ATTENTION',
  'FAILED',
  'REJECTED',
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/** Build Spec §13 — separate consent records. */
export const CONSENT_TYPES = ['CORE_PROCESSING', 'AI_EXTRACTION', 'SHARING', 'MARKETING'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/**
 * Build Spec §4.1 — Master Profile packs. "universal" applies to every
 * applicant; "professional", "business", "medical", "medical_attendant" are
 * target-group packs. "medical" covers the traveller/patient themselves;
 * "medical_attendant" is separate (master directive §7 "PR 8") — a
 * companion accompanying them has a distinct identity and relationship to
 * track, not more fields on the patient's own record. Also the canonical
 * category vocabulary a grant's `categories` allow-list scopes against
 * (packages/services/src/sharing.ts) — one definition shared by the profile
 * registry (apps/web) and grant-scope validation (packages/services), not
 * two independently-maintained lists.
 */
export const PROFILE_PACKS = [
  'universal',
  'professional',
  'business',
  'medical',
  'medical_attendant',
] as const;
export type ProfilePack = (typeof PROFILE_PACKS)[number];
