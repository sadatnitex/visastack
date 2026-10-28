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

/**
 * Build Spec §4.3 - mission lifecycle, extended by CAS-07 (master directive
 * Part 7 §6, "Canonical case states"). Two overlapping vocabularies share
 * this one enum, kept additive per the directive's own instruction ("do not
 * convert legacy LOCKED into acknowledged/submitted"; "preserve raw legacy
 * state") - no existing mission's `state` value is ever rewritten by this
 * addition, and none of the five legacy-only values below are ever removed.
 * `MISSION_STATES` itself keeps the ORIGINAL 8 values in their original
 * order and appends the 5 new ones after, rather than interleaving them -
 * purely so the generated migration is a plain `ALTER TYPE ... ADD VALUE`
 * per new value, never a drop-and-recreate of the whole enum type.
 *
 * - LEGACY_ONLY_MISSION_STATES: the five reviewer-workflow states this
 *   product shipped with before CAS-07. Still fully legal for any mission
 *   already using them (`missions.ts`'s own `TRANSITIONS` map keeps every
 *   one of their original moves unchanged) - never assigned to a NEW
 *   mission going forward.
 * - CANONICAL_CASE_STATES: the eight states §6 actually names. DRAFT/
 *   CLOSED/CANCELLED are shared with the legacy vocabulary (same name, same
 *   meaning, one shared terminal/starting point) - the other five
 *   (INTAKE/IN_REVIEW/AWAITING_APPLICANT/SUBMISSION_READY/SUBMITTED) are
 *   new. SUBMISSION_READY specifically requires a live applicant
 *   acknowledgement (TRU-02) before `transitionMission` allows reaching it
 *   - "submission-ready" is meant to mean "acknowledged," the same
 *   principle the directive states explicitly for the legacy LOCKED bridge
 *   ("requires real acknowledgement for future submission-ready claim").
 *   SUBMITTED itself is not yet a legal `transitionMission` target for any
 *   state: the directive's own §7 requires a real, attributable submission
 *   report first ("export/download does NOT mean submitted"), and that
 *   mechanism (TRU-04) does not exist yet - added once it does, rather than
 *   exposing a transition target that could only ever fail today.
 */
export const LEGACY_ONLY_MISSION_STATES = [
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'UNDER_REVIEW',
  'READY_TO_EXPORT',
  'LOCKED',
] as const;
export const CANONICAL_CASE_STATES = [
  'DRAFT',
  'INTAKE',
  'IN_REVIEW',
  'AWAITING_APPLICANT',
  'SUBMISSION_READY',
  'SUBMITTED',
  'CLOSED',
  'CANCELLED',
] as const;
export const MISSION_STATES = [
  'DRAFT',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'UNDER_REVIEW',
  'READY_TO_EXPORT',
  'LOCKED',
  'CLOSED',
  'CANCELLED',
  'INTAKE',
  'IN_REVIEW',
  'AWAITING_APPLICANT',
  'SUBMISSION_READY',
  'SUBMITTED',
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

/**
 * Build Spec §13 / PRD SHR-04 - separate consent records. `ISSUER_CONTACT`
 * (Commercial V1 Part 4 §7): an agency contacting an external issuer (a
 * bank, a university) to verify a fact or document on the applicant's
 * behalf is its own optional purpose, independent of SHARING (which only
 * governs an agency VIEWING the applicant's existing records, never
 * authorizes reaching out to a third party about them). `AI_OCR`
 * (Commercial V1 Part 8 §9): consenting to `AI_EXTRACTION` authorizes
 * sending a document's already-extracted TEXT off-server for field
 * proposals; OCR on a scanned/image document instead sends the raw image
 * BYTES off-server so a vision-capable model can read them, a materially
 * larger disclosure than text alone. Kept as its own purpose so an
 * applicant can allow text-based extraction without also allowing their
 * original document images to leave the server, and vice versa.
 */
export const CONSENT_TYPES = [
  'CORE_PROCESSING',
  'AI_EXTRACTION',
  'AI_OCR',
  'SHARING',
  'MARKETING',
  'ISSUER_CONTACT',
] as const;
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

/**
 * The longest name a document can be given, in characters (UX-B). One value for the rename form's
 * own limit and the service that cleans and saves the name.
 */
export const MAX_DOCUMENT_NAME_LENGTH = 200;

/**
 * True for an "Other" kind of document: `OTHER` itself or one of the catalogue's `OTHER_...` kinds
 * (`OTHER_LETTER` and the like). These are the kinds that can carry the person's own name for
 * what the document is. The one rule the forms, the titles and the services share.
 */
export function isOtherDocumentType(docType: string | null | undefined): boolean {
  return typeof docType === 'string' && (docType === 'OTHER' || docType.startsWith('OTHER_'));
}
