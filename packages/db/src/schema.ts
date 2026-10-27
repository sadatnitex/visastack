import {
  CONSENT_TYPES,
  DOCUMENT_STATES,
  FACT_STATUSES,
  MEMBERSHIP_ROLES,
  MISSION_STATES,
  ORGANIZATION_STATUSES,
  PERMISSION_ACTIONS,
  PROPOSAL_TYPES,
} from '@visastack/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Portable `bytea` column. Postgres drivers disagree on how they return binary:
 * PGlite hands back a Uint8Array/Buffer, while neon-http returns a `\x…` hex
 * string. This normalizes both to `Uint8Array` so the same code runs in tests
 * and production.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer | string }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    if (typeof value === 'string') {
      const hex = value.startsWith('\\x') ? value.slice(2) : value;
      return Uint8Array.from(Buffer.from(hex, 'hex'));
    }
    return Uint8Array.from(value);
  },
});

/**
 * Canonical schema — Foundation slice (tenancy/identity + consent + audit).
 * Authority: Build Spec §2, §13, §14, §15; docs/architecture/data-model.md.
 *
 * Neon Postgres is the only canonical writable store. All timestamps are
 * stored in UTC (`timestamptz`) and displayed in the user's locale by the
 * application layer (Build Spec §9).
 */

// --- Enums (mirror the core domain vocabularies) ----------------------------
export const organizationStatus = pgEnum('organization_status', ORGANIZATION_STATUSES);
export const membershipRole = pgEnum('membership_role', MEMBERSHIP_ROLES);
export const consentType = pgEnum('consent_type', CONSENT_TYPES);
export const permissionAction = pgEnum('permission_action', PERMISSION_ACTIONS);
export const organizationInvitationStatus = pgEnum('organization_invitation_status', [
  'PENDING',
  'ACCEPTED',
  'REVOKED',
]);
export const clientInvitationStatus = pgEnum('client_invitation_status', [
  'PENDING',
  'ACCEPTED',
  'REVOKED',
]);
// CAS-08: unlike the two invitation statuses above, there is no separate
// "accepted, standing created" state before the one action that matters --
// accepting IS submitting the named evidence -- so this collapses straight
// from PENDING to SUBMITTED. Expiry, like every other invitation in this
// codebase, is checked live against expiresAt, never a stored value.
export const contributorRequestStatus = pgEnum('contributor_request_status', [
  'PENDING',
  'SUBMITTED',
  'REVOKED',
]);
export const applicantRelationship = pgEnum('applicant_relationship', [
  'SELF',
  'FAMILY_MEMBER',
  'MINOR_GUARDIAN',
]);
export const auditResult = pgEnum('audit_result', ['ALLOWED', 'DENIED']);
export const auditMethod = pgEnum('audit_method', ['MANUAL', 'DOCUMENT', 'API', 'SYSTEM']);
export const missionState = pgEnum('mission_state', MISSION_STATES);
export const grantStatus = pgEnum('grant_status', [
  'PENDING_ACCEPTANCE',
  'ACTIVE',
  'PAUSED',
  'REVOKED',
  'EXPIRED',
]);
export const documentState = pgEnum('document_state', DOCUMENT_STATES);
export const documentSafetyStatus = pgEnum('document_safety_status', [
  'PENDING',
  'SCANNING',
  'CLEAN',
  'QUARANTINED',
  'FAILED',
]);
export const storageBucket = pgEnum('storage_bucket', ['QUARANTINE', 'CLEAN']);
export const deletionStatus = pgEnum('deletion_status', ['PENDING', 'CANCELLED', 'EXECUTED']);
export const jobStatus = pgEnum('job_status', ['PENDING', 'CLAIMED', 'DONE', 'FAILED']);
export const erasureJobReason = pgEnum('erasure_job_reason', [
  'ACCOUNT_DELETION',
  'RETENTION_PURGE',
  // WP-PH1: a profile photo that was replaced or removed. Its row is already
  // gone; the worker deletes and verifies the bytes like any other job.
  'PROFILE_PHOTO_REMOVAL',
]);
export const erasureJobStatus = pgEnum('erasure_job_status', [
  'PENDING',
  'CLAIMED',
  'DELETED',
  'VERIFIED',
  'FAILED',
  'BLOCKED_BY_HOLD',
]);
// QUALITY_ADMIN added for TRU-04 (Part 7 §9): "authorized quality users" is a
// genuinely distinct concern from COMPLIANCE_ADMIN (legal/retention/holds) --
// service-quality complaint handling and post-case feedback review, never
// legal or security authority. Appended, not inserted, preserving the
// original four values' order (CAS-07's own lesson on enum-migration safety).
export const platformRole = pgEnum('platform_role', [
  'PLATFORM_OWNER',
  'SECURITY_ADMIN',
  'COMPLIANCE_ADMIN',
  'SUPPORT_ADMIN',
  'QUALITY_ADMIN',
]);
export const processingRunStatus = pgEnum('processing_run_status', [
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);
export const extractionRunStatus = pgEnum('extraction_run_status', ['SUCCEEDED', 'FAILED']);
export const nameVersionDecision = pgEnum('name_version_decision', [
  'PENDING',
  'ACCEPTED_UNCHANGED',
  'ACCEPTED_EDITED',
  'REJECTED',
]);
// DEPRECATED means superseded by a later PUBLISHED version of the same pack
// (set automatically by `publishPackVersion`, never chosen directly) --
// content is fine, just no longer current. WITHDRAWN (Commercial V1 RUL-05)
// means pulled for cause (the source turned out wrong, unsafe, or
// inaccessible) and is always an explicit, reasoned, audited action.
export const packVersionStatus = pgEnum('pack_version_status', [
  'DRAFT',
  'APPROVED',
  'PUBLISHED',
  'DEPRECATED',
  'WITHDRAWN',
]);
export const requirementKind = pgEnum('requirement_kind', ['FIELD', 'DOCUMENT']);
export const notificationChannel = pgEnum('notification_channel', ['IN_APP', 'EMAIL']);
// NTF-02/§3's exact delivery-state vocabulary: "QUEUED; SENT/provider
// accepted; DELIVERED only if provider confirms; BOUNCED; FAILED; READ if
// legitimately observable." SENT never implies DELIVERED, and DELIVERED is
// never inferred, only set by an actual provider confirmation (a webhook).
export const notificationDeliveryStatus = pgEnum('notification_delivery_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'FAILED',
  'READ',
  // Added for Part 5 §4 ("Cancellation/replacement/revocation invalidates
  // obsolete notices") and A17 ("stale scheduled messages cancelled") --
  // distinct from the directive's six-state delivery vocabulary above (which
  // stays untouched), this is a genuine, separately-required terminal
  // outcome: a QUEUED row whose underlying resource was cancelled/replaced/
  // revoked before it ever sent, never delivered nor a delivery failure.
  'CANCELLED',
]);
// Commercial V1 Part 4 §10's exact state model. FULFILLED/DECLINED are
// retired (superseded by ACCEPTED/CANCELLED respectively) but kept in the
// enum, never removed: a value cannot be dropped from a Postgres enum
// without a type-swap migration, and any evidence_requests row written by
// the pre-Part-4 code may still hold one. New code never writes either.
export const evidenceRequestStatus = pgEnum('evidence_request_status', [
  'OPEN',
  'RECEIVED',
  'UNDER_REVIEW',
  'ACCEPTED',
  'NEEDS_REPLACEMENT',
  'CANCELLED',
  'FULFILLED',
  'DECLINED',
]);
// Commercial V1 Part 4 §13 ("Review") names four decision outcomes: accepted
// evidence; replacement requested; contradiction; proposed correction. The
// first two are the original two values below; CONTRADICTION and
// CORRECTION_PROPOSED are the two this codebase had previously mapped onto
// generic mechanisms (FACT_STATUSES CONFLICTED, field_proposals) rather than
// implementing as their own real, reviewer-facing outcomes.
export const evidenceRequestDecisionOutcome = pgEnum('evidence_request_decision_outcome', [
  'ACCEPTED',
  'NEEDS_REPLACEMENT',
  'CONTRADICTION',
  'CORRECTION_PROPOSED',
  'CANCELLED',
]);
// --- Mission collaboration additions (master directive §7 "PR 10") ---------
export const missionDecisionOutcome = pgEnum('mission_decision_outcome', ['ACCEPTED', 'REJECTED']);
// TRU-02 (master directive Part 7 §3): the applicant's own decision on a
// prepared file, distinct from missionDecisionOutcome above (a REVIEWER's
// decision on one piece of evidence). REJECTED/CORRECTION_REQUESTED both
// require a reason (enforced in the service layer, not here, matching this
// schema's existing convention for optional-but-conditionally-required text
// columns); ACKNOWLEDGED does not.
export const acknowledgementDecision = pgEnum('acknowledgement_decision', [
  'ACKNOWLEDGED',
  'REJECTED',
  'CORRECTION_REQUESTED',
]);
// TRU-04 (master directive Part 7 §7): how the actor reports the case
// actually reached its destination. Not exhaustive of every real-world
// channel, but the ones this product can currently ask an actor to
// attribute; OTHER covers everything else rather than blocking the record.
export const missionSubmissionChannel = pgEnum('mission_submission_channel', [
  'EMBASSY_PORTAL',
  'EMAIL',
  'IN_PERSON',
  'COURIER',
  'VISA_APPLICATION_CENTER',
  'OTHER',
]);
// TRU-04 (master directive Part 7 §8): the real-world result of a case,
// distinct from `missions.state` (a workflow position, not a legal result) --
// CANCELLED/WITHDRAWN appear on both because a case can end either way with
// or without ever reaching a formal decision. Directive's own list, verbatim.
export const missionOutcomeDecision = pgEnum('mission_outcome_decision', [
  'APPROVED',
  'REFUSED',
  'WITHDRAWN',
  'CANCELLED',
  'OTHER',
]);
// Commercial V1 Part 4 §11: "States: OPEN, IN_PROGRESS, DONE, CANCELLED."
// IN_PROGRESS added after OPEN/DONE/CANCELLED already shipped (Part 3) --
// additive only, matching this codebase's enum-migration discipline.
export const missionTaskStatus = pgEnum('mission_task_status', [
  'OPEN',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
]);
export const taskPriority = pgEnum('task_priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT']);
// Commercial V1 Part 4 §12: every note must declare a visibility explicitly.
// AGENCY_INTERNAL is the safe default for the pre-existing-row backfill
// (directive: "legacy unclassified notes: default restricted; do not expose
// until ownership/visibility resolved") -- the service layer never omits it
// on a new insert, so the DB default only ever fires for that backfill.
export const missionNoteVisibility = pgEnum('mission_note_visibility', [
  'AGENCY_INTERNAL',
  'TRAVELLER_SHARED',
]);
export const generatedOutputKind = pgEnum('generated_output_kind', ['COVER_LETTER']);
export const factStatus = pgEnum('fact_status', FACT_STATUSES);
export const fieldSensitivity = pgEnum('field_sensitivity', [
  'STANDARD',
  'SENSITIVE',
  'RESTRICTED',
]);
export const proposalType = pgEnum('proposal_type', PROPOSAL_TYPES);
// Part 8 AI-01 item 4 ("possible inconsistency flag") -- deliberately its
// own small enum, not `proposalStatus`: nothing here is ever "approved"
// (there is no value to write anywhere), only acknowledged (the reviewer
// has seen it and will act manually, outside this system) or dismissed (a
// false positive, e.g. a legitimate name-spelling variation).
export const inconsistencyFlagStatus = pgEnum('inconsistency_flag_status', [
  'PENDING',
  'ACKNOWLEDGED',
  'DISMISSED',
]);
export const proposalStatus = pgEnum('proposal_status', ['PENDING', 'APPROVED', 'REJECTED']);
// Part 8 AI-01 item 2 ("document type suggestion"): distinguishes a
// `document_classifications` row the deterministic keyword/MRZ classifier
// produced from one a human approved from an AI suggestion
// (`document_type_proposals`, below) -- never a quality signal, purely
// provenance, so a reviewer or auditor can always tell which system decided.
export const classificationSource = pgEnum('classification_source', [
  'DETERMINISTIC',
  'AI_APPROVED',
]);
// IN_FLIGHT (Part 8 §11: "5 concurrent model calls platform-wide") marks a
// call genuinely in progress -- inserted before the outbound provider call,
// resolved to SUCCEEDED/FAILED after it returns, so a platform-wide count
// of IN_FLIGHT rows is a real concurrency gate that never requires holding
// a lock for the call's own duration.
export const aiExtractionRunStatus = pgEnum('ai_extraction_run_status', [
  'IN_FLIGHT',
  'SUCCEEDED',
  'FAILED',
]);

export const ocrRunStatus = pgEnum('ocr_run_status', ['IN_FLIGHT', 'SUCCEEDED', 'FAILED']);

// --- Shared timestamp columns ----------------------------------------------
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// --- Accounts (WorkOS-backed login) ----------------------------------------
// Identity is keyed by the immutable WorkOS user id (`workosUserId`), not the
// mutable email. The column is nullable + unique during the staged migration:
// legacy rows are bound on next sign-in (one-time, verified-email claim), then a
// later migration makes it NOT NULL. Email is mutable contact data.
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workosUserId: text('workos_user_id').unique(),
  // Neon Auth user id (the sign-in system that replaces WorkOS). Same discipline as the WorkOS id:
  // immutable, unique, bound only from a verified email, never from client input.
  neonUserId: text('neon_user_id').unique(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // Inactive-account retention (Part 7 §11: "wallet original: until
  // deletion/inactive-account policy"). Touched (throttled) on every
  // authenticated request in `withSession` -- `defaultNow()` means every
  // pre-existing account gets a fresh policy window from the moment this
  // column is added, never treated as already-inactive on day one. Not
  // itself a security/session-expiry control (see session-age.ts for that);
  // this is retention-sweep bookkeeping only.
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  // Set once by `sweepInactiveAccountNotices`, cleared the moment the
  // account is next active -- so a later, separate inactivity period always
  // gets its own fresh notice rather than immediately re-triggering
  // deletion from a stale flag.
  inactivityNoticeSentAt: timestamp('inactivity_notice_sent_at', { withTimezone: true }),
  ...timestamps,
});

// --- Applicants (record owners / subjects) ---------------------------------
export const applicants = pgTable('applicants', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerAccountId: uuid('owner_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  displayName: text('display_name').notNull(),
  relationship: applicantRelationship('relationship').notNull().default('SELF'),
  // IAM-04: explicit authority to act for a FAMILY_MEMBER/MINOR_GUARDIAN
  // subject, distinct from the relationship label itself. Null for SELF
  // (no separate authority to attest to) and for any record created before
  // this column existed; never inferred from relationship alone.
  authorityConfirmedAt: timestamp('authority_confirmed_at', { withTimezone: true }),
  // NTF-04 (Part 5 §4): "Subject timezone drives date notifications. Default
  // onboarding timezone: Asia/Dhaka. Editable." An IANA name, not an offset
  // (so DST is handled by the zone itself, never computed here). Defaulted
  // rather than nullable so every date-threshold computation always has a
  // concrete zone to use, including for every applicant that existed before
  // this column did.
  timezone: text('timezone').notNull().default('Asia/Dhaka'),
  ...timestamps,
});

// --- Organizations (agencies) ----------------------------------------------
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: organizationStatus('status').notNull().default('PENDING_VERIFICATION'),
    // Commercial V1 Part 4 §13 / PRD CAS-06: an org's own optional choice to
    // require that whoever decides on an evidence-request response
    // (`decideEvidenceResponse`, agency.ts) is not the same account that
    // raised that request in the first place. Off by default, and a disabled
    // setting must never let the UI imply independent review happened when
    // it did not.
    requireDifferentReviewer: boolean('require_different_reviewer').notNull().default(false),
    // --- Commercial V1 COM-04, Part 5 §9 ("Agency branding") ---------------
    // "Allow: approved logo; agency name; one accessible accent color."
    // `name` above IS the agency name this bullet means -- no separate
    // "display name" concept exists or is invented here. `accentColor` is
    // validated for WCAG AA contrast (against white or black) at write time
    // (`branding.ts`'s `isAccessibleAccentColor`), never merely a
    // well-formed hex string -- "accessible" is the PRD's own word, not
    // decorative. The CHECK below only re-verifies the hex FORMAT
    // (belt-and-suspenders against a service-layer bug), since the
    // contrast/luminance math cannot be expressed as a simple SQL
    // constraint.
    accentColor: text('accent_color'),
    // Logo bytes live in `storageBlobs` (the generic, non-evidence-specific
    // bytes-by-key store), never `documents`/`documentVersions` -- a logo
    // has no applicant, consent, or review-state concept to hang off of.
    // Both null together (no logo set, the default) or both set together
    // (enforced below) -- there is no "logo present but type unknown" state.
    logoObjectKey: text('logo_object_key'),
    logoContentType: text('logo_content_type'),
    ...timestamps,
  },
  (table) => [
    check(
      'organizations_accent_color_format',
      sql`${table.accentColor} is null or ${table.accentColor} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    check(
      'organizations_logo_fields_together',
      sql`(${table.logoObjectKey} is null) = (${table.logoContentType} is null)`,
    ),
  ],
);

// --- Memberships (account <-> organization; roles never grant resource access)
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [unique('memberships_account_org_unique').on(table.accountId, table.organizationId)],
);

// --- Organization invitations (Commercial V1 Part 4 §5: secure member
// invitations for a recipient with no VisaStack account yet). `tokenHash` is
// the only thing ever persisted -- the raw, cryptographically random token
// exists only in memory at mint time and in the link handed to the inviter;
// looking it up is a hash comparison, never a raw-value comparison, the same
// posture already used for password-reset-style tokens elsewhere. Recipient-
// bound by `email` (checked against the accepting account's own WorkOS-
// verified email, never just "whoever holds the link"), role-bound and
// organisation-bound by their own columns, single-use via the `PENDING` ->
// `ACCEPTED`/`REVOKED` transition (a terminal status can never move again),
// and race-safe via the same compare-and-set-on-status pattern `grants`
// already uses for `acceptGrant`.
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: membershipRole('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    status: organizationInvitationStatus('status').notNull().default('PENDING'),
    invitedByAccountId: uuid('invited_by_account_id')
      .notNull()
      .references(() => accounts.id),
    acceptedByAccountId: uuid('accepted_by_account_id').references(() => accounts.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('org_invitations_org_status_idx').on(table.organizationId, table.status),
    index('org_invitations_email_status_idx').on(table.email, table.status),
  ],
);

// --- Client invitations (Commercial V1 Part 4 §6, IAM-03: an agency invites a
// traveller). Deliberately never checked against an existing account at
// creation OR keyed by email at acceptance (unlike organizationInvitations,
// which is): PRD IAM-03 explicitly forbids "claim an existing wallet" and
// "expose whether email already has VisaStack account" -- so acceptance is
// gated purely on holding the token plus being authenticated as ANY
// account, never on an email match, the only design that cannot leak
// account-existence information back to the inviting agency. The agency
// supplies only a minimal display name/contact/route/case-owner; the
// accepting traveller alone chooses which of their own applicant profiles
// (existing or newly created) the resulting grant and mission attach to.
export const clientInvitations = pgTable(
  'client_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    caseOwnerAccountId: uuid('case_owner_account_id')
      .notNull()
      .references(() => accounts.id),
    displayName: text('display_name').notNull(),
    contactDestination: text('contact_destination').notNull(),
    requestedRoute: text('requested_route'),
    tokenHash: text('token_hash').notNull().unique(),
    status: clientInvitationStatus('status').notNull().default('PENDING'),
    invitedByAccountId: uuid('invited_by_account_id')
      .notNull()
      .references(() => accounts.id),
    acceptedByAccountId: uuid('accepted_by_account_id').references(() => accounts.id),
    acceptedApplicantId: uuid('accepted_applicant_id').references(() => applicants.id),
    acceptedMissionId: uuid('accepted_mission_id').references(() => missions.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('client_invitations_org_status_idx').on(table.organizationId, table.status)],
);

// --- Consent records (separate consent per purpose) ------------------------
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  type: consentType('type').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Audit events (append-only, tamper-evident hash chain) -----------------
export const auditEvents = pgTable(
  'audit_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    eventType: text('event_type').notNull(),
    // Plain uuid, not an FK: the audit log is immutable and hash-chained, so the
    // actor identifier is retained verbatim forever. A `set null` FK would both
    // break the hash chain and be rejected by the append-only RULE on deletion.
    actorAccountId: uuid('actor_account_id'),
    actorRole: text('actor_role'),
    action: permissionAction('action'),
    result: auditResult('result'),
    method: auditMethod('method'),
    applicantId: uuid('applicant_id'),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    missionId: uuid('mission_id'),
    grantId: uuid('grant_id'),
    reason: text('reason'),
    ip: text('ip'),
    device: text('device'),
    metadata: jsonb('metadata'),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
  },
  (table) => [
    index('audit_events_occurred_at_idx').on(table.occurredAt),
    index('audit_events_applicant_idx').on(table.applicantId),
  ],
);

// --- Audit checkpoints (Commercial V1 SEC-04) -------------------------------
// A periodic, externally-signed anchor over a range of the audit_events
// chain. The append-only RULEs on audit_events (migration 0000) stop the
// application's own runtime credential from editing or deleting history, but
// they do not stop a party with full database DDL access, who could drop the
// rule, edit rows, and recreate it with nobody the wiser from inside the
// database alone. A checkpoint closes that gap by construction, not by
// promise: `signature` is an HMAC over (fromSeq, toSeq, chainHeadHash) keyed
// by a secret the database itself never holds (an environment variable in
// practice, the same posture as STEP_UP_SIGNING_SECRET) — a party who can
// only read/write/alter this database, however completely, cannot forge a
// new valid signature for a tampered chain, and cannot make an EXISTING
// checkpoint agree with a chain it no longer matches. Detecting tampering
// still requires comparing a checkpoint against the chain from a vantage
// point outside the compromised database (an export, a second read replica,
// or ultimately a real external anchor service) — this table alone does not
// make that comparison happen automatically; see
// packages/services/src/audit-checkpoints.ts for what is and is not
// implemented yet.
export const auditCheckpoints = pgTable(
  'audit_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromSeq: bigint('from_seq', { mode: 'number' }).notNull(),
    toSeq: bigint('to_seq', { mode: 'number' }).notNull(),
    chainHeadHash: text('chain_head_hash').notNull(),
    signature: text('signature').notNull(),
    signingKeyVersion: text('signing_key_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_checkpoints_to_seq_idx').on(table.toSeq),
    check('audit_checkpoints_range_valid', sql`${table.toSeq} >= ${table.fromSeq}`),
  ],
);

// --- Missions (parallel destination/purpose workspaces; Build Spec §4.3) ----
export const missions = pgTable(
  'missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    destination: text('destination'),
    purpose: text('purpose'),
    // IAM-04: an optional free-text label letting an owner (e.g. a guardian
    // account managing several of its own applicants) visually link separate
    // missions as one family trip. Purely a display/reference string, never
    // an access mechanism: every grant, note, and permission stays scoped to
    // its own mission/applicant exactly as before, and lookups by this value
    // are always scoped to the caller's own applicants, never cross-account.
    itineraryRef: text('itinerary_ref'),
    // Commercial V1 Part 4 §8 (CAS-01) case-creation fields. All nullable:
    // the same underlying mission serves both an independent traveller (who
    // may never set most of these) and an agency-managed case, and none of
    // them gate any authorization decision anywhere else in this codebase,
    // deliberately, matching the PRD's own "same underlying mission services"
    // requirement. `title`/`destination`/`purpose` above predate this and
    // already cover "traveller/subject" (via applicantId), "destination", and
    // "trip purpose"; the rest genuinely did not exist.
    jurisdiction: text('jurisdiction'), // consular post / jurisdiction context, e.g. "US Embassy Dhaka"
    serviceCategory: text('service_category'), // free text, deliberately not an enum: this product defines no fixed taxonomy
    travelStartDate: timestamp('travel_start_date', { withTimezone: true }),
    travelEndDate: timestamp('travel_end_date', { withTimezone: true }),
    targetDeadline: timestamp('target_deadline', { withTimezone: true }),
    // The org this case is primarily attributed to, distinct from
    // `assignments` (which member(s) work it) and from `grants` (which orgs
    // currently have real access): this is just the case's own "whose case is
    // this" label. Never itself a source of access; set null keeps the
    // mission, never blocks or cascades.
    ownerOrganizationId: uuid('owner_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    // "Unsupported routes operate in manual-checklist mode with the coverage
    // limitation visible on the case and export" (CAS-01): an explicit,
    // owner-asserted flag, never inferred from `packVersionId` being null
    // (which could just as easily mean "not yet configured" as "genuinely no
    // automated pack exists for this route") - the UI must be honest about
    // which one it actually is.
    manualMode: boolean('manual_mode').notNull().default(false),
    state: missionState('state').notNull().default('DRAFT'),
    // PRV-02 (Part 7 §11): "closed case: initial proposed 12m with 30d
    // notice." Set exactly once, by `transitionMission` (the only writer of
    // `state`), the moment a mission reaches either terminal state -- CLOSED
    // or CANCELLED, treated identically here since both mean "this case will
    // never be worked again" (missions.ts's own TRANSITIONS map gives both an
    // empty legal-move list; the directive names only "closed case" without
    // splitting the two). Never touched again afterward: unlike `updatedAt`,
    // which later case-detail edits (e.g. `updateMissionCaseDetails`) can
    // still bump even on a closed mission, this column exists specifically so
    // the retention clock is never accidentally reset by an unrelated write.
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // Set once by the retention-notice sweep (`case-retention.ts`) the first
    // time it processes a mission whose `closedAt` has crossed the configured
    // notice threshold. Drives the later purge sweep's own "30 days after
    // notice" clock; a compare-and-set on this being still null is what makes
    // the notice sweep idempotent against re-running on the same mission.
    retentionNoticeSentAt: timestamp('retention_notice_sent_at', { withTimezone: true }),
    // Set once by the purge sweep (`sweepCaseRetentionPurge`), 30 days after
    // `retentionNoticeSentAt`: the moment this mission's own workflow content
    // (notes, tasks, snapshots, assignments, evidence requests, etc. -- every
    // table with a `mission_id` FK declared `onDelete: 'cascade'`) was deleted
    // and the free-text/scheduling fields on this very row (title,
    // destination, purpose, itineraryRef, jurisdiction, serviceCategory, the
    // three date fields) were overwritten with a redaction placeholder. The
    // row itself, and `missionOutcomes`/`missionSubmissions`/`caseComplaints`/
    // `caseFeedback` rows still pointing at it, deliberately survive: those
    // four are historical facts (a decision outcome, a filed complaint, post-
    // case quality feedback) with their own oversight/accountability value
    // independent of whether the case workspace itself is still useful to the
    // traveller, and unlike every cascading child table their own `mission_id`
    // is NOT NULL -- fully deleting this row would force deleting them too,
    // which is not a call this codebase gets to make silently by convenience
    // of the schema's own cascade wiring. Once set, this mission is excluded
    // from all future purge sweeps (nothing left here to purge again).
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    // The published requirement pack version this mission is assembled against.
    // restrict, not cascade/set null: nothing deletes a pack version today
    // (Pack Studio is create/version-forward only), but a mission must never
    // silently lose the pack it was assembled against if that ever changes --
    // missions.ts branches heavily on this being present.
    packVersionId: uuid('pack_version_id').references(() => packVersions.id, {
      onDelete: 'restrict',
    }),
    // TRU-03 (master directive Part 7 §4): monotonically increasing, bumped
    // in the same transaction as any material mutation (selected fact/
    // document, generated output, case-detail field, or attached pack
    // version) -- never a separate, later write. The exact value is never
    // meaningful on its own, only whether it still matches what a snapshot or
    // acknowledgement (TRU-02, not yet built) captured. Starts at 1, not 0,
    // so "never yet touched" and "explicitly reset" are never confusable with
    // the same sentinel.
    materialRevision: integer('material_revision').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    // Tenant integrity anchor (migration 0090): lets a child row name a case
    // AND its applicant in one composite foreign key, so the database itself
    // refuses a row that pairs a case with a different applicant. `id` is
    // already the primary key, so this never rejects an existing row.
    unique('missions_id_applicant_unique').on(table.id, table.applicantId),
  ],
);

// --- Grants (scoped, accepted, time-bound delegations; Build Spec §4.4) -----
export const grants = pgTable(
  'grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    // Recipient is a specific account and/or an organization (at least one).
    recipientAccountId: uuid('recipient_account_id').references(() => accounts.id, {
      onDelete: 'cascade',
    }),
    recipientOrganizationId: uuid('recipient_organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    // Mission-scoped when set; applicant-wide (still category-constrained) when null.
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }),
    actions: permissionAction('actions').array().notNull(),
    categories: text('categories').array(),
    // Document allow-list (Collaboration PR / Release G) — closes the gap
    // between the policy engine's Grant.documentIds (packages/policy/src/types.ts)
    // and persistence; previously modeled in the policy layer but never
    // actually storable.
    documentIds: uuid('document_ids').array(),
    // Set only when `categories` is non-empty: the exact document ids that
    // matched those categories at creation time (PRD SHR-01, Commercial V1
    // Part 4 AD-11). A category grant authorizes documents in this snapshot
    // only, never every document matching the category live, so a document
    // uploaded after the grant is never silently absorbed; growing it is an
    // explicit owner action (`expandGrantScope`), never automatic. Null when
    // `categories` is unset (an unrestricted or explicit-documentIds-only
    // grant has no category snapshot to speak of).
    documentScopeSnapshot: uuid('document_scope_snapshot').array(),
    purpose: text('purpose').notNull(),
    status: grantStatus('status').notNull().default('PENDING_ACCEPTANCE'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull().defaultNow(),
    expiryAt: timestamp('expiry_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('grants_applicant_idx').on(table.applicantId),
    // Tenant integrity anchor for grant_case_exclusions (see missions above).
    unique('grants_id_applicant_unique').on(table.id, table.applicantId),
    // A grant must name a recipient — never an ownerless delegation.
    check(
      'grants_recipient_present',
      sql`${table.recipientAccountId} is not null or ${table.recipientOrganizationId} is not null`,
    ),
  ],
);

// Personal invitations are inert proposals until the exact authenticated recipient accepts.
export const sharingInvitations = pgTable(
  'sharing_invitations',
  {
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }),
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    invitedByAccountId: uuid('invited_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status').notNull().default('PENDING'),
    purpose: text('purpose').notNull(),
    actions: permissionAction('actions').array().notNull(),
    categories: text('categories').array(),
    documentIds: uuid('document_ids').array(),
    documentScopeSnapshot: uuid('document_scope_snapshot').array(),
    grantExpiryAt: timestamp('grant_expiry_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    stepUpSatisfied: boolean('step_up_satisfied').notNull().default(false),
    acceptedGrantId: uuid('accepted_grant_id').references(() => grants.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    index('sharing_invitations_applicant_idx').on(table.applicantId, table.status),
    check(
      'sharing_invitations_status_check',
      sql`${table.status} in ('PENDING', 'ACCEPTED', 'REVOKED')`,
    ),
    // Tenant integrity anchor for grant_case_exclusions (see missions above).
    unique('sharing_invitations_id_applicant_unique').on(table.id, table.applicantId),
  ],
);

// --- Per-case sharing exceptions (ADR 0017, migration 0090) ----------------
// One row says "this all-cases grant (or pending all-cases invitation) does
// NOT cover this one case". It is the owner's "no" when a new case is made,
// and it binds everywhere the grant is checked: the policy engine
// (`excludedMissionIds`) and the SQL list queries (`grantCoversCaseSql`), both
// in packages/services/src/access/grant-scope.ts. Removing an exception is a
// hard delete; the audit trail keeps the history. Exceptions on a case-scoped
// grant are meaningless and the service never writes one. Documents have no
// case, so an exception never changes which documents a grant reaches.
//
// Tenant integrity uses composite foreign keys, a pattern new in this schema:
// (grant_id, applicant_id), (sharing_invitation_id, applicant_id) and
// (mission_id, applicant_id) each reference the parent's (id, applicant_id)
// unique pair, so a row can never pair one person's grant with another
// person's case. With the default MATCH SIMPLE a composite key whose grant or
// invitation column is null is not checked, which is what the one-parent
// rule below needs. The single-column keys stay for the plain cascades.
export const grantCaseExclusions = pgTable(
  'grant_case_exclusions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id').references(() => grants.id, { onDelete: 'cascade' }),
    sharingInvitationId: uuid('sharing_invitation_id').references(() => sharingInvitations.id, {
      onDelete: 'cascade',
    }),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    createdByAccountId: uuid('created_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Exactly one parent: an accepted grant, or a pending invitation whose
    // exceptions move onto the grant it becomes.
    check(
      'grant_case_exclusions_one_parent',
      sql`(${table.grantId} is null) <> (${table.sharingInvitationId} is null)`,
    ),
    uniqueIndex('grant_case_exclusions_grant_mission_unique')
      .on(table.grantId, table.missionId)
      .where(sql`${table.grantId} is not null`),
    uniqueIndex('grant_case_exclusions_invitation_mission_unique')
      .on(table.sharingInvitationId, table.missionId)
      .where(sql`${table.sharingInvitationId} is not null`),
    index('grant_case_exclusions_applicant_idx').on(table.applicantId),
    index('grant_case_exclusions_mission_idx').on(table.missionId),
    foreignKey({
      name: 'grant_case_exclusions_grant_applicant_fk',
      columns: [table.grantId, table.applicantId],
      foreignColumns: [grants.id, grants.applicantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'grant_case_exclusions_invitation_applicant_fk',
      columns: [table.sharingInvitationId, table.applicantId],
      foreignColumns: [sharingInvitations.id, sharingInvitations.applicantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'grant_case_exclusions_mission_applicant_fk',
      columns: [table.missionId, table.applicantId],
      foreignColumns: [missions.id, missions.applicantId],
    }).onDelete('cascade'),
  ],
);

// --- Document Vault (Build Spec §4.2) --------------------------------------
// Encrypted bytes in private object storage. The key is an immutable UUID and
// is never the display filename (Build Spec §7).
export const storageObjects = pgTable('storage_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  bucket: storageBucket('bucket').notNull(),
  objectKey: text('object_key').notNull().unique(),
  contentHash: text('content_hash'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The logical document. Approved display name is versioned separately; the
// original filename is preserved forever.
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicantId: uuid('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  approvedName: text('approved_name'),
  originalName: text('original_name').notNull(),
  docType: text('doc_type'),
  subject: text('subject'),
  issuer: text('issuer'),
  documentDate: text('document_date'),
  source: text('source'),
  uploaderAccountId: uuid('uploader_account_id').references(() => accounts.id, {
    onDelete: 'set null',
  }),
  // CAS-08: "the file is case-scoped by default and is not copied into the
  // traveller's reusable wallet without contributor permission." True for
  // every normal, applicant-uploaded document (unaffected by this change);
  // set false only for a contributor-submitted document whose contributor
  // did not opt into wallet reuse (documents.ts's registerDocument). Read
  // by wallet.ts's getWalletView; deliberately NOT read by missions.ts's
  // own readiness/docType matching, which stays applicant-wide as before --
  // "wallet" in this product's own vocabulary (EVI-04) names the browsable
  // reuse view specifically, not the underlying evidence-matching mechanism.
  walletVisible: boolean('wallet_visible').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  // EVI-04 ("passport renewal updates the wallet, preserves the old passport
  // and flags cases using it; it does not mutate historical snapshots"): set
  // only via `supersedeDocument`, never mutates or deletes the old row, just
  // links forward to its replacement. Plain uuid, no FK, matching the
  // codebase's established self-reference pattern (e.g.
  // ai_extraction_runs.served_from_cache_run_id) since a same-table FK
  // reference has no sensible ON DELETE behavior here anyway.
  supersededByDocumentId: uuid('superseded_by_document_id'),
  ...timestamps,
});

// An uploaded/generated version. Replacement/versioning never destroys prior
// mission snapshots.
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull().default(1),
    storageObjectId: uuid('storage_object_id')
      .notNull()
      .references(() => storageObjects.id, { onDelete: 'restrict' }),
    processingStatus: documentState('processing_status').notNull().default('UPLOADING'),
    safetyStatus: documentSafetyStatus('safety_status').notNull().default('PENDING'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    pages: integer('pages'),
    sha256: text('sha256'),
    ...timestamps,
  },
  (table) => [
    unique('document_versions_doc_version_unique').on(table.documentId, table.versionNumber),
    index('document_versions_document_idx').on(table.documentId),
  ],
);

// EVI-03: "document review supports pending, accepted, replacement required,
// irrelevant and disputed." A document-level judgment on whether the
// evidence itself is acceptable, distinct from missionDecisions (a
// requirement-scoped, mission-specific judgment) and from
// processingStatus/safetyStatus (pipeline state, not a reviewer's opinion).
export const documentReviewOutcome = pgEnum('document_review_outcome', [
  'PENDING',
  'ACCEPTED',
  'REPLACEMENT_REQUIRED',
  'IRRELEVANT',
  'DISPUTED',
]);

// Append-only, like missionDecisions: the latest row per document is "the"
// current review status, with full history preserved.
export const documentReviews = pgTable(
  'document_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    outcome: documentReviewOutcome('outcome').notNull(),
    reason: text('reason'),
    // restrict, not set null: this column is NOT NULL (every review has a
    // reviewer), so set null would fail the FK action outright on delete.
    reviewedByAccountId: uuid('reviewed_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('document_reviews_document_idx').on(table.documentId)],
);

// --- Upload consistency: server-created upload intent (master directive §7
// "PR 6") ---------------------------------------------------------------
// Closes a real TOCTOU gap: without a durable reservation, two concurrent
// uploads for the same applicant/account could each individually pass a
// read-only quota check and jointly exceed it. `reserveUpload`
// (packages/services/src/uploads.ts) atomically checks every quota tier
// against committed bytes (documentVersions.sizeBytes) PLUS every other
// still-`RESERVED`, unexpired row here, then inserts one — before any bytes
// are written. `expiresAt` bounds how long an abandoned upload (crashed
// mid-flight, never finalized) can hold its reservation: quota sums exclude
// an expired row automatically, with no separate cleanup sweep required.
export const uploadIntentStatus = pgEnum('upload_intent_status', [
  'RESERVED',
  'COMPLETED',
  'FAILED',
]);

export const uploadIntents = pgTable(
  'upload_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    /** Minted here (not later) so a failure after the blob write always has a key to clean up by. */
    objectKey: text('object_key').notNull().unique(),
    reservedBytes: bigint('reserved_bytes', { mode: 'number' }).notNull(),
    status: uploadIntentStatus('status').notNull().default('RESERVED'),
    documentVersionId: uuid('document_version_id').references(() => documentVersions.id, {
      onDelete: 'set null',
    }),
    failureReason: text('failure_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('upload_intents_applicant_status_idx').on(table.applicantId, table.status),
    index('upload_intents_account_status_idx').on(table.accountId, table.status),
    index('upload_intents_status_expires_idx').on(table.status, table.expiresAt),
  ],
);

// One row per scanner invocation (append-only) — durable evidence of what
// scanned a document version, when, with which scanner/version, and with
// what result (master directive §7 "PR 3"). Distinct from
// documentVersions.safetyStatus (the CURRENT state, derived from the latest
// row here): this table is the full history, so a retried scan is visible
// rather than overwriting the prior attempt.
export const documentScanResults = pgTable(
  'document_scan_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    scannerName: text('scanner_name').notNull(),
    scannerVersion: text('scanner_version').notNull(),
    // `safe` alone cannot represent "the scanner never actually rendered a
    // verdict" (it threw/timed out/was unavailable) without being conflated
    // with a genuine unsafe verdict -- indistinguishable to any consumer of
    // listScanResults()/exported scan history, which would otherwise see a
    // false "the scanner found this unsafe" after a later, successful retry
    // (Codex review, PR-B3R, round 1). `safe: false` is still recorded as
    // the conservative placeholder value (a NOT NULL column needs *some*
    // value, and safety genuinely cannot be affirmed), but `scanErrored`
    // marks it as an indeterminate/error outcome, never a real verdict.
    scanErrored: boolean('scan_errored').notNull().default(false),
    safe: boolean('safe').notNull(),
    detail: text('detail'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('document_scan_results_document_version_idx').on(table.documentVersionId)],
);

// --- Persisted document intelligence (Release C; master directive §11/§13) -
// Deterministic extraction/classification/naming records. The AI-proposal
// tables (FieldProposal, EvidenceLocation, Conflict, CorrectionFeedback)
// belong to the separate AI PR — see "AI Gateway" further below.

// One row per processIntake execution that reached real extraction work
// (a retry gets its own row — never overwritten — so history is inspectable).
export const processingRuns = pgTable(
  'processing_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    status: processingRunStatus('status').notNull().default('RUNNING'),
    pipelineVersion: text('pipeline_version').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
  },
  (table) => [index('processing_runs_document_version_idx').on(table.documentVersionId)],
);

// One row per deterministic-parser invocation within a processing run.
// Extracted text is capped (never unbounded OCR/text retained indefinitely —
// master directive §11).
export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    processingRunId: uuid('processing_run_id')
      .notNull()
      .references(() => processingRuns.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    parserName: text('parser_name').notNull(),
    parserVersion: text('parser_version').notNull(),
    status: extractionRunStatus('status').notNull(),
    extractedText: text('extracted_text'),
    truncated: boolean('truncated').notNull().default(false),
    pageCount: integer('page_count'),
    confidence: integer('confidence'), // 0-100; null when extraction failed
    warnings: jsonb('warnings').$type<readonly string[]>(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('extraction_runs_document_version_idx').on(table.documentVersionId)],
);

// One row per classification attempt. `classifiedType` is free text (mirrors
// `documents.docType`) rather than a closed enum, so adding a new document
// type never requires a migration; the controlled vocabulary lives in
// application code (classification.ts).
export const documentClassifications = pgTable(
  'document_classifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    extractionRunId: uuid('extraction_run_id')
      .notNull()
      .references(() => extractionRuns.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    classifiedType: text('classified_type'), // null when confidence is too low to call it
    confidence: integer('confidence').notNull(), // 0-100
    reviewRequired: boolean('review_required').notNull().default(true),
    rationale: text('rationale'),
    // Part 8 AI-01 item 2: defaults DETERMINISTIC for both new rows from
    // classification.ts and every pre-existing row (a straightforward
    // additive backfill) -- set to AI_APPROVED only by decideDocumentTypeProposal
    // (packages/services/src/classification-ai.ts) once a human approves an
    // AI suggestion the deterministic classifier itself could not resolve.
    source: classificationSource('source').notNull().default('DETERMINISTIC'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('document_classifications_document_version_idx').on(table.documentVersionId)],
);

// Part 8 AI-01 item 2 ("document type suggestion"): a deliberately SEPARATE
// table from `ai_extraction_runs`, matching `ocr_runs`'s own precedent one
// table up -- a per-task attempt limit (`countAiExtractionAttempts`'s own
// doc comment: "genuinely different actions a caller invokes separately")
// must stay independent per task, which is far cleaner with its own table
// than a shared one plus a discriminator every attempt/cache query would
// then need to filter by. Otherwise an exact structural mirror of
// `ai_extraction_runs`: same usage-tracking columns, same status enum, same
// cache-key convention. No `triggeredByRunId` yet (Part 8 §13 cross-provider
// fallback) -- deliberately deferred; this task type does not wire fallback
// in its first cut, so the column would sit unused until it does.
export const aiClassificationRuns = pgTable(
  'ai_classification_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    status: aiExtractionRunStatus('status').notNull(),
    modelVersion: text('model_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version'),
    costUnits: integer('cost_units').notNull().default(0),
    provider: text('provider'),
    providerRequestId: text('provider_request_id'),
    inputUnits: integer('input_units'),
    outputUnits: integer('output_units'),
    cachedUnits: integer('cached_units'),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    cacheKey: text('cache_key'),
    servedFromCacheRunId: uuid('served_from_cache_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_classification_runs_document_version_idx').on(table.documentVersionId),
    index('ai_classification_runs_applicant_idx').on(table.applicantId),
    index('ai_classification_runs_cache_key_idx').on(table.cacheKey),
  ],
);

// An AI-suggested document type from a single classification run -- the
// `document_classifications` analogue of `field_proposals`, structured the
// same "advisory only, a human must decide" way: never written to
// `document_classifications` directly, only `decideDocumentTypeProposal`
// (on approval) can turn one into a real, AI_APPROVED classification row,
// reusing the exact same downstream effects (`documents.docType`, the
// naming-proposal trigger) the deterministic path already has.
export const documentTypeProposals = pgTable(
  'document_type_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aiClassificationRunId: uuid('ai_classification_run_id')
      .notNull()
      .references(() => aiClassificationRuns.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    // Free text, matching `document_classifications.classified_type`'s own
    // rationale -- validity against the controlled vocabulary is a
    // service-layer concern (classification.ts), not a DB constraint.
    suggestedType: text('suggested_type').notNull(),
    confidence: integer('confidence').notNull(), // 0-100
    rationale: text('rationale'),
    status: proposalStatus('status').notNull().default('PENDING'),
    decidedByAccountId: uuid('decided_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // Set once approved and written as a document_classifications row (mirrors
    // field_proposals.factVersionId's identical "set only on approval" shape).
    classificationId: uuid('classification_id').references(() => documentClassifications.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('document_type_proposals_document_version_idx').on(table.documentVersionId),
    index('document_type_proposals_applicant_status_idx').on(table.applicantId, table.status),
  ],
);

// Part 8 AI-01 item 5 ("explanation of an ALREADY-DETERMINED deterministic
// readiness gap"). Deliberately NO applicantId/documentVersionId column,
// unlike every other AI Gateway run table -- the input this task sends the
// model (a pack requirement's kind/citation/RUL-04 state) is pack-level
// policy content, identical for every mission using that requirement, never
// an applicant's own document/profile data. That also means no consent gate
// applies (there is no personal disclosure to consent to) and the cache key
// is content-based, so the SAME explanation is naturally reused across every
// mission/applicant hitting the identical requirement+state combination.
// Unlike extraction/classification, there is no separate proposal table
// either: an explanation is advisory TEXT with no consequential write of its
// own to approve (directive's own "No: ... direct consequential DB writes by
// model" -- this never writes anything else), so the result is stored
// directly on the SUCCEEDED run row.
export const aiExplanationRuns = pgTable(
  'ai_explanation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packRequirementId: uuid('pack_requirement_id')
      .notNull()
      .references(() => packRequirements.id, { onDelete: 'cascade' }),
    status: aiExtractionRunStatus('status').notNull(),
    modelVersion: text('model_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version'),
    costUnits: integer('cost_units').notNull().default(0),
    provider: text('provider'),
    providerRequestId: text('provider_request_id'),
    inputUnits: integer('input_units'),
    outputUnits: integer('output_units'),
    cachedUnits: integer('cached_units'),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    cacheKey: text('cache_key'),
    servedFromCacheRunId: uuid('served_from_cache_run_id'),
    explanation: text('explanation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_explanation_runs_pack_requirement_idx').on(table.packRequirementId),
    index('ai_explanation_runs_cache_key_idx').on(table.cacheKey),
  ],
);

// Part 8 AI-01 item 4 ("possible inconsistency flag") -- an exact structural
// mirror of `ai_classification_runs` (same usage-tracking columns, same
// status enum, same cache-key convention, same document/applicant scoping),
// kept as its own table for the identical reason every other AI Gateway task
// has its own: `countAiInconsistencyAttempts`'s own attempt limit must stay
// independent of every other task's.
export const aiInconsistencyRuns = pgTable(
  'ai_inconsistency_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    status: aiExtractionRunStatus('status').notNull(),
    modelVersion: text('model_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version'),
    costUnits: integer('cost_units').notNull().default(0),
    provider: text('provider'),
    providerRequestId: text('provider_request_id'),
    inputUnits: integer('input_units'),
    outputUnits: integer('output_units'),
    cachedUnits: integer('cached_units'),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    // sha256(contentHash|profileFactsHash|...) -- unlike every other task's
    // cache key, this one must also fold in a hash of the profile facts
    // snapshot sent alongside the document text (see `runInconsistencyCheck`'s
    // own doc comment): the correct answer depends on BOTH, and a stale
    // cache hit computed against facts the applicant has since corrected
    // would silently re-serve a flag about a contradiction that no longer
    // exists.
    cacheKey: text('cache_key'),
    servedFromCacheRunId: uuid('served_from_cache_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_inconsistency_runs_document_version_idx').on(table.documentVersionId),
    index('ai_inconsistency_runs_applicant_idx').on(table.applicantId),
    index('ai_inconsistency_runs_cache_key_idx').on(table.cacheKey),
  ],
);

// One possible inconsistency the model noticed between a document's text and
// the applicant's own already-confirmed profile facts -- advisory only, like
// every other AI Gateway proposal/flag: never a fact write, never a
// consequential DB write of any kind (directive's own "No: ... direct
// consequential DB writes by model"). Deliberately free-text `description`
// rather than a structured factKey/documentValue/profileValue triple --
// the inconsistency the model notices may not cleanly map to any single
// canonical field (e.g. "a middle name appears on this document but nowhere
// in the profile"), so forcing a rigid shape would either drop real findings
// or invite the model to invent a field mapping that does not exist.
export const documentInconsistencyFlags = pgTable(
  'document_inconsistency_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aiInconsistencyRunId: uuid('ai_inconsistency_run_id')
      .notNull()
      .references(() => aiInconsistencyRuns.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    confidence: integer('confidence').notNull(), // 0-100
    rationale: text('rationale'),
    status: inconsistencyFlagStatus('status').notNull().default('PENDING'),
    decidedByAccountId: uuid('decided_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('document_inconsistency_flags_document_version_idx').on(table.documentVersionId),
    index('document_inconsistency_flags_applicant_status_idx').on(table.applicantId, table.status),
  ],
);

// Immutable filename-proposal history at the logical-document level (naming
// never touches the opaque storage key or `originalName` — master directive
// §11/§21E). A version starts PENDING; a human decision (accept
// unchanged/edited, or reject) is recorded, never silently applied.
export const documentNameVersions = pgTable(
  'document_name_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    proposedName: text('proposed_name').notNull(),
    finalName: text('final_name'),
    decision: nameVersionDecision('decision').notNull().default('PENDING'),
    decidedByAccountId: uuid('decided_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('document_name_versions_doc_version_unique').on(table.documentId, table.versionNumber),
    index('document_name_versions_document_idx').on(table.documentId),
  ],
);

// --- Low-volume durable job queue (Release B; master directive §5 approved
// infra: "DB-backed jobs for low pilot volume", no external queue/Inngest) ---
// Decouples intake processing from the upload HTTP request. A row is claimed
// with `FOR UPDATE SKIP LOCKED` (see packages/services/src/jobs.ts) so
// concurrent workers never double-process the same job. A failure retries
// with exponential backoff up to maxAttempts, then parks at FAILED — visible
// and inspectable, never silently dropped.
//
// Leases (master directive §7 "PR 6"): a claim is a time-bound lease, not a
// permanent hand-off. `leaseOwner` identifies which worker invocation holds
// it; `leaseExpiresAt` bounds how long it may hold it before the claim sweep
// (packages/services/src/jobs.ts) reclaims the row automatically — a worker
// that crashes mid-job no longer strands it at CLAIMED forever.
// `heartbeatAt` is set at claim time (this pipeline runs one bounded,
// sub-second-to-low-single-digit-second pass per document — there is no
// long-running step that needs mid-job liveness proof; the column exists so
// a future genuinely long-running job type can update it without a schema
// change). `idempotencyKey` (unique) is the string form of
// `documentVersionId:jobType:processingVersion` — enqueuing the same
// processing unit twice returns the existing row rather than creating a
// duplicate (job uniqueness).
export const processingJobType = pgEnum('processing_job_type', ['INTAKE']);

export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    jobType: processingJobType('job_type').notNull().default('INTAKE'),
    /** Bumped only when the processing pipeline itself changes meaningfully enough that old completed work should not block reprocessing under the new pipeline. */
    processingVersion: integer('processing_version').notNull().default(1),
    idempotencyKey: text('idempotency_key').notNull(),
    status: jobStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Closed-set, safe-to-display category — never the raw internal error text. */
    errorCode: text('error_code'),
    ...timestamps,
  },
  (table) => [
    unique('processing_jobs_idempotency_key_unique').on(table.idempotencyKey),
    index('processing_jobs_status_available_idx').on(table.status, table.availableAt),
    index('processing_jobs_document_version_idx').on(table.documentVersionId),
    index('processing_jobs_lease_expires_idx').on(table.status, table.leaseExpiresAt),
  ],
);

// --- Master Profile: canonical field registry (Build Spec §4.1) ------------
// AI cannot invent canonical fields; they come from this registry.
export const fieldDefinitions = pgTable('field_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  dataType: text('data_type').notNull(),
  sensitivity: fieldSensitivity('sensitivity').notNull().default('STANDARD'),
  repeating: boolean('repeating').notNull().default(false),
  packId: text('pack_id'),
  validation: jsonb('validation'),
  ...timestamps,
});

// A fact = a field instance for an applicant. The current value is a POINTER
// to an immutable fact_version; history is never overwritten (Build Spec §9).
export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    fieldDefinitionId: uuid('field_definition_id')
      .notNull()
      .references(() => fieldDefinitions.id, { onDelete: 'restrict' }),
    // Groups a repeating record (e.g. a specific passport). Null for singletons.
    repeatingRecordKey: text('repeating_record_key'),
    // Pointer to the current fact_versions row; set on approval. Plain uuid to
    // avoid a circular FK (facts <-> fact_versions); integrity enforced in the
    // service layer inside the atomic approval transaction (Build Spec §8).
    currentVersionId: uuid('current_version_id'),
    ...timestamps,
  },
  (table) => [index('facts_applicant_idx').on(table.applicantId)],
);

// Immutable fact value + full provenance (Build Spec §9). Never updated.
export const factVersions = pgTable(
  'fact_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    factId: uuid('fact_id')
      .notNull()
      .references(() => facts.id, { onDelete: 'cascade' }),
    // Plaintext value for STANDARD-sensitivity fields, and for any row written
    // before protected-field encryption existed (Commercial V1 SEC-03). When
    // `protectedKeyVersion` is set, this is null and the real value lives
    // encrypted in `valueCiphertext`/`valueNonce` instead — never both at
    // once, enforced by the check constraint below.
    value: text('value'),
    // AES-256-GCM ciphertext (includes the auth tag) for a SENSITIVE/RESTRICTED
    // field, encrypted by packages/services/src/protected-fields.ts. Never the
    // plaintext value.
    valueCiphertext: bytea('value_ciphertext'),
    // Random 96-bit nonce used for this specific encryption. Never reused
    // across rows (a fresh nonce is generated on every write).
    valueNonce: bytea('value_nonce'),
    // Which envelope key version's data key encrypted this value (opaque
    // label the KeyManagementPort adapter interprets — never the key
    // material itself). Null means unprotected/plaintext.
    protectedKeyVersion: text('protected_key_version'),
    normalizedValue: text('normalized_value'),
    status: factStatus('status').notNull().default('DECLARED'),
    method: auditMethod('method').notNull().default('MANUAL'),
    actorAccountId: uuid('actor_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    sourceDocumentVersionId: uuid('source_document_version_id').references(
      () => documentVersions.id,
      { onDelete: 'set null' },
    ),
    modelVersion: text('model_version'),
    promptVersion: text('prompt_version'),
    schemaVersion: text('schema_version'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('fact_versions_fact_idx').on(table.factId),
    // A row is never simultaneously plaintext AND protected, and the three
    // protected columns are always set together or not at all — deliberately
    // permissive about a row having neither (no value recorded at all;
    // reserved/placeholder rows are not this constraint's concern, only
    // "never half-protected" and "never both" are). Enforced at the database
    // level so an application bug can't silently store a corrupt row.
    check(
      'fact_versions_protection_exclusive',
      sql`(
        ${table.value} is null or ${table.valueCiphertext} is null
      ) and (
        (${table.valueCiphertext} is null) = (${table.valueNonce} is null)
        and (${table.valueCiphertext} is null) = (${table.protectedKeyVersion} is null)
      )`,
    ),
  ],
);

// EVI-05 (assurance ladder), tier "issuer confirmed": the one tier with no
// existing infrastructure to derive from. The other four statements the PRD
// asks for read off data this schema already has: "applicant declared" and
// "document supplied" off factVersions.status/sourceDocumentVersionId above,
// "named machine checks performed" off documentClassifications/
// extractionRuns/documentScanResults (joined via sourceDocumentVersionId),
// and "agency reviewed" off missionDecisions (joined via selectedEvidence);
// see packages/services/src/assurance.ts for how all five are assembled and
// displayed. PRD is explicit this tier must never be "a staff checkbox
// claiming verification": every substantive field is required NOT NULL, so
// a row structurally cannot exist without real content, and `validUntil` is
// required too (nothing here is presumed to hold forever, matching SHR-01's
// refusal to let a grant have no expiry). factId/documentId are each
// optional (a confirmation can cover a claim not yet modeled as a discrete
// fact, or a document with no single fact it maps to) but the check
// constraint below requires at least one, so every row stays reachable from
// a real UI surface instead of floating unattached to anything.
export const issuerVerifications = pgTable(
  'issuer_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    factId: uuid('fact_id').references(() => facts.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    issuerIdentity: text('issuer_identity').notNull(),
    contactMethod: text('contact_method').notNull(),
    exactClaim: text('exact_claim').notNull(),
    response: text('response').notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    // restrict, not set null: this column is NOT NULL, so set null would
    // fail the FK action outright on delete.
    verifiedByAccountId: uuid('verified_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('issuer_verifications_applicant_idx').on(table.applicantId),
    index('issuer_verifications_fact_idx').on(table.factId),
    index('issuer_verifications_document_idx').on(table.documentId),
    check(
      'issuer_verifications_covers_something',
      sql`${table.factId} is not null or ${table.documentId} is not null`,
    ),
  ],
);

// --- Envelope key registry (Commercial V1 SEC-03) ---------------------------
// Tracks only the KMS-WRAPPED (encrypted) data key per version — never
// plaintext key material. Worthless without the KeyManagementPort adapter's
// KMS to unwrap it, so a full database dump or backup never carries enough
// to decrypt protected fields on its own (SEC-03's explicit requirement).
// One row per key version; a version is retired (new writes stop using it)
// without deleting it, since old ciphertext encrypted under it must remain
// decryptable until a deliberate re-encryption pass rotates it away.
export const dataKeys = pgTable('data_keys', {
  keyVersion: text('key_version').primaryKey(),
  wrappedDataKey: bytea('wrapped_data_key').notNull(),
  // Which key wrapped it (for example `aws-kms:<key id>`); null means the local development
  // key. Lets reads pick the right unwrapper and the re-wrap job count what is left to move.
  wrappingKeyId: text('wrapping_key_id'),
  algorithm: text('algorithm').notNull().default('AES-256-GCM'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
});

// --- Support access grants (Commercial V1 SEC-06) ---------------------------
// A scoped, time-limited, reasoned, approved grant of read access to one
// applicant's protected content for a support operator. Distinct from the
// ordinary `grants` table (which an applicant creates for themselves); this
// is created by a platform operator ABOUT an applicant who never consented
// to it, so it carries mandatory reason/approver fields ordinary sharing
// grants don't need, and a database-enforced maximum duration and
// no-self-approval rule — neither is optional configuration.
// `loadSupportGrantsForPolicy` (packages/services/src/support-access.ts)
// converts an active row here into the same `Grant` shape the policy engine
// already evaluates for `support_admin` actors, reusing its tested
// status/expiry/purpose logic rather than duplicating it.
export const supportGrants = pgTable(
  'support_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    actions: permissionAction('actions').array().notNull(),
    reason: text('reason').notNull(),
    approvedByAccountId: uuid('approved_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull().defaultNow(),
    expiryAt: timestamp('expiry_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByAccountId: uuid('revoked_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    revokedReason: text('revoked_reason'),
    ...timestamps,
  },
  (table) => [
    index('support_grants_applicant_idx').on(table.applicantId),
    index('support_grants_actor_idx').on(table.actorAccountId),
    // A support grant is never self-approved — the approver must be a
    // different account from the operator receiving access, structurally,
    // not just by service-layer convention.
    check(
      'support_grants_approver_not_actor',
      sql`${table.approvedByAccountId} <> ${table.actorAccountId}`,
    ),
    // Maximum 60 minutes (SEC-06), enforced at the database level so an
    // application bug can never issue a longer-lived grant.
    check(
      'support_grants_max_duration',
      sql`extract(epoch from (${table.expiryAt} - ${table.startAt})) <= 3600`,
    ),
    check('support_grants_expiry_after_start', sql`${table.expiryAt} > ${table.startAt}`),
  ],
);

// Links a document version (page/region) to a fact version as supporting
// evidence — may exist without changing a fact (Build Spec §8).
export const evidenceLinks = pgTable(
  'evidence_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    factVersionId: uuid('fact_version_id')
      .notNull()
      .references(() => factVersions.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    page: integer('page'),
    region: jsonb('region'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('evidence_links_unique').on(table.factVersionId, table.documentVersionId)],
);

// --- AI Gateway (AI PR; master directive §8/§26 item 4) ---------------------
// Extraction produces PROPOSALS, never silent writes (Build Spec §8). Every
// invocation of the AI adapter is recorded here - the durable, append-only
// cost ledger IS this table (SUM(cost_units)), not a separate mutable
// counter, matching the audit-friendly, immutable-history pattern used
// everywhere else in this schema (fact_versions, extraction_runs, etc.).
export const aiExtractionRuns = pgTable(
  'ai_extraction_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    status: aiExtractionRunStatus('status').notNull(),
    modelVersion: text('model_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    // Version of the response JSON schema sent to the model — nullable
    // because runs recorded before this column existed have none (master
    // directive §7 "PR 9" cache-key components).
    schemaVersion: text('schema_version'),
    costUnits: integer('cost_units').notNull().default(0),
    // Part 8 §4/§11 ("normalized gateway contract"/"spend accounting"):
    // richer telemetry alongside the existing blended `costUnits`, which
    // stays authoritative for budget enforcement unchanged. All nullable --
    // a cache-hit row makes no new provider call at all (nothing to report
    // beyond which provider originally produced the cached data), and a
    // historical row predates these columns entirely.
    provider: text('provider'),
    providerRequestId: text('provider_request_id'),
    inputUnits: integer('input_units'),
    outputUnits: integer('output_units'),
    cachedUnits: integer('cached_units'),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    // sha256(contentHash|taskVersion|parserVersion|model|promptVersion|
    // schemaVersion|reasoningEffort) — set on every attempted run (even a
    // cache hit gets its own row) so a later request with the identical
    // combination can find and reuse a SUCCEEDED one instead of paying for
    // the API call again.
    cacheKey: text('cache_key'),
    // Set only when this run reused a prior run's proposals instead of
    // calling the model — the audit trail always shows real cost either way.
    servedFromCacheRunId: uuid('served_from_cache_run_id'),
    // Part 8 §13 (cross-provider fallback): set only on a row created
    // because an earlier row (this field's value) failed with a recoverable
    // code and a designated fallback provider was dispatched in response --
    // never a real FK (matches servedFromCacheRunId's own convention just
    // above), and always exactly one hop (a fallback's own fallback, if it
    // has one, is never chased) so no cycle handling is needed.
    triggeredByRunId: uuid('triggered_by_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_extraction_runs_document_version_idx').on(table.documentVersionId),
    index('ai_extraction_runs_applicant_idx').on(table.applicantId),
    index('ai_extraction_runs_cache_key_idx').on(table.cacheKey),
    index('ai_extraction_runs_triggered_by_idx').on(table.triggeredByRunId),
  ],
);

// OCR runs (Part 8 §9), a deliberately SEPARATE table from both tables above
// -- neither fits without stretching its own meaning. `extraction_runs`
// (deterministic parsing) has the right OUTPUT shape (extractedText) but its
// `processingRunId` FK is tied one-to-one to a single automatic-pipeline
// pass (`processingRuns`), and OCR is a later, separate, explicitly-
// triggered action, not part of that pipeline run. `ai_extraction_runs`
// (field-proposal AI calls) has the right USAGE-TRACKING shape (costUnits/
// provider/latencyMs/cacheKey) but its cache key is composed from
// parserVersion/schemaVersion/reasoningEffort, none of which apply to OCR
// (AiOcrCacheKeyComponents is just {model, promptVersion}), and it has
// nowhere to put the extracted text or the four review-issue signals
// (low_quality/ambiguous_date/unsupported_script/missing_text, directive
// §9's own named signals). This table is the union of what OCR actually
// needs: `ai_extraction_runs`'s own usage-tracking columns plus
// `extraction_runs`'s own text-output shape, plus `reviewIssues`.
// `applicantId` is denormalized here for the identical reason
// `ai_extraction_runs` already carries it -- audit/reporting queries that
// would otherwise need a join through documentVersions -> documents ->
// applicantId every time.
export const ocrRuns = pgTable(
  'ocr_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    status: ocrRunStatus('status').notNull(),
    provider: text('provider').notNull(),
    modelVersion: text('model_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    extractedText: text('extracted_text'),
    reviewIssues: jsonb('review_issues').$type<readonly string[]>(),
    costUnits: integer('cost_units').notNull().default(0),
    inputUnits: integer('input_units'),
    outputUnits: integer('output_units'),
    providerRequestId: text('provider_request_id'),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    // sha256(contentHash|model|promptVersion) -- simpler than
    // ai_extraction_runs's own cache key since OCR has no parser/schema
    // version or reasoning-effort dial to fold in.
    cacheKey: text('cache_key'),
    servedFromCacheRunId: uuid('served_from_cache_run_id'),
    // Part 8 §13 (cross-provider fallback): same meaning and the same
    // deliberately-not-a-real-FK, always-one-hop shape as
    // aiExtractionRuns.triggeredByRunId above.
    triggeredByRunId: uuid('triggered_by_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ocr_runs_document_version_idx').on(table.documentVersionId),
    index('ocr_runs_applicant_idx').on(table.applicantId),
    index('ocr_runs_cache_key_idx').on(table.cacheKey),
    index('ocr_runs_triggered_by_idx').on(table.triggeredByRunId),
  ],
);

// A field proposal from a single AI extraction run. Never written directly to
// a fact - only approveProposal (packages/services/src/ai.ts) can turn one
// into an immutable fact_versions row, reusing the same atomic-approval
// machinery as a manual edit. confidence is 0-100 (matches the same scale
// used by document_classifications/extraction_runs elsewhere in this file);
// the AI adapter itself reports 0..1 and the service layer converts.
export const fieldProposals = pgTable(
  'field_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aiExtractionRunId: uuid('ai_extraction_run_id')
      .notNull()
      .references(() => aiExtractionRuns.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    type: proposalType('type').notNull(),
    // Free text, not an FK to field_definitions.key - an UNMAPPED proposal has
    // none, and validity against the registry is checked in the service layer
    // (mirrors document_classifications.classified_type's same rationale).
    fieldKey: text('field_key'),
    value: text('value'),
    confidence: integer('confidence').notNull(), // 0-100
    rationale: text('rationale'),
    status: proposalStatus('status').notNull().default('PENDING'),
    decidedByAccountId: uuid('decided_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // Set once the proposal is approved and written as a fact version.
    factVersionId: uuid('fact_version_id').references(() => factVersions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('field_proposals_document_version_idx').on(table.documentVersionId),
    index('field_proposals_applicant_status_idx').on(table.applicantId, table.status),
  ],
);

// The source-text excerpt the model cited for a proposed value - lets a human
// reviewer verify against the evidence instead of trusting the model blindly.
// Distinct from evidence_links (which links an already-APPROVED fact version
// to a document region/page); this is pre-approval, proposal-scoped, and
// text-offset based since deterministic extraction has no page/region
// coordinates to offer.
export const evidenceLocations = pgTable(
  'evidence_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldProposalId: uuid('field_proposal_id')
      .notNull()
      .references(() => fieldProposals.id, { onDelete: 'cascade' }),
    snippet: text('snippet').notNull(),
    // Set only when `verified` is true (an exact substring match) -- never an
    // approximate/normalized position, so a future highlight built from these
    // is always honestly exact, never a guess.
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    // Part 8 AI-04 (evidence grounding): whether this snippet was actually
    // confirmed, server-side, as a verbatim exact substring of the document
    // text the model was given -- not merely instructed by the prompt to be
    // one. Null means never checked (a row from before this column existed,
    // or -- for a cache-hit copy -- carried forward from the original run's
    // own check); true/false is a real, computed answer, set once at
    // insert time and never revised afterward.
    verified: boolean('verified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('evidence_locations_field_proposal_idx').on(table.fieldProposalId)],
);

// --- AI provider configuration (Part 8 §5/§6, AI-02/AI-06) -----------------
// Every row is a full, immutable configuration snapshot -- "activating" never
// edits a row in place, it flips which row currently holds ACTIVE (and moves
// whatever held it before to SUPERSEDED), so the complete history of what the
// platform actually ran under is always reconstructable, matching the same
// append-history discipline as fact_versions/billing_status_history. At most
// one row is ever ACTIVE at a time -- enforced in the service layer under an
// advisory lock (packages/services/src/ai-provider-config.ts), the same
// pattern uploads.ts/ai.ts already use for an identical
// platform-wide-single-winner guarantee, not a database constraint.
export const aiProviderConfigStatus = pgEnum('ai_provider_config_status', [
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED',
  'DISABLED',
]);

export const aiProviderConfigs = pgTable(
  'ai_provider_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: aiProviderConfigStatus('status').notNull().default('DRAFT'),
    provider: text('provider').notNull(),
    // Free text, not an enum (Part 8 §3: "do not hardcode 'latest model'" --
    // admin types/selects an account-accessible model id).
    model: text('model').notNull(),
    reasoningEffort: text('reasoning_effort'),
    // Envelope-encrypted (packages/services/src/protected-fields.ts's
    // existing protectValue/revealValue -- the same AES-256-GCM primitive
    // already used for protected profile fields, never a second encryption
    // scheme). Never the plaintext key.
    apiKeyCiphertext: bytea('api_key_ciphertext').notNull(),
    apiKeyNonce: bytea('api_key_nonce').notNull(),
    apiKeyVersion: text('api_key_version').notNull(),
    // Masked display only (e.g. last 4 characters) -- Part 8 §6 "masked
    // fingerprint." Never enough to reconstruct the key.
    apiKeyFingerprint: text('api_key_fingerprint').notNull(),
    // Part 8 §6 "revocation." Set independently of `status`: a revoked key
    // disqualifies this version from ever being rolled back to (Part 8 §5
    // "cannot resurrect: revoked key") even if it was a perfectly good
    // config otherwise.
    keyRevokedAt: timestamp('key_revoked_at', { withTimezone: true }),
    // Part 8 §5 "set reviewed data policy" -- a hard prerequisite for
    // activation and for rollback eligibility ("cannot resurrect ...
    // unapproved data policy"), not merely descriptive metadata.
    dataPolicyApproved: boolean('data_policy_approved').notNull().default(false),
    // Same six knobs apps/web/src/lib/ai.ts's env-var functions already
    // expose -- versioned here instead of read from process.env once a
    // config row is ACTIVE. budgetLimitUnits is deliberately required, no
    // default: Part 8 §11 "budget unset: NOT unlimited," applied at
    // creation time too, not just at runtime.
    budgetLimitUnits: integer('budget_limit_units').notNull(),
    perDocumentBudgetLimitUnits: integer('per_document_budget_limit_units'),
    maxAttemptsPerDocument: integer('max_attempts_per_document'),
    maxPagesPerDocument: integer('max_pages_per_document'),
    cacheMaxAgeDays: integer('cache_max_age_days'),
    maxConcurrentCalls: integer('max_concurrent_calls'),
    // Part 8 §13 ("cross-provider fallback... OFF by default"). Persisted on
    // each versioned row like the six budget/limit knobs above, not a
    // separate mutable setting -- fallback preference is part of what
    // "activating" this row commits to.
    fallbackEnabled: boolean('fallback_enabled').notNull().default(false),
    // Which OTHER config row to fall back to. Deliberately NOT a real FK
    // constraint (bare uuid, matching servedFromCacheRunId's established
    // convention on ai_extraction_runs/ocr_runs) and deliberately NOT
    // required to itself be ACTIVE -- with only ever one ACTIVE row
    // platform-wide (this table's own single-winner invariant, enforced in
    // ai-provider-config.ts), a fallback target is necessarily some OTHER
    // status (most naturally the config this row just superseded, or a
    // still-DRAFT alternative kept on hand). "Already passed the same
    // privacy/task/budget gates" (Part 8 §13) is re-verified live against
    // the pointed-to row at both activation and dispatch time, never assumed
    // permanently true from this pointer alone, since the pointed-to row's
    // own dataPolicyApproved/keyRevokedAt can still change afterward.
    fallbackProviderConfigId: uuid('fallback_provider_config_id'),
    notes: text('notes'),
    createdByAccountId: uuid('created_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => [index('ai_provider_configs_status_idx').on(table.status)],
);

// --- AI provider data terms (owner decision 2026-10-25) ---------------------
// What the provider account behind one configuration does with what VisaStack
// sends it, as read from the provider's own terms on `checked_on` by a
// platform admin. A side table rather than new columns on
// ai_provider_configs on purpose: every read of that table selects all of its
// columns, so adding columns there would break the whole AI gateway in the
// window between a deploy and its migration, while a missing side table only
// reads as "unknown terms". Append-only: the newest row per configuration is
// the one in force; older rows stay as the record of what the platform
// believed when. No row means "unknown": shown as a warning, and refused only
// while the "Only Use AI Providers That Do Not Train on Inputs" setting is on
// (packages/services/src/ai-data-terms.ts).
export const AI_PROVIDER_TIERS = ['FREE', 'PAID'] as const;
export const AI_TRAINING_ANSWERS = ['YES', 'NO', 'UNKNOWN'] as const;
export const AI_TERMS_TEXT_MAX = 500;

export const aiProviderConfigTerms = pgTable(
  'ai_provider_config_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configId: uuid('config_id')
      .notNull()
      .references(() => aiProviderConfigs.id, { onDelete: 'cascade' }),
    tier: text('tier', { enum: AI_PROVIDER_TIERS }).notNull(),
    trainsOnInputs: text('trains_on_inputs', { enum: AI_TRAINING_ANSWERS }).notNull(),
    retentionDays: integer('retention_days'),
    region: text('region'),
    termsUrl: text('terms_url'),
    checkedOn: date('checked_on', { mode: 'string' }).notNull(),
    notes: text('notes'),
    recordedByAccountId: uuid('recorded_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_provider_config_terms_config_idx').on(table.configId, table.createdAt),
    check('ai_provider_config_terms_tier_valid', sql`${table.tier} in ('FREE', 'PAID')`),
    check(
      'ai_provider_config_terms_training_valid',
      sql`${table.trainsOnInputs} in ('YES', 'NO', 'UNKNOWN')`,
    ),
    check(
      'ai_provider_config_terms_retention_range',
      sql`${table.retentionDays} is null or ${table.retentionDays} between 0 and 3650`,
    ),
    check(
      'ai_provider_config_terms_region_length',
      sql`${table.region} is null or char_length(${table.region}) <= 120`,
    ),
    check(
      'ai_provider_config_terms_url_valid',
      sql`${table.termsUrl} is null or (${table.termsUrl} like 'https://%' and char_length(${table.termsUrl}) <= 500)`,
    ),
    check(
      'ai_provider_config_terms_notes_length',
      sql`${table.notes} is null or char_length(${table.notes}) <= 500`,
    ),
    check(
      'ai_provider_config_terms_no_needs_source',
      sql`${table.trainsOnInputs} <> 'NO' or ${table.termsUrl} is not null`,
    ),
  ],
);

// --- "Only Use AI Providers That Do Not Train on Inputs" (owner 2026-10-25) --
// One platform switch, off by default: when on, the AI gateway uses a
// configuration only if its newest ai_provider_config_terms row says the
// provider does not train on inputs, with the terms address and the date
// checked (anything less is "incomplete terms"). Append-only like the terms: the newest
// row is the setting in force, older rows are its history, and every change
// is also written to the audit chain. No row (or no table yet) means off.
export const aiDataRuleSettings = pgTable(
  'ai_data_rule_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requireNoTraining: boolean('require_no_training').notNull(),
    reason: text('reason'),
    changedByAccountId: uuid('changed_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_data_rule_settings_created_idx').on(table.createdAt),
    check(
      'ai_data_rule_settings_reason_length',
      sql`${table.reason} is null or char_length(${table.reason}) <= 500`,
    ),
  ],
);

// Recorded when approving a proposal would overwrite an already-trusted fact
// value (APPLICANT_CONFIRMED/DOCUMENT_SUPPORTED/AGENCY_REVIEWED) with a
// different one. The new version is still written (status CONFLICTED, never
// silently discarded and never silently promoted to a trusted status) so the
// disagreement is visible and the human resolves it explicitly.
export const conflicts = pgTable(
  'conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldProposalId: uuid('field_proposal_id')
      .notNull()
      .references(() => fieldProposals.id, { onDelete: 'cascade' }),
    factId: uuid('fact_id')
      .notNull()
      .references(() => facts.id, { onDelete: 'cascade' }),
    previousFactVersionId: uuid('previous_fact_version_id')
      .notNull()
      .references(() => factVersions.id, { onDelete: 'cascade' }),
    newFactVersionId: uuid('new_fact_version_id')
      .notNull()
      .references(() => factVersions.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('conflicts_field_proposal_idx').on(table.fieldProposalId),
    index('conflicts_fact_idx').on(table.factId),
  ],
);

// Recorded when a human edits a proposed value before approving it
// (edit-before-approve) - a lightweight, write-only feedback signal for
// future model-quality review. No reader exists yet; this is intentionally
// just durable capture, not a retraining pipeline.
export const correctionFeedback = pgTable(
  'correction_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldProposalId: uuid('field_proposal_id')
      .notNull()
      .references(() => fieldProposals.id, { onDelete: 'cascade' }),
    originalValue: text('original_value'),
    correctedValue: text('corrected_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('correction_feedback_field_proposal_idx').on(table.fieldProposalId)],
);

// --- Requirement Packs & Pack Studio (Build Spec §4.5; PRD §4) --------------
// A pack is a named, composable requirement set. Its content is versioned and
// immutable once published; every requirement carries a citation.
export const packs = pgTable('packs', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  ownerOrganizationId: uuid('owner_organization_id').references(() => organizations.id, {
    onDelete: 'set null',
  }),
  // Commercial V1 RUL-01 coverage model. A pack is one coherent route/context
  // (e.g. "uk.tourist" already is, by convention) -- these describe which
  // population it covers, never read by evaluation itself (evaluation only
  // ever reads one exact `packVersionId`, permanently bound to a mission).
  // Nullable: unset means "not yet classified," never "applies universally."
  jurisdiction: text('jurisdiction'),
  route: text('route'),
  purpose: text('purpose'),
  nationalityApplicability: text('nationality_applicability').array(),
  residenceApplicability: text('residence_applicability').array(),
  // RUL-02 "author and reviewer must be distinct" applies only to an
  // authoritative public pack, never an agency's own custom checklist
  // (directive §3: "Agency custom checklist: must remain visibly separate").
  // Enforced in `approvePackVersion`, service-layer (like
  // `organizations.requireDifferentReviewer`), not a DB constraint, since
  // it is conditional on this flag rather than universal like
  // `support_grants_approver_not_actor`.
  authoritative: boolean('authoritative').notNull().default(false),
  ...timestamps,
});

export const packVersions = pgTable(
  'pack_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packId: uuid('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: packVersionStatus('status').notNull().default('DRAFT'),
    // Deterministic snapshot of the requirements + a checksum over it, set on
    // approval; a published version is immutable and verifiable.
    manifest: jsonb('manifest'),
    checksum: text('checksum'),
    // RUL-02 "reviewer" -- the account that approved/froze this version's
    // content. `authoredByAccountId` below is the DRAFT's own author; RUL-02's
    // "author and reviewer must be distinct" (authoritative public packs
    // only, `packs.authoritative`) compares these two columns, enforced in
    // `approvePackVersion`.
    approvedByAccountId: uuid('approved_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    authoredByAccountId: uuid('authored_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    // RUL-05 source maintenance: "initial next-review <=30 days unless
    // documented reason." Set at approval time; `reviewIntervalReason` is
    // required only when `nextReviewDate` is more than 30 days out.
    nextReviewDate: timestamp('next_review_date', { withTimezone: true }),
    reviewIntervalReason: text('review_interval_reason'),
    // When this version's content takes legal/official effect -- distinct
    // from `publishedAt` (when it became usable by missions in this system).
    effectiveDate: timestamp('effective_date', { withTimezone: true }),
    // Auto-set by `publishPackVersion` on any earlier PUBLISHED version of
    // the same pack the instant a newer one publishes (mirrors
    // `activateSubscription`'s auto-supersede of a prior subscription). Not
    // a human decision -- `withdrawnAt` below is.
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    // Pulled for cause (source turned out wrong/unsafe/inaccessible) --
    // always explicit, reasoned, audited. Refused from DRAFT (nothing to
    // withdraw yet; discard the version instead) or an already-terminal
    // status.
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnByAccountId: uuid('withdrawn_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    withdrawnReason: text('withdrawn_reason'),
    // RUL-06 Public Trust Lite (directive §9). Authored the same way as
    // every other requirement field -- only while DRAFT -- and purely
    // additive; no pre-existing version is affected by these being unset.
    // A short public-facing paragraph, distinct from any one requirement's
    // own `officialExtract`/`interpretation` (RUL-02), which stay
    // requirement-scoped.
    routeDescription: text('route_description'),
    // Configuration the platform publishes, never a record of what any one
    // applicant paid -- same "listed price, not collected cash" distinction
    // `plans.priceMinorUnits` already draws. Both null together or both set
    // together (constraint below); "if fee stale/unverified, remove amount"
    // is enforced by the read path checking `officialFeeStaleAt` below and
    // this version's own `nextReviewDate`, never by a separate boolean.
    officialFeeMinorUnits: integer('official_fee_minor_units'),
    officialFeeCurrency: text('official_fee_currency'),
    // Tracks a real-world "this number is no longer trustworthy" observation
    // on an already-PUBLISHED version, set/cleared without opening a new
    // DRAFT -- exactly `packRequirements.sourceInaccessibleAt`'s own pattern
    // (RUL-05), applied to the one field the directive singles out as able
    // to go stale independently of the rest of a version's content.
    officialFeeStaleAt: timestamp('official_fee_stale_at', { withTimezone: true }),
    officialChannelName: text('official_channel_name'),
    officialChannelUrl: text('official_channel_url'),
    // Route-specific official fraud-reporting link, shown only when an
    // admin has actually recorded one -- never a fabricated or generic
    // guess (directive §9/§12: treat source text as grounded, never invent
    // a link that isn't on file).
    officialReportingUrl: text('official_reporting_url'),
    // Explicit, audited opt-in gate distinct from `publishedAt`: a pack
    // version can be PUBLISHED (usable by missions) without ever being
    // exposed on the public trust surface -- publishing case-readiness
    // content and publishing public marketing/trust content are separate
    // deliberate acts, mirroring `publishedAt`/`withdrawnAt`'s own
    // explicit-timestamp pattern rather than a bare boolean.
    publicTrustPublishedAt: timestamp('public_trust_published_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('pack_versions_pack_version_unique').on(table.packId, table.version),
    check(
      'pack_versions_official_fee_currency_together',
      sql`(${table.officialFeeMinorUnits} is null) = (${table.officialFeeCurrency} is null)`,
    ),
  ],
);

export const packRequirements = pgTable(
  'pack_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packVersionId: uuid('pack_version_id')
      .notNull()
      .references(() => packVersions.id, { onDelete: 'cascade' }),
    kind: requirementKind('kind').notNull(),
    // A FIELD requirement names a canonical field key; a DOCUMENT one a docType.
    fieldKey: text('field_key'),
    docType: text('doc_type'),
    // Every requirement is grounded in a cited source (Build Spec §4.5).
    citation: text('citation').notNull(),
    optional: boolean('optional').notNull().default(false),
    notes: text('notes'),
    // NTF-01 "case-specific freshness/staleness" (Part 5 §1): a DOCUMENT
    // requirement may demand its evidence be dated within this many days
    // (e.g. "bank statement must be < 90 days old for this route"). Null for
    // every FIELD requirement and for a DOCUMENT requirement with no
    // freshness rule. Deliberately a column on the requirement, never on
    // `documents` itself - "never mutate the document's intrinsic validity
    // to represent a route rule." Because a pack version is immutable once
    // published and a mission binds to one exact `packVersionId` forever,
    // reading this column through that binding already "tracks rule version
    // behind case staleness" (the directive's own phrase) with no separate
    // versioning mechanism needed.
    maxAgeDays: integer('max_age_days'),
    // RUL-03 typed rule AST (packages/services/src/rule-conditions.ts).
    // Nullable: when absent, evaluation falls back to the pre-existing
    // "does an eligible fact/document instance exist" check unchanged --
    // this column is purely additive, no existing pack is affected by its
    // introduction. When present, a `RuleCondition` tree the evaluator reads
    // (never `eval`/arbitrary code); a missing referenced fact evaluates to
    // `unknown`, never silently `false`.
    condition: jsonb('condition'),
    // RUL-02 rule-record fields, grounding this one requirement's source
    // (distinct from `citation`, the pre-existing free-text grounding
    // string, which stays as the short human-readable reference).
    sourceUrl: text('source_url'),
    sourceTitle: text('source_title'),
    publisher: text('publisher'),
    // Bounded official extract/reference, kept separate from VisaStack's own
    // interpretation of it (directive §3) so a reader can always tell which
    // words are the government's and which are ours.
    officialExtract: text('official_extract'),
    interpretation: text('interpretation'),
    // Free text, deliberately -- no fixed taxonomy exists to draw an enum
    // from (matching `missions.serviceCategory`'s own precedent), though the
    // directive's own examples are "government," "consular," and
    // "service-provider."
    sourceType: text('source_type'),
    observedDate: timestamp('observed_date', { withTimezone: true }),
    authorAccountId: uuid('author_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    // Why this requirement's content changed from what a prior pack version
    // had for the same rule -- filled in only when authoring a revision.
    changeReason: text('change_reason'),
    // RUL-05 "source inaccessible state," scoped to this one citation --
    // distinct from `packVersions.withdrawnAt` (the whole version pulled for
    // cause). Set when an admin re-checks a source and finds it unreachable;
    // cleared if a later re-check succeeds.
    sourceInaccessibleAt: timestamp('source_inaccessible_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pack_requirements_version_idx').on(table.packVersionId)],
);

// NTF-01 (Part 5 §1): "Default expiry reminder thresholds: 90/60/30/7/expiry
// date. Make configurable by document type." One row per overridden
// `docType`; a `docType` with no row here uses `expiry.ts`'s
// `DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS`. Platform-admin-managed
// (`PACK_MANAGE`, the same concern that already owns pack/requirement
// content) - never per-organization, matching every other document-type
// vocabulary item in this schema (`packRequirements.docType`,
// `classifyDocumentText`'s output) being platform-global, not tenant-scoped.
export const documentExpiryPolicies = pgTable('document_expiry_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  docType: text('doc_type').notNull().unique(),
  thresholdDays: integer('threshold_days').array().notNull(),
  ...timestamps,
});

// --- Mission snapshots (immutable; Build Spec §4.3) -------------------------
export const missionSnapshots = pgTable(
  'mission_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: jsonb('content').notNull(),
    checksum: text('checksum').notNull(),
    // TRU-03 (master directive Part 7 §4): "snapshot creation must read
    // consistent material revision." A real, queryable column -- not buried
    // in `content`'s jsonb -- so a later staleness check (an
    // acknowledgement's own "does this still match the mission's current
    // revision," TRU-02) is a plain integer comparison, the same reasoning
    // every other compare-later value in this schema (`packVersions.version`,
    // `packRequirements.observedDate`, ...) already gets a real column for.
    // Nullable: a snapshot taken before this column existed recorded no
    // revision at all -- never assumed to be either current or stale.
    materialRevisionAtCapture: integer('material_revision_at_capture'),
    createdByAccountId: uuid('created_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('mission_snapshots_mission_version_unique').on(table.missionId, table.version),
  ],
);

// TRU-02 (master directive Part 7 §3): "Implement immutable acknowledgement
// record." Every applicant decision on a prepared file (acknowledge; reject;
// request correction) is its own row, created already-decided -- there is no
// PENDING state to propose in advance, unlike documentNameVersions' own
// propose-then-decide shape, since the applicant reviews the file and picks
// one of the three actions in a single step. "Immutable" describes every
// column below except `invalidatedAt`: a later material change can mark an
// ACKNOWLEDGED row invalid (TRU-03, Part 7 §4's "acknowledgement
// invalidation"), but nothing ever edits what this row says the actor
// actually attested to at the time -- see invalidatedAt's own comment.
export const acknowledgements = pgTable(
  'acknowledgements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    // "subject": the represented applicant -- IAM-04's own row already
    // established Applicant.id as the represented-subject half of "guardian/
    // delegate records both actor and represented applicant." Denormalized
    // off the mission rather than joined on every read, since a mission's
    // applicantId is fixed at creation and never changes.
    subjectApplicantId: uuid('subject_applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => missionSnapshots.id, { onDelete: 'restrict' }),
    // Denormalized copies of the snapshot's own checksum/revision AT THIS
    // ACKNOWLEDGEMENT'S MOMENT -- the same "store a tamper-evident copy on
    // the record itself" reasoning missionSnapshots.checksum already gets a
    // real column for, independent of whatever the referenced snapshot row
    // shows. This is also literally what "case material revision" (the
    // directive's own field name, distinct from "snapshot ID") means: the
    // value in force when THIS action was taken, permanent even if the
    // snapshot row's own materialRevisionAtCapture were ever inspected
    // alongside it.
    snapshotChecksum: text('snapshot_checksum').notNull(),
    caseMaterialRevision: integer('case_material_revision').notNull(),
    decision: acknowledgementDecision('decision').notNull(),
    // Required for REJECTED/CORRECTION_REQUESTED ("request correction +
    // reason"); optional for ACKNOWLEDGED (agreeing needs no explanation).
    reason: text('reason'),
    // "acknowledging actor": restrict, not set null -- every field on an
    // immutable attestation record must stay permanently attributable; an
    // anonymized actor would defeat the record's own purpose.
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    // "actor authority/representation": the applicant's own `relationship`
    // value AT THIS MOMENT, copied rather than joined, so a later edit to
    // the applicant's relationship can never retroactively change what this
    // record says the actor's authority was when they actually acted.
    actorAuthority: applicantRelationship('actor_authority').notNull(),
    // "acknowledgement-text version": see ACKNOWLEDGEMENT_TEXT_VERSION's own
    // doc comment (packages/services/src/acknowledgements.ts).
    textVersion: integer('text_version').notNull(),
    // "auth/assurance context": a server-recorded description of how step-up
    // was satisfied for this action, never a caller-supplied claim. jsonb
    // rather than a fixed column set, since this is the field most likely to
    // gain richer detail later (a specific session marker, an MFA method)
    // without another migration.
    authAssuranceContext: jsonb('auth_assurance_context').notNull(),
    // TRU-03 (Part 7 §4): "Material changes increment revision in the SAME
    // transaction as mutation AND acknowledgement invalidation." Set only by
    // material-revision.ts's incrementMaterialRevision, never by this
    // table's own service file -- a later material change on the mission
    // invalidates a live ACKNOWLEDGED row without editing any of the columns
    // above, preserving "immutable acknowledgement record" for everything
    // this action actually attested to; only the fact that something else
    // later happened is layered on top. Null means still valid, or not
    // applicable: REJECTED/CORRECTION_REQUESTED were never a valid green
    // light in the first place, so this stays null for them permanently.
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('acknowledgements_mission_idx').on(table.missionId),
    index('acknowledgements_snapshot_idx').on(table.snapshotId),
  ],
);

// TRU-04 (master directive Part 7 §7): "Export/download does NOT mean
// submitted." An attributable record of an ACTUAL external submission event
// the actor is reporting -- never inferred from an export/download/snapshot
// action itself, and never VisaStack claiming it observed an embassy action
// (directive's own explicit warning). `snapshotId` IS "packet reference;
// immutable packet ID" -- the directive's own two names for one thing a
// missionSnapshot already is (see `snapshotMission`'s own doc comment,
// "this snapshot IS the application packet"); no separate packet artifact is
// invented here. Append-only like `acknowledgements`/`missionDecisions`:
// deliberately NOT unique per mission, since a real correction cycle
// (directive §5) can lead to a genuine resubmission later.
export const missionSubmissions = pgTable(
  'mission_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => missionSnapshots.id, { onDelete: 'restrict' }),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    channel: missionSubmissionChannel('channel').notNull(),
    // "external report/source description": the actor's OWN account of how
    // they know submission happened -- e.g. "Confirmation email from
    // embassy portal, ref #12345." Required: an attributable report needs an
    // actual description, not just a channel code.
    externalReportDescription: text('external_report_description').notNull(),
    // An optional short machine/human reference the external channel gave
    // back (a confirmation number, a tracking code) -- distinct from the
    // free-text description above, kept separate so a UI can show it as its
    // own labelled field rather than parsing it back out of prose.
    externalReference: text('external_reference'),
    // When the actor reports the external submission actually happened --
    // caller-supplied (not always "now": a case may be recorded after the
    // fact) but never in the future (enforced in the service layer).
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    // Same shape/reasoning as acknowledgements.authAssuranceContext: a
    // server-built record of how step-up was satisfied, never caller input.
    authAssuranceContext: jsonb('auth_assurance_context').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mission_submissions_mission_idx').on(table.missionId),
    index('mission_submissions_snapshot_idx').on(table.snapshotId),
  ],
);

// TRU-04 (master directive Part 7 §8): "Store: decision date; optional
// restricted decision evidence; exact original wording where supplied;
// separate agency interpretation. Do not blend agency interpretation into
// official wording. No approval probability." Append-only like
// `acknowledgements`/`missionSubmissions`: a case can legitimately have more
// than one recorded outcome over its life (e.g. a refusal followed by a
// later resubmission's approval), and history is never rewritten.
export const missionOutcomes = pgTable(
  'mission_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    decision: missionOutcomeDecision('decision').notNull(),
    decisionDate: timestamp('decision_date', { withTimezone: true }).notNull(),
    // "exact original wording where supplied": verbatim, untouched text from
    // the actual decision communication -- never edited, summarized, or
    // combined with agencyInterpretation below.
    officialWording: text('official_wording'),
    // "separate agency interpretation": a structurally distinct column, not
    // a shared free-text field, so the two can never be blended (directive's
    // own explicit warning) -- a reader always knows which one they're
    // looking at.
    agencyInterpretation: text('agency_interpretation'),
    // "optional restricted decision evidence": reuses the existing evidence
    // vault (documents.ts) rather than inventing a second file-storage path
    // -- an outcome's supporting document (e.g. a scanned refusal letter) is
    // ordinary applicant evidence. `set null`, not `restrict`: an outcome
    // record is a historical fact worth keeping even if its one supporting
    // document is later legitimately erased (retention/erasure workflow).
    // "Restricted" is satisfied structurally: no function in this file
    // exposes this to any wider audience than the same owner-only access
    // every other mission function already requires.
    evidenceDocumentId: uuid('evidence_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    authAssuranceContext: jsonb('auth_assurance_context').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mission_outcomes_mission_idx').on(table.missionId)],
);

// TRU-04 (master directive Part 7 §9): "Case complaint: description; owner;
// status; history; resolution." RESOLVED/CLOSED are terminal, mirroring
// missionTaskStatus's own OPEN/IN_PROGRESS/terminal shape; IN_PROGRESS is an
// optional, skippable waypoint the same way it is for tasks.
export const caseComplaintStatus = pgEnum('case_complaint_status', [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
]);

export const caseComplaints = pgTable(
  'case_complaints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    // Who raised it -- the applicant/owner in every case this chunk builds
    // (fileComplaint is owner-only), kept as its own column rather than
    // reusing missions.applicantId's owner, since a complaint's filer is an
    // account, not an applicant record.
    filedByAccountId: uuid('filed_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    status: caseComplaintStatus('status').notNull().default('OPEN'),
    // "owner": who is CURRENTLY responsible for handling it -- distinct from
    // filedByAccountId above. Nullable/set-null: an unassigned or
    // since-deactivated owner never blocks the complaint's own lifecycle.
    ownerAccountId: uuid('owner_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    // Required (enforced in the service layer) only when status becomes
    // RESOLVED -- the directive's own separate "resolution" field, distinct
    // from the mutable status column itself.
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('case_complaints_mission_idx').on(table.missionId)],
);

// "history": an append-only transition log, modeled directly on
// `billingStatusHistory`'s own established shape -- a first-class,
// user-facing feature (what happened, when, by whom), not merely the
// internal audit log (which exists for a different, security/compliance
// purpose and is written alongside this, not instead of it).
export const caseComplaintEvents = pgTable(
  'case_complaint_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    complaintId: uuid('complaint_id')
      .notNull()
      .references(() => caseComplaints.id, { onDelete: 'cascade' }),
    fromStatus: caseComplaintStatus('from_status'),
    toStatus: caseComplaintStatus('to_status').notNull(),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('case_complaint_events_complaint_idx').on(table.complaintId)],
);

// TRU-04 (master directive Part 7 §9): "Private post-case feedback: tied to
// actual case; restricted authorized quality users." No rating/score column
// -- the directive names only "feedback," and inventing a numeric score
// edges toward the "ranking" concept the same sentence explicitly excludes
// from V1. Deliberately no organizationId/agency-facing read path anywhere
// in this schema or its service layer: an agency being reviewed must never
// see feedback about its own service, only QUALITY_ADMIN platform staff.
export const caseFeedback = pgTable(
  'case_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    submittedByAccountId: uuid('submitted_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    comments: text('comments').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('case_feedback_mission_idx').on(table.missionId)],
);

// --- Collaboration: assignments, notes, evidence requests (Build Spec §2; PRD §5)
// An org member is assigned to work a mission (still access-gated by grants).
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    memberAccountId: uuid('member_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('assignments_unique').on(table.organizationId, table.memberAccountId, table.missionId),
  ],
);

export const missionNotes = pgTable(
  'mission_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    authorAccountId: uuid('author_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    // Set only when the author wrote this note while acting as a member of
    // this organization (never for an applicant-owner-authored note). Lets
    // an AGENCY_INTERNAL note be attributed to exactly one organization, so
    // a second collaborating org's own internal notes stay distinguishable
    // from this one (Commercial V1 Part 4 §12: "AGENCY_INTERNAL must
    // include author organisation ID").
    authorOrganizationId: uuid('author_organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    visibility: missionNoteVisibility('visibility').notNull().default('AGENCY_INTERNAL'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mission_notes_mission_idx').on(table.missionId)],
);

// An org asks an applicant for a specific field or document type
// (Commercial V1 Part 4 §10). `missionId`/`packRequirementId`/`dueDate`
// stay nullable rather than required: an org whose only grant on this
// applicant is unscoped (applicant-wide, not mission-scoped) has always
// been able to raise a request with neither (`orgGrantPermits` itself
// treats an omitted mission as "applicant-wide"), a real, intentional
// capability this migration does not remove. When a mission IS named, it
// is now genuinely persisted (previously used only to check the grant,
// then discarded), so the request can actually be shown as belonging to
// that case, matching §10's "case" field.
export const evidenceRequests = pgTable(
  'evidence_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }),
    packRequirementId: uuid('pack_requirement_id').references(() => packRequirements.id, {
      onDelete: 'set null',
    }),
    // Nullable, not because a new request can omit it (the service layer
    // always sets it), but because a pre-existing row from before this
    // column existed has no requester to backfill.
    requestedByAccountId: uuid('requested_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    kind: requirementKind('kind').notNull(),
    fieldKey: text('field_key'),
    docType: text('doc_type'),
    message: text('message'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    status: evidenceRequestStatus('status').notNull().default('OPEN'),
    // The fact/document instance the applicant submitted in response,
    // exactly one at a time, enforced by the check constraint below.
    // Cleared (never left dangling) on a NEEDS_REPLACEMENT decision, since
    // the linked evidence is no longer what the request is currently
    // awaiting; the immutable decision history below is what actually
    // "retains prior decision/reason" (§13's exact wording), not this
    // current-state pointer.
    respondingFactId: uuid('responding_fact_id').references(() => facts.id, {
      onDelete: 'set null',
    }),
    respondingDocumentId: uuid('responding_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('evidence_requests_applicant_idx').on(table.applicantId),
    index('evidence_requests_mission_idx').on(table.missionId),
    check(
      'evidence_requests_at_most_one_response_target',
      sql`NOT (${table.respondingFactId} is not null AND ${table.respondingDocumentId} is not null)`,
    ),
  ],
);

// Append-only decision history on an evidence request (mirrors
// `missionDecisions`' own pattern exactly): the current decision is the
// latest row for a given evidenceRequestId. `respondingFactId`/
// `respondingDocumentId` are an immutable SNAPSHOT of what was actually
// being decided on at that moment, independent of the parent request's own
// current pointer (which a later NEEDS_REPLACEMENT decision clears); this
// is what makes "replacement retains prior decision/reason" (Part 4 §13)
// genuinely true rather than only true until the next submission overwrites it.
export const evidenceRequestDecisions = pgTable(
  'evidence_request_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evidenceRequestId: uuid('evidence_request_id')
      .notNull()
      .references(() => evidenceRequests.id, { onDelete: 'cascade' }),
    outcome: evidenceRequestDecisionOutcome('outcome').notNull(),
    reason: text('reason'),
    respondingFactId: uuid('responding_fact_id').references(() => facts.id, {
      onDelete: 'set null',
    }),
    respondingDocumentId: uuid('responding_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    decidedByAccountId: uuid('decided_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('evidence_request_decisions_request_idx').on(table.evidenceRequestId)],
);

// CAS-08 ("Contributor request"): a narrow, single-use, seven-day invitation
// letting a named third party (a sponsor, a family member) who is NOT the
// applicant submit exactly one named piece of evidence for one case,
// without ever browsing the applicant's wallet, profile, or case. Reuses
// the same hashed-token primitive as organizationInvitations/
// clientInvitations (invitation-tokens.ts); unlike clientInvitations
// (IAM-03, deliberately anonymous-until-accept), this one DOES verify the
// contributor's own authenticated email against contributorEmail at
// submission time, matching organizationInvitations -- the PRD's own
// "email verification binds the contributor" is explicit where IAM-03's
// text is explicitly silent on it.
export const contributorRequests = pgTable(
  'contributor_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    // Denormalized from missionId (matches evidenceRequests' own choice):
    // every authorization check here is naturally applicant-shaped (owner
    // check, wallet-visibility), so this avoids a join on every one of them.
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    requestedByAccountId: uuid('requested_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    contributorEmail: text('contributor_email').notNull(),
    // Always a document (a third party has no fields in the applicant's own
    // profile to fill in) -- "narrow named request only" -- never nullable,
    // unlike evidenceRequests.docType which only applies to its DOCUMENT
    // branch.
    docType: text('doc_type').notNull(),
    // Shown to the contributor before upload, per CAS-08's "sees purpose...
    // before upload."
    purpose: text('purpose').notNull(),
    message: text('message'),
    tokenHash: text('token_hash').notNull().unique(),
    status: contributorRequestStatus('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // The contributor's own explicit choice, defaulting to false (PRD: "not
    // copied into the traveller's reusable wallet WITHOUT contributor
    // permission"). Read by documents.walletVisible at submission time and
    // never changed afterward -- it is the contributor's call, not the
    // applicant's to later override.
    allowWalletReuse: boolean('allow_wallet_reuse').notNull().default(false),
    // Bound the moment a submission attempt begins (PENDING -> SUBMITTED),
    // re-verified on every subsequent check -- see
    // contributor-requests.ts's isInFlightContributorSubmission.
    contributorAccountId: uuid('contributor_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    submittedDocumentId: uuid('submitted_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('contributor_requests_mission_idx').on(table.missionId),
    index('contributor_requests_applicant_idx').on(table.applicantId),
  ],
);

// A mission owner's explicit choice of which fact/document instance
// satisfies a given requirement (master directive §7 "PR 10" — "exact
// selected evidence"; readiness/snapshots must ignore unselected evidence
// once a mission has any selections at all). Exactly one of factId/
// documentId is set, matching the requirement's kind.
export const selectedEvidence = pgTable(
  'selected_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    packRequirementId: uuid('pack_requirement_id')
      .notNull()
      .references(() => packRequirements.id, { onDelete: 'cascade' }),
    factId: uuid('fact_id').references(() => facts.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    selectedByAccountId: uuid('selected_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('selected_evidence_requirement_fact_unique').on(
      table.missionId,
      table.packRequirementId,
      table.factId,
    ),
    unique('selected_evidence_requirement_document_unique').on(
      table.missionId,
      table.packRequirementId,
      table.documentId,
    ),
    index('selected_evidence_mission_idx').on(table.missionId),
    // Backstops the doc comment above ("exactly one of factId/documentId")
    // at the database level, previously only true by construction (the two
    // mutually-exclusive branches inside `selectEvidence`), not enforced.
    check(
      'selected_evidence_exactly_one_target',
      sql`(${table.factId} is not null) <> (${table.documentId} is not null)`,
    ),
  ],
);

// A reviewer's decision on a specific requirement's selected evidence.
// Append-only like every other decision-history table in this schema (fact
// versions, naming versions, correction feedback) — the current decision is
// the latest row for a given (missionId, packRequirementId).
export const missionDecisions = pgTable(
  'mission_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    packRequirementId: uuid('pack_requirement_id')
      .notNull()
      .references(() => packRequirements.id, { onDelete: 'cascade' }),
    outcome: missionDecisionOutcome('outcome').notNull(),
    reason: text('reason'),
    // restrict, not set null: this column is NOT NULL, so set null would
    // fail the FK action outright on delete.
    decidedByAccountId: uuid('decided_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mission_decisions_mission_idx').on(table.missionId)],
);

// A lightweight, assignable checklist item scoped to a mission — distinct
// from evidenceRequests (an applicant-facing ask) and assignments (a
// blanket mission-level assignment): a task is a specific, completable unit
// of work, optionally tied to one requirement.
export const missionTasks = pgTable(
  'mission_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    packRequirementId: uuid('pack_requirement_id').references(() => packRequirements.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    assigneeAccountId: uuid('assignee_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    status: missionTaskStatus('status').notNull().default('OPEN'),
    // CAS-02's workspace "overdue tasks" signal needs this to exist at all;
    // nullable, since not every task has (or needs) a deadline.
    dueDate: timestamp('due_date', { withTimezone: true }),
    // The IANA zone the due date/time was set in (Commercial V1 Part 4 §11:
    // "explicit timezone"), e.g. "Asia/Dhaka" -- `dueDate` itself is a
    // `timestamptz`, always interpretable in UTC, but doesn't by itself
    // record which zone a human meant when they set it, the way a display
    // like "5pm" needs to know to render correctly. Nullable: not every task
    // carries a due date at all.
    dueTimezone: text('due_timezone'),
    priority: taskPriority('priority').notNull().default('NORMAL'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('mission_tasks_mission_idx').on(table.missionId)],
);

// Commercial V1 Part 4 §11's distinct "Appointment" concept: unlike a task
// (a completable checklist item), an appointment is a scheduled meeting at a
// specific local date/time, place or channel, exportable to the traveller's
// own calendar. Deliberately its own table, not a `kind` discriminator on
// `missionTasks`: an appointment's defining fields (local wall-clock time,
// timezone, place/channel) have no task equivalent, and forcing them onto
// the same row would make every plain checklist task carry nullable
// appointment-only columns for no benefit.
export const missionAppointments = pgTable(
  'mission_appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    assigneeAccountId: uuid('assignee_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    // The literal wall-clock date/time the appointment is AT, in `timezone`
    // below -- deliberately a timezone-naive `timestamp` (never `timestamptz`,
    // which would silently normalize and could shift the displayed local
    // time under a session/connection timezone change). "9am" stays "9am".
    // Relies on the Node process's own local timezone being UTC on both
    // write and read (true of this app's deployment target and every CI/dev
    // environment this codebase runs in) -- `pg`'s driver parses/formats a
    // timezone-naive column using the process's local zone, so a non-UTC
    // process would silently shift this value. `services/src/missions.ts`'s
    // `createAppointment`/`updateAppointment` never do their own zone math on
    // it either, for the same reason: it is passed straight through as the
    // wall-clock string it already is.
    localDateTime: timestamp('local_date_time', { withTimezone: false }).notNull(),
    // IANA zone name (e.g. "Asia/Dhaka") `localDateTime` is expressed in --
    // required, per §11's explicit "timezone" field, never inferred.
    timezone: text('timezone').notNull(),
    place: text('place'),
    channel: text('channel'),
    status: missionTaskStatus('status').notNull().default('OPEN'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('mission_appointments_mission_idx').on(table.missionId)],
);

// A generated, grounded document (currently: cover letters only) —
// versioned, never overwritten. `groundedReferences` cites the exact
// FactVersion/DocumentVersion ids every claim in `content` traces back to
// (master directive §7 "PR 10" — nothing may be invented). Translation
// provenance plumbing only: `translatedFromOutputId` is a plain uuid (no FK,
// matching the codebase's established self-reference pattern, e.g.
// ai_extraction_runs.served_from_cache_run_id) so a future translation
// feature has somewhere to record provenance without a schema change — no
// translation is actually generated yet.
export const generatedOutputs = pgTable(
  'generated_outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    kind: generatedOutputKind('kind').notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    groundedReferences: jsonb('grounded_references').notNull(),
    language: text('language').notNull().default('en'),
    translatedFromOutputId: uuid('translated_from_output_id'),
    createdByAccountId: uuid('created_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('generated_outputs_mission_kind_version_unique').on(
      table.missionId,
      table.kind,
      table.version,
    ),
    index('generated_outputs_mission_idx').on(table.missionId),
  ],
);

// --- Retention & legal hold (Build Spec §13; PRD §5) -----------------------
// A legal hold on an applicant blocks erasure while active (overrides deletion).
export const legalHolds = pgTable(
  'legal_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    // Directive Part 7 §13 ("Hold needs... exact scope"). Both null (the
    // default) means applicant-wide, exactly today's only behavior. At most
    // one of the two is ever set -- enforced by `placeLegalHold`, not a SQL
    // CHECK constraint, matching this codebase's established preference for
    // app-level invariants on nullable-alternative columns. `onDelete:
    // 'cascade'` on both (rather than 'set null'): a hold whose target
    // mission/document is gone must disappear with it, never silently
    // widen into an applicant-wide hold it was never meant to be.
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    placedByAccountId: uuid('placed_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    // Directive Part 7 §13 ("Legal holds"): a hold "needs... review/expiry"
    // and "cannot become indefinite convenience." Nullable rather than
    // NOT NULL: a real pre-existing hold in production cannot be given a
    // fabricated review date by this migration, so `placeLegalHold` (the
    // service layer) requires it for every NEW hold going forward instead of
    // the DB enforcing it retroactively. A hold with no review date set is
    // treated as needing attention just as much as one whose date has
    // passed (`listLegalHoldsNeedingReview`), never silently excluded.
    reviewAt: timestamp('review_at', { withTimezone: true }),
    // Directive Part 7 §13 ("any scheduled reminder when a hold becomes
    // due"). Nullable, and re-set on every reminder actually sent (not a
    // one-time flag) -- a hold left unreviewed for months must keep nudging
    // a compliance admin, not fall silent after a single unread email,
    // which would recreate the exact "indefinite convenience" the review
    // date itself exists to prevent.
    lastReviewReminderAt: timestamp('last_review_reminder_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('legal_holds_applicant_idx').on(table.applicantId),
    index('legal_holds_mission_idx').on(table.missionId),
    index('legal_holds_document_idx').on(table.documentId),
  ],
);

// Retention policy per document type: how long to keep before eligible purge.
export const retentionPolicies = pgTable('retention_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  docType: text('doc_type').notNull().unique(),
  retentionDays: integer('retention_days').notNull(),
  ...timestamps,
});

// --- Blob store (Neon-bytea storage backend; Build Spec §7) -----------------
// Encrypted-at-rest bytes for a stored object, keyed by its opaque object key
// (never the display filename). This is the no-external-dependency storage
// backend; an S3 adapter can replace it behind the same StoragePort (ADR-0011).
export const storageBlobs = pgTable('storage_blobs', {
  objectKey: text('object_key').primaryKey(),
  bucket: storageBucket('bucket').notNull(),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Account deletion workflow (Build Spec §13; PRD §2) ---------------------
// A deletion request is reversible during a grace window and executed after it.
// accountId is set null on execution so the request survives as a tombstone.
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    status: deletionStatus('status').notNull().default('PENDING'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    reason: text('reason'),
    ...timestamps,
  },
  (table) => [
    // Backstops `requestAccountDeletion`'s own pre-check (deletion.ts),
    // which reads then inserts in two separate statements, not one atomic
    // operation, a true concurrent race could otherwise open two PENDING
    // requests for the same account. Mirrors `pilot_invitations_active_unique_idx`.
    uniqueIndex('account_deletion_requests_pending_unique_idx')
      .on(table.accountId)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

// --- Erasure outbox (master directive §7 "PR 4") ----------------------------
// Durable, retriable record of every external-object deletion the domain
// still owes. Deliberately decoupled from `processingJobs` — a distinct
// low-volume queue for a distinct concern, not a premature generalization
// (a unified job-queue mechanism, if warranted, is PR 6's explicit scope).
// Denormalized (bucket/objectKey/expectedHash copied onto the row, and
// documentId/applicantId are plain uuids, not FKs) for the same reason
// `auditEvents.actorAccountId` is a plain uuid: a job must remain fully
// actionable — and its history fully readable — after the domain rows it
// started from are gone. `documentId`/`applicantId` are populated for
// RETENTION_PURGE (the worker defers the document's own removal until the
// bytes are verified gone, and rechecks the hold at that point — closing the
// same race `hasActiveLegalHold` prevents elsewhere) and are informational
// only for ACCOUNT_DELETION (whose applicant is already gone by the time the
// job is created; the account-level hold check happens up front instead).
export const erasureJobs = pgTable(
  'erasure_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reason: erasureJobReason('reason').notNull(),
    status: erasureJobStatus('status').notNull().default('PENDING'),
    bucket: storageBucket('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    expectedHash: text('expected_hash'),
    storageObjectId: uuid('storage_object_id').notNull(),
    documentId: uuid('document_id'),
    applicantId: uuid('applicant_id'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    // Leasing (Codex review, PR-B1; mirrors processingJobs' proven pattern):
    // non-null exactly while a worker holds this job (status CLAIMED or
    // DELETED). leaseOwner is a per-claim-invocation fencing token — every
    // write past the initial claim is compare-and-set on (id, status,
    // lease_owner), so a worker that outlives its own lease can never
    // stomp whichever invocation reclaimed the job next.
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Set once, immediately BEFORE the BlobStore.deleteObject() call is made
    // — deliberately before, not after it returns — and never cleared
    // afterward (Codex review, PR-B2, round 4 and round 5). `status` alone
    // can't answer "was a delete for this object ever attempted" once a job
    // has been retried past DELETED: a lying-delete retry and a plain
    // verification hiccup both land back at the same PENDING/FAILED status
    // with no way to tell them apart (round 4). Setting the marker only
    // AFTER a confirmed-successful deleteObject call (round 4's original
    // design) left a second, narrower gap of its own (round 5): if the
    // call succeeds but the CAS-to-DELETED write that would have recorded
    // it then throws (an infra failure, not a domain one), the job can be
    // sent back to PENDING/FAILED with no durable record a delete was ever
    // attempted. Writing this marker first, in its own committed statement,
    // closes that window — we can never safely distinguish "deleteObject
    // wasn't reached" from "it was reached and either the response or the
    // follow-up write was lost," so the conservative, correct assumption is
    // the same one that already governs the CLAIMED half of
    // erasureInProgressOrBytesGone(): once an attempt starts, treat the
    // bytes as gone, permanently, even if the attempt or the bookkeeping
    // that would confirm it fails.
    deletionAttemptedAt: timestamp('deletion_attempted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    index('erasure_jobs_status_available_idx').on(table.status, table.availableAt),
    index('erasure_jobs_storage_object_idx').on(table.storageObjectId),
    index('erasure_jobs_lease_expires_idx').on(table.status, table.leaseExpiresAt),
    // Backstops `enqueueErasureJob`'s own existence check (erasure.ts), which
    // by its own admission adds no locking primitive of its own: at most one
    // job per storage object may be anywhere short of VERIFIED at a time,
    // matching that function's exact IN_FLIGHT+PARKED status set. Mirrors
    // `pilot_invitations_active_unique_idx`'s same role for invitations.
    uniqueIndex('erasure_jobs_active_storage_object_unique_idx')
      .on(table.storageObjectId)
      .where(sql`${table.status} <> 'VERIFIED'`),
  ],
);

export const accountExportJobStatus = pgEnum('account_export_job_status', [
  'PENDING',
  'CLAIMED',
  'READY',
  'FAILED',
  'EXPIRED',
]);

// --- Account export jobs (PRV-04, master directive Part 7 §14 "Large
// export") ------------------------------------------------------------------
// The async, durable counterpart to exportAccount's existing synchronous
// JSON/CSV export -- bundles that same data (and, once a later chunk adds
// it, original document bytes) into one encrypted artifact, held transiently
// in the same BlobStore real documents use (bucket/objectKey below) for at
// most ACCOUNT_EXPORT_ARTIFACT_HOURS. Mirrors erasureJobs' own lease/claim/
// backoff shape closely, with two states erasure never needed: READY
// (bundling and encryption complete, artifact downloadable until expiresAt)
// and EXPIRED (was READY, now past expiresAt; bytes purged by the sweep).
export const accountExportJobs = pgTable(
  'account_export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // `set null`, not `cascade`: an account deleted while its own export job
    // is still PENDING/CLAIMED/READY must not silently orphan the encrypted
    // artifact this row is the only pointer to -- a cascade delete would
    // remove the row, and with it the one pointer to the blob, before
    // anything ever calls BlobStore.deleteObject on it. The expiry sweep
    // (account-export.ts) treats a null accountId as immediately eligible
    // for cleanup regardless of expiresAt, closing that gap without needing
    // any change to account deletion itself.
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    status: accountExportJobStatus('status').notNull().default('PENDING'),
    // Null until a worker actually produces the artifact (READY); denormalized
    // onto the row like erasureJobs' own bucket/objectKey, for the same
    // reason -- this row must remain fully actionable (and its own history
    // fully readable) independent of anything else.
    bucket: storageBucket('bucket'),
    objectKey: text('object_key'),
    // AES-256-GCM nonce/key-version for the artifact at objectKey, set
    // together with it. Never the data key itself -- see
    // packages/services/src/protected-fields.ts's protectBytes/revealBytes
    // and its own envelope-encryption doc comment.
    encryptionNonce: bytea('encryption_nonce'),
    encryptionKeyVersion: text('encryption_key_version'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    index('account_export_jobs_status_available_idx').on(table.status, table.availableAt),
    index('account_export_jobs_account_idx').on(table.accountId),
    index('account_export_jobs_status_expires_idx').on(table.status, table.expiresAt),
  ],
);

// --- Platform administration (master directive §7 "PR 5") ------------------
// Replaces an env-var allowlist (ADMIN_EMAILS) as the authority for
// platform-level actions. Immutable and append-only: a grant is never
// updated or deleted, only revoked (revokedAt/revokedByAccountId/reason
// set); re-granting after revocation creates a new row, so the full history
// of who held what, when, and why is always reconstructable — the audit log
// records the transition, this table is the durable state itself.
// `workosUserId` is a point-in-time snapshot of the identity actually
// verified at grant time, independent of the account row's current value.
export const platformRoles = pgTable(
  'platform_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable + `set null` (not `cascade`): deleting an account must not
    // erase the append-only role-history invariant this table exists to
    // preserve (docs/audits/post-programme-defect-register.md finding #17) —
    // the same anonymize-don't-delete pattern already used for
    // `missionNotes.authorAccountId` and every other actor/author reference
    // in this schema. `workosUserId` below is the durable point-in-time
    // identity snapshot that survives alongside the nulled account id.
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    workosUserId: text('workos_user_id'),
    role: platformRole('role').notNull(),
    assignedByAccountId: uuid('assigned_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByAccountId: uuid('revoked_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    index('platform_roles_account_idx').on(table.accountId),
    index('platform_roles_active_idx').on(table.accountId, table.revokedAt),
    // Enforces "at most one active grant per (account, role)" at the database
    // level — the application-layer idempotency check in `grantPlatformRole`
    // alone cannot close the race where two concurrent grants both pass the
    // pre-insert check before either commits. Without this, revoking one of
    // two duplicate active rows reports success while the other continues
    // granting the same authority (Codex review, PR #65). Scoped to
    // `revokedAt IS NULL` only — once `deletion.ts` revokes a grant as part
    // of account deletion, that historical row never conflicts with a fresh
    // grant later issued to a different account.
    uniqueIndex('platform_roles_active_unique_idx')
      .on(table.accountId, table.role)
      .where(sql`${table.revokedAt} is null`),
  ],
);

// --- Pilot invitations (controlled-pilot access boundary) -------------------
// Server-authoritative gate on NEW account provisioning while the deployment
// runs in controlled-pilot mode (docs/audits/post-programme-defect-register.md
// finding #2): an authenticated WorkOS identity is only ever materialized
// into a local account (`@visastack/services`'s `checkPilotAccess`, called
// from `withSession` before `provisionAccount`) if its email has an active
// (non-revoked) invitation here, or an account already exists for it —
// existing accounts are never retroactively locked out by a later
// revocation, since this is a provisioning-time boundary, not a continuous
// access gate. Append-only and audited like every other administrative grant
// in this schema: revoking never deletes the row, so the full history of who
// was invited, by whom, and why is always reconstructable.
export const pilotInvitations = pgTable(
  'pilot_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Always stored lowercased/trimmed by the service layer — matched
    // case-insensitively against the WorkOS-reported email at provisioning
    // time. Email is intentionally not treated as an immutable identity: it
    // only ever gates the FIRST provisioning, never re-checked afterward.
    email: text('email').notNull(),
    invitedByAccountId: uuid('invited_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByAccountId: uuid('revoked_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    revokedReason: text('revoked_reason'),
    // Set once this invitation is actually consumed by a successful
    // provisioning — kept even after the invitation is later revoked, so the
    // audit trail shows exactly which invitation admitted which account.
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedAccountId: uuid('accepted_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('pilot_invitations_email_idx').on(table.email),
    // Enforces "at most one still-pending invitation per email" at the
    // database level — the application-layer idempotency check in
    // `createInvitation` alone cannot close the race where two concurrent
    // calls both pass the pre-insert check before either commits (Codex
    // review, PR #65). "Active" here matches `findActiveInvitation`'s own
    // definition: not revoked AND not yet accepted — an already-consumed
    // invitation is historical, not a live duplicate to guard against, so a
    // genuine re-invite after that account is gone can still insert a fresh
    // row.
    uniqueIndex('pilot_invitations_active_unique_idx')
      .on(table.email)
      .where(sql`${table.revokedAt} is null and ${table.acceptedAt} is null`),
  ],
);

// --- Rate limiting (Build Spec §14 — usage controls / anti-automation) -----
// Fixed-window counters keyed by (subject, action, windowStart). One row per
// account per action per window; `count` is incremented atomically via
// upsert, so this never needs a separate lock or an external store (Redis) —
// consistent with the no-external-dependency posture used elsewhere (e.g. the
// Neon-bytea blob store). Bounded, not unbounded: rows are naturally
// deduplicated to at most one per subject/action/window, and cheap to prune.
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id').notNull(),
    action: text('action').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('rate_limit_buckets_subject_action_window').on(
      table.subjectId,
      table.action,
      table.windowStart,
    ),
  ],
);

// --- Pilot product events (Build Spec §14/§23-25 — privacy-preserving usage
// measurement) ----------------------------------------------------------
// A minimal, append-only funnel event log: which known milestone happened,
// when, and by which account — never a free-text property bag, so it can
// never accidentally carry PII. `accountId` is the same opaque identifier
// already used throughout the audit trail, not a new identifier.
export const productEvents = pgTable(
  'product_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    // OPS-04 (Part 9 section 10): the organization the event happened inside,
    // where there is one (agency repeat use, plan usage, cash collection). An
    // opaque id, never a name; cleared if the organization is ever deleted, the
    // same way `account_id` is.
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    // A closed-vocabulary label (a case stage, an outcome, an AI task kind, a
    // currency code). The CHECK below admits only UPPER_SNAKE tokens, which
    // cannot hold a name, an email address or a sentence, so refusal wording,
    // medical detail or any other free text cannot reach analytics by this
    // column even through a coding mistake.
    dimension: text('dimension'),
    // A measured quantity: seconds, a count, or minor currency units.
    metricValue: bigint('metric_value', { mode: 'number' }),
    // Makes a once-only event (a task becoming overdue, an account being
    // activated) safe to record on every pass: a SHA-256 of the event type and
    // the entity's id, so the id itself is never stored here.
    dedupeKey: text('dedupe_key'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('product_events_type_time_idx').on(table.eventType, table.occurredAt),
    index('product_events_org_time_idx').on(table.organizationId, table.occurredAt),
    uniqueIndex('product_events_dedupe_key_uidx').on(table.dedupeKey),
    check(
      'product_events_dimension_token',
      sql`${table.dimension} is null or ${table.dimension} ~ '^[A-Z][A-Z0-9_]{0,39}$'`,
    ),
    check(
      'product_events_metric_non_negative',
      sql`${table.metricValue} is null or ${table.metricValue} >= 0`,
    ),
  ],
);

// --- Notification outbox (NTF-02/§3, Part 5) --------------------------------
// A transactional outbox: `notifications.ts`'s `enqueueNotification` is
// always called from inside the SAME transaction as the domain change it
// reports on ("domain change and outbox entry commit together"), and a
// separate worker (`runNotificationWorker`) claims and dispatches rows
// later, asynchronously. `eventType` is free text (matching `auditEvents`'
// own convention), not an enum — the vocabulary of notification-worthy
// events grows without a schema migration per addition. `channel` and
// `status`, by contrast, are small, stable, structural sets, so they ARE
// enums, matching `requirementKind`/`packVersionStatus` above.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    channel: notificationChannel('channel').notNull(),
    // Composed by `notifications.ts` from event + recipient + channel +
    // resource + threshold ("idempotency key including: event; recipient;
    // channel; threshold where applicable") — the UNIQUE constraint below is
    // what actually makes both enqueueing and delivery idempotent.
    idempotencyKey: text('idempotency_key').notNull(),
    // An existing account (the common case) OR a not-yet-registered
    // invitee's email (e.g. an organization invitation) — never both unset,
    // enforced below. `recipientAccountId` is the intended recipient AT
    // ENQUEUE TIME; `runNotificationWorker` re-verifies this account is
    // STILL authorized to receive it at SEND TIME ("Recipients must be
    // authorized at SEND TIME, not merely at event creation"), never trusts
    // this column alone.
    recipientAccountId: uuid('recipient_account_id').references(() => accounts.id, {
      onDelete: 'cascade',
    }),
    recipientEmail: text('recipient_email'),
    // Resource context for re-authorization at send time and for the
    // payload's deep link. Nullable: not every event touches every kind of
    // resource.
    applicantId: uuid('applicant_id').references(() => applicants.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }),
    // The domain object driving this notification (e.g. a task, appointment,
    // or evidence-request-decision id) -- already folded into
    // `idempotencyKey` since NTF-02's original design, but not previously
    // its own queryable column. Part 5 §4's obsolete-notice cancellation
    // needs exactly this: "all still-QUEUED rows for resource X," which
    // `idempotencyKey`'s composed string can't answer without parsing it.
    // No FK: a resource id here can point at any of several unrelated
    // tables depending on `eventType` (mirrors `auditEvents.resourceId`'s
    // own plain-text, non-FK convention for the identical reason).
    resourceId: text('resource_id'),
    // Neutral, minimal message content + a relative deep-link path only
    // ("Email content: neutral; minimal; authenticated deep link." / "Never
    // include: passport number; financial details; medical details; refusal
    // narrative.") — never the underlying sensitive record itself.
    payload: jsonb('payload').notNull(),
    status: notificationDeliveryStatus('status').notNull().default('QUEUED'),
    attempts: integer('attempts').notNull().default(0),
    // "Retries: transient only; maximum 5; spread over 24 hours with backoff."
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    // Claim fields, deliberately NOT part of `status` (the directive's six
    // delivery states are exhaustive and final — adding a seventh "CLAIMED"
    // state would be inventing one): `runNotificationWorker` claims a batch
    // of QUEUED rows with `SELECT ... FOR UPDATE SKIP LOCKED` inside one
    // short transaction (mirrors `erasureJobs`' own `leaseOwner` pattern),
    // stamps these two fields, and commits that claim separately from the
    // dispatch itself — so a row lock is never held across an outbound email
    // call. A lease that outlives `leaseExpiresAt` (a crashed worker) is
    // simply eligible to be claimed again; still QUEUED throughout.
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastError: text('last_error'),
    // NTF-03 (Part 5 §5): the email provider's own id for this exact send,
    // set when `status` first becomes SENT via the EMAIL channel. The one
    // thing a delivery/bounce webhook carries that can correlate its event
    // back to this row -- never set for IN_APP.
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('notifications_idempotency_unique').on(table.idempotencyKey),
    index('notifications_dispatch_idx').on(table.status, table.nextAttemptAt),
    index('notifications_recipient_idx').on(table.recipientAccountId),
    index('notifications_provider_message_idx').on(table.providerMessageId),
    index('notifications_resource_idx').on(table.resourceId, table.status),
    check(
      'notifications_recipient_present',
      sql`${table.recipientAccountId} is not null or ${table.recipientEmail} is not null`,
    ),
  ],
);

// --- Commerce: plans and subscriptions (Commercial V1 COM-01, Part 5 §6) ---
// "Entitlements are data, not hardcoded UI conditions." A plan's own numeric
// columns ARE its entitlements -- no separate normalized "entitlements"
// table exists because there is nothing left to normalize: every
// entitlement belongs to exactly one plan. `key` is free text, not a closed
// enum, despite exactly three seeded rows today (traveller_free,
// agency_starter, agency_pro) -- the catalog itself must stay genuinely
// data-driven, so a product owner can add a fourth plan as a data row,
// never a migration.
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    // Offered/assignable right now. Retiring a plan means false, never a
    // delete -- a subscription already on a retired plan keeps its own
    // entitlements unchanged; `activateSubscription` refuses to assign it to
    // anyone new.
    active: boolean('active').notNull().default(true),
    // Every entitlement is nullable; NULL means unlimited/no cap, never zero
    // -- a distinction "Show each meter and its definition" depends on (a
    // bare number can't tell "0 allowed" from "no ceiling").
    seatsAllowed: integer('seats_allowed'),
    casesPerPeriodAllowed: integer('cases_per_period_allowed'),
    concurrentOpenCasesAllowed: integer('concurrent_open_cases_allowed'),
    storageBytesAllowed: bigint('storage_bytes_allowed', { mode: 'number' }),
    // Same cost-unit system `aiExtractionRuns.costUnits` already uses --
    // never a second, incompatible unit definition for the same quantity.
    aiAllowanceUnitsAllowed: integer('ai_allowance_units_allowed'),
    // Rolling window length backing casesPerPeriodAllowed and
    // aiAllowanceUnitsAllowed ("cases created per billing period"). A
    // provisional, honestly-labeled placeholder -- COM-03's real
    // billing-cycle dates do not exist yet; see plans.ts's own doc comment.
    periodDays: integer('period_days').notNull().default(30),
    // Configuration (the product owner's listed price), never itself a
    // record of cash collected -- COM-03's future billing records own that
    // distinction ("never equate proposal/commitment/invoice with collected
    // cash"). Both null together (Traveller Free) or both set together.
    priceMinorUnits: integer('price_minor_units'),
    currency: text('currency'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('plans_key_unique').on(table.key),
    check(
      'plans_price_currency_together',
      sql`(${table.priceMinorUnits} is null) = (${table.currency} is null)`,
    ),
  ],
);

// One organization's plan assignment over time -- "manually activated,"
// never self-serve (master directive §7 "PR 11"'s own "no payment provider"
// posture; NullPaymentPort). Traveller Free needs no row here at all: it is
// the implicit default for any individual account with no organization
// context (plans.ts's own `getPlanByKey(db, TRAVELLER_FREE_PLAN_KEY)`),
// since every traveller starts on it automatically and there is no
// self-upgrade path yet. An organization, by contrast, has NO entitlements
// at all until a
// platform owner explicitly assigns one -- genuinely zero, never a silent
// free-tier fallback, since agency work requires real capacity a free
// traveller plan was never sized for.
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    // NULL = this is the organization's CURRENT subscription. Set the
    // instant a new one is activated for the same org (activateSubscription
    // does both atomically) -- a "plan change" is always real history, never
    // an overwritten row.
    endedAt: timestamp('ended_at', { withTimezone: true }),
    assignedByAccountId: uuid('assigned_by_account_id')
      .notNull()
      .references(() => accounts.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('subscriptions_organization_idx').on(table.organizationId),
    // At most one CURRENT subscription per organization -- the database
    // itself makes "the" current plan unambiguous, never a query-time
    // ORDER BY/LIMIT 1 guess across concurrent activations.
    uniqueIndex('subscriptions_one_current_per_org')
      .on(table.organizationId)
      .where(sql`${table.endedAt} is null`),
  ],
);

// --- Commerce: scheduled downgrades (Commercial V1 COM-02, Part 5 §7) ---
// "Downgrade: effective dates; warning/grace; blocks NEW capacity use after
// grace; deletes nothing" (master directive). `activateSubscription` above
// is an immediate cutover -- this is the separate, explicitly-scheduled
// path: a plan change that takes effect at a caller-chosen future
// `effectiveAt`, giving the organization a warning period before its
// capacity actually shrinks. At most one PENDING row per organization
// (mirrors `accountDeletionRequests`' own "at most one PENDING request"
// shape). "Blocks NEW capacity use after grace" costs nothing extra here --
// once `executeScheduledDowngrade` (plans.ts) flips the org's current
// subscription to the lower plan, `entitlement-enforcement.ts`'s existing
// checks naturally start comparing against it. "Deletes nothing" is
// likewise structural: nothing in this table or its execution path ever
// removes a seat, case, or document -- an organization already over its new
// plan's cap simply cannot consume more until it is back under, same as any
// other over-cap organization today.
export const downgradeStatus = pgEnum('downgrade_status', ['PENDING', 'CANCELLED', 'EXECUTED']);

export const scheduledDowngrades = pgTable(
  'scheduled_downgrades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // Snapshots of both ends of the change, for audit/display -- neither is
    // "the truth" at read time (`getCurrentPlanForOrganization` always is);
    // these record what was true when the downgrade was scheduled.
    fromPlanId: uuid('from_plan_id')
      .notNull()
      .references(() => plans.id),
    toPlanId: uuid('to_plan_id')
      .notNull()
      .references(() => plans.id),
    status: downgradeStatus('status').notNull().default('PENDING'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    requestedByAccountId: uuid('requested_by_account_id')
      .notNull()
      .references(() => accounts.id),
    reason: text('reason').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByAccountId: uuid('cancelled_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    cancelledReason: text('cancelled_reason'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('scheduled_downgrades_organization_idx').on(table.organizationId),
    // The sweep's own "what's due" query (listDueDowngrades) filters on
    // exactly these two columns together.
    index('scheduled_downgrades_status_effective_idx').on(table.status, table.effectiveAt),
    // Backstops scheduleDowngrade's own pre-check the same way
    // account_deletion_requests_pending_unique_idx backstops
    // requestAccountDeletion's -- a true concurrent race could otherwise
    // open two PENDING downgrades for the same organization.
    uniqueIndex('scheduled_downgrades_pending_unique_idx')
      .on(table.organizationId)
      .where(sql`${table.status} = 'PENDING'`),
    check(
      'scheduled_downgrades_effective_after_requested',
      sql`${table.effectiveAt} > ${table.requestedAt}`,
    ),
  ],
);

// --- Commercial override (Commercial V1 COM-02, Part 5 §7) -----------------
// "Platform admin; reason; expiry; audit; cannot bypass security/consent/
// release gates" (master directive). Modeled directly on `supportGrants`
// above -- a scoped, time-limited, reasoned, revocable grant -- but scoped to
// an ORGANIZATION's commercial entitlements rather than an applicant's
// protected content, and granted by a single platform owner rather than
// requiring a distinct approver: this bypasses a capacity NUMBER, not
// consent-gated access to someone's sensitive data, so the two-person
// control `supportGrants` needs for the latter is not the right fit here.
// No uniqueness constraint -- like `supportGrants`, more than one override
// can be simultaneously active for the same organization (independently
// granted, independently revocable), `isCommercialOverrideActive`
// (`packages/services/src/commercial-override.ts`) is a plain existence
// check, not a singleton lookup. "Cannot bypass security/consent/release
// gates" is structural, not a rule this table or its check functions
// enforce: an active override is only ever read by
// `entitlement-enforcement.ts`'s four commercial capacity checks, which
// never touch security, consent, or release-gate code at all.
export const commercialOverrides = pgTable(
  'commercial_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    grantedByAccountId: uuid('granted_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull().defaultNow(),
    expiryAt: timestamp('expiry_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByAccountId: uuid('revoked_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    revokedReason: text('revoked_reason'),
    ...timestamps,
  },
  (table) => [
    index('commercial_overrides_organization_idx').on(table.organizationId),
    check('commercial_overrides_expiry_after_start', sql`${table.expiryAt} > ${table.startAt}`),
    // Maximum 30 days -- generous enough for a genuine billing dispute or
    // migration to resolve, but a database-enforced ceiling all the same, so
    // an application bug can never issue an indefinitely-lived override.
    check(
      'commercial_overrides_max_duration',
      sql`extract(epoch from (${table.expiryAt} - ${table.startAt})) <= 2592000`,
    ),
  ],
);

// --- Commerce: manual billing (Commercial V1 COM-03, Part 5 §8) ---
// "This is subscription administration, not a full agency CRM." No payment
// gateway, card handling, tax engine, or automated accounting exists or is
// simulated here -- every amount tracked below was typed in by a platform
// owner after receiving it some other way (bank transfer, cheque, whatever).
// "Never equate proposal/commitment/invoice with collected cash" (a promise
// `plans.priceMinorUnits`'s own comment already made) is kept structurally:
// `invoicedAmountMinorUnits` and `collectedAmountMinorUnits` are two
// separate, independently-tracked columns on `invoices` below, and nothing
// anywhere infers one from the other.
export const billingStatus = pgEnum('billing_status', [
  'TRIAL',
  'ACTIVE',
  'GRACE',
  'SUSPENDED',
  'CLOSED',
]);

// One organization's overall billing relationship -- deliberately decoupled
// from `subscriptions` (which plan is assigned): an org's billing standing
// (current, in a payment grace period, suspended for non-payment) changes
// independently of which plan it's on, and must survive a plan change
// untouched (a downgrade/upgrade is COM-02's concern, never itself a
// billing-status transition). Exactly one row per organization for its
// entire lifetime -- unlike `subscriptions`, this table holds the CURRENT
// status as a single mutable column, not one row per period; every
// transition it ever went through lives in `billingStatusHistory` instead.
export const billingAccounts = pgTable(
  'billing_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    status: billingStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('billing_accounts_organization_unique').on(table.organizationId)],
);

// Append-only, like every other decision-history table in this schema
// (auditEvents, missionDecisions, factVersions) -- `billingAccounts.status`
// is what's authoritative for "what state is this org in right now," never
// re-derived from this table, but every transition that ever produced it is
// preserved here for review.
export const billingStatusHistory = pgTable(
  'billing_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccounts.id, { onDelete: 'cascade' }),
    fromStatus: billingStatus('from_status'),
    toStatus: billingStatus('to_status').notNull(),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('billing_status_history_account_idx').on(table.billingAccountId)],
);

export const invoiceStatus = pgEnum('invoice_status', ['OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID']);

// One invoice per billed period per organization, manually issued by a
// platform owner. `invoicedAmountMinorUnits`/`currency` are this invoice's
// own immutable record of what was billed -- never a live join to
// `plans.priceMinorUnits`, which can change later via `updatePlan` without
// retroactively altering a historical invoice. `planId` is kept purely for
// traceability (which plan/tier this invoice was for).
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    invoiceRef: text('invoice_ref').notNull(),
    invoicedAmountMinorUnits: integer('invoiced_amount_minor_units').notNull(),
    currency: text('currency').notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    status: invoiceStatus('status').notNull().default('OPEN'),
    // Both default to "nothing collected yet," never null -- "collected
    // amount/date" only means something once a real payment is recorded,
    // and 0/absent express that unambiguously without a third
    // null-vs-zero state for every reader to reason about.
    collectedAmountMinorUnits: integer('collected_amount_minor_units').notNull().default(0),
    collectedDate: timestamp('collected_date', { withTimezone: true }),
    paymentReference: text('payment_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoices_organization_idx').on(table.organizationId),
    unique('invoices_ref_unique').on(table.invoiceRef),
    check('invoices_period_order', sql`${table.periodEnd} > ${table.periodStart}`),
    check(
      'invoices_collected_not_over_invoiced',
      sql`${table.collectedAmountMinorUnits} <= ${table.invoicedAmountMinorUnits}`,
    ),
    check(
      'invoices_amounts_non_negative',
      sql`${table.invoicedAmountMinorUnits} >= 0 and ${table.collectedAmountMinorUnits} >= 0`,
    ),
  ],
);

// --- Master Profile: opened sections and "does not apply" marks -------------
// Owner decision 2026-10-14: every profile section is visible but locked until
// the person ticks it, and a few common ones start open. Only the person's own
// choices are stored here (a section they opened or closed on purpose); the
// default-open set, and sections that already hold a saved value, are worked
// out from the catalogue at read time so nothing here goes stale when the
// catalogue grows. Section and field names are validated against the
// catalogue by the service before they are written, never trusted from the
// browser. Additive: no existing table or row is touched.
export const profileSectionStates = pgTable(
  'profile_section_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    sectionKey: text('section_key').notNull(),
    isOpen: boolean('is_open').notNull(),
    updatedByAccountId: uuid('updated_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    unique('profile_section_states_applicant_section_unique').on(
      table.applicantId,
      table.sectionKey,
    ),
    index('profile_section_states_applicant_idx').on(table.applicantId),
  ],
);

export const PROFILE_EXEMPTION_KINDS = ['FIELD_NOT_APPLICABLE', 'RECORD_NONE'] as const;

// A field the person says does not apply to them, or a repeating record (for
// example visas) they say they have none of. Counts as answered in completion.
export const profileFieldExemptions = pgTable(
  'profile_field_exemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: PROFILE_EXEMPTION_KINDS }).notNull(),
    targetKey: text('target_key').notNull(),
    createdByAccountId: uuid('created_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('profile_field_exemptions_applicant_kind_target_unique').on(
      table.applicantId,
      table.kind,
      table.targetKey,
    ),
    index('profile_field_exemptions_applicant_idx').on(table.applicantId),
  ],
);

// --- Document protection switches (owner decision 2026-10-25) ---------------
// Which documents need a fresh sign-in check before anyone previews or
// downloads them. The code holds the defaults
// (packages/services/src/access/restricted-documents.ts); a row here is a
// platform admin's switch that overrides one default, so an absent row always
// means "use the default". One row per switch: a document group key
// (CATEGORY), a catalogue document type key (DOCUMENT_TYPE), or the single
// rule for documents whose type is not known yet (UNKNOWN_TYPE, key
// 'unknown'). Every change is also written to the audit chain.
export const DOCUMENT_PROTECTION_SCOPES = ['CATEGORY', 'DOCUMENT_TYPE', 'UNKNOWN_TYPE'] as const;
export const DOCUMENT_PROTECTION_UNKNOWN_KEY = 'unknown';
export const DOCUMENT_PROTECTION_REASON_MAX = 500;

export const documentProtectionSettings = pgTable(
  'document_protection_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope', { enum: DOCUMENT_PROTECTION_SCOPES }).notNull(),
    key: text('key').notNull(),
    restricted: boolean('restricted').notNull(),
    reason: text('reason'),
    changedByAccountId: uuid('changed_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('document_protection_settings_scope_key_unique').on(table.scope, table.key),
    check(
      'document_protection_settings_scope_valid',
      sql`${table.scope} in ('CATEGORY', 'DOCUMENT_TYPE', 'UNKNOWN_TYPE')`,
    ),
    check(
      'document_protection_settings_unknown_key',
      sql`${table.scope} <> 'UNKNOWN_TYPE' or ${table.key} = 'unknown'`,
    ),
    check(
      'document_protection_settings_key_length',
      sql`char_length(${table.key}) between 1 and 120`,
    ),
    check(
      'document_protection_settings_reason_length',
      sql`${table.reason} is null or char_length(${table.reason}) <= 500`,
    ),
  ],
);

// --- Profile photos (WP-PH1, owner request 2026-10-25) ----------------------
// One optional photo per traveller record, shown where their initials show
// today. Owner-only: set, replaced and removed by the record's owner, served
// only through the signed-in photo route, never through a grant, and never
// used as a visa photo. The bytes are a server re-encoded square JPEG (no
// location or other metadata) kept privately in the same storage as
// documents and registered in storage_objects, so verified erasure, orphan
// checks and restore reconciliation treat it like any other stored object.
// Deleting the storage object row (after verified erasure) removes this row
// too, so a photo can never point at bytes that are gone.
export const applicantPhotos = pgTable(
  'applicant_photos',
  {
    applicantId: uuid('applicant_id')
      .primaryKey()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    storageObjectId: uuid('storage_object_id')
      .notNull()
      .unique()
      .references(() => storageObjects.id, { onDelete: 'cascade' }),
    // Hex SHA-256 of the stored bytes: checked on every read, and its prefix
    // versions the photo address so a replaced photo is never shown stale.
    contentSha256: text('content_sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    ...timestamps,
  },
  (table) => [
    check('applicant_photos_sha256_format', sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check('applicant_photos_size_bounds', sql`${table.sizeBytes} between 1 and 1048576`),
  ],
);

// --- Visible reference codes (WP-REF, ADR 0018, owner decision 2026-10-26) ---
// One registry for the short codes people read aloud and quote (for example
// C-7K2Q9M): a type letter and 6 to 8 characters of Crockford base32 whose
// last character is a check character (packages/core/src/reference-code.ts).
// Internal ids never change; this is a second, human name for a record. A
// registry, not a column per table: the four record tables are read with
// bare selects in about 117 places, which a new column would break between a
// deploy and its migration. Rows are never deleted and carry no foreign key,
// so a code is unique per type forever and never reused, even after the
// record is erased (a code and a dead id are not personal data).
export const referenceKind = pgEnum('reference_kind', ['P', 'C', 'D', 'R']);

export const referenceCodes = pgTable(
  'reference_codes',
  {
    kind: referenceKind('kind').notNull(),
    // Stored without the type letter and hyphen.
    code: text('code').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'reference_codes_pkey', columns: [table.kind, table.code] }),
    unique('reference_codes_kind_entity_unique').on(table.kind, table.entityId),
    check('reference_codes_code_format', sql`${table.code} ~ '^[0-9A-HJKMNP-TV-Z]{6,8}$'`),
  ],
);

// --- Staff second factor (S2/S3, M08) ---
// One authenticator-app factor per account that holds a platform role. The secret is envelope
// encrypted with the same key port as protected fields (never plaintext); recovery codes are
// stored only as hashes. `last_used_step` stops a code being used twice; the verified session
// reference ties "this person just proved the code" to one sign-in, so a stolen password used
// on another device does not inherit it.
export const staffSecondFactors = pgTable(
  'staff_second_factors',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'),
    // New for every enrolment: binds the encrypted secret to this attempt.
    enrolmentId: uuid('enrolment_id').notNull().defaultRandom(),
    secretCiphertext: bytea('secret_ciphertext').notNull(),
    secretNonce: bytea('secret_nonce').notNull(),
    secretKeyVersion: text('secret_key_version').notNull(),
    lastUsedStep: bigint('last_used_step', { mode: 'number' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedSessionRef: text('verified_session_ref'),
    recoveryCodeHashes: text('recovery_code_hashes').array().notNull().default(sql`'{}'::text[]`),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('staff_second_factors_status', sql`${table.status} in ('PENDING', 'ACTIVE')`),
    check(
      'staff_second_factors_active_confirmed',
      sql`${table.status} <> 'ACTIVE' or ${table.confirmedAt} is not null`,
    ),
    check(
      'staff_second_factors_recovery_max',
      sql`coalesce(array_length(${table.recoveryCodeHashes}, 1), 0) <= 10`,
    ),
  ],
);

// --- Cash ledger (Small Commercial V1 S10, ADR 0020) ---
// One row per amount actually received or reversed against an invoice. The
// ledger is append-only: a database trigger refuses every UPDATE, DELETE and
// TRUNCATE, so a correction is always a new row with the opposite sign, never
// an edit. `invoices.collected_amount_minor_units` is the sum of these rows,
// written in the same transaction as each row while the invoice row is locked.
// All five kinds exist from the start so refunds and credits (S18) need no enum
// change. `amount_minor_units` is a positive whole number of minor currency
// units for everything except REFUND, which is negative. Two unique keys make
// recording the same money twice impossible at the database level: one per
// source (an attempt, a claim, a held attempt, a refund request, or the
// caller's idempotency key for an admin recording) and one per provider
// transaction. `recorded_by_account_id` carries no foreign key on purpose: the
// row is a financial record that must outlive the person who typed it, and a
// dead account id is not personal data. It is null when a provider confirmed
// the money.
export const invoicePaymentKind = pgEnum('invoice_payment_kind', [
  'ONLINE',
  'MANUAL_CLAIM',
  'ADMIN_RECORDED',
  'CREDIT',
  'REFUND',
]);

export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The order rows were written in (rows written in one transaction share a timestamp).
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    currency: text('currency').notNull(),
    kind: invoicePaymentKind('kind').notNull(),
    sourceId: uuid('source_id'),
    provider: text('provider'),
    providerTransactionId: text('provider_transaction_id'),
    reference: text('reference').notNull(),
    collectedDate: timestamp('collected_date', { withTimezone: true }).notNull(),
    recordedByAccountId: uuid('recorded_by_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoice_payments_invoice_idx').on(table.invoiceId),
    unique('invoice_payments_kind_source_unique').on(table.kind, table.sourceId),
    unique('invoice_payments_provider_transaction_unique').on(
      table.provider,
      table.providerTransactionId,
    ),
    check(
      'invoice_payments_amount_sign',
      sql`(${table.kind} = 'REFUND' and ${table.amountMinorUnits} < 0) or (${table.kind} <> 'REFUND' and ${table.amountMinorUnits} > 0)`,
    ),
    check(
      'invoice_payments_source_required',
      sql`${table.kind} = 'ADMIN_RECORDED' or ${table.sourceId} is not null`,
    ),
    check(
      'invoice_payments_provider_pair',
      sql`(${table.provider} is null) = (${table.providerTransactionId} is null)`,
    ),
    check('invoice_payments_reference_present', sql`length(btrim(${table.reference})) > 0`),
  ],
);

// Lane D: WhatsApp channel (docs/roadmap/pwa-whatsapp/LANE-D-CONTRACT.md sections 5 and 6).
// A channel identity is a WhatsApp sender, keyed on Meta's business-scoped user id, never on a
// phone number. It reaches VisaStack records only once LINKED to exactly one account through a
// code created in that account's signed-in session. Only the last four digits of a number are
// kept, for the masked "ends in 1234" display. `opted_out_at` covers both STOP and Meta reporting
// that the person blocked VisaStack: nothing is sent until they write START.
export const channelIdentities = pgTable(
  'channel_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel').notNull().default('WHATSAPP'),
    // The business number (Meta phone number id) the person writes to.
    providerScope: text('provider_scope').notNull(),
    externalUserId: text('external_user_id').notNull(),
    phoneLast4: text('phone_last4'),
    status: text('status').notNull().default('PROVISIONAL'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    optInVersion: text('opt_in_version'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    // Meta's time on the STOP or START that last changed `opted_out_at`, so an older one that
    // arrives late (a retried delivery) never overrides a newer choice.
    optChangedAt: timestamp('opt_changed_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }).notNull().defaultNow(),
    lastAutoReplyAt: timestamp('last_auto_reply_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('channel_identities_sender_unique').on(
      table.channel,
      table.providerScope,
      table.externalUserId,
    ),
    uniqueIndex('channel_identities_one_linked_per_account')
      .on(table.accountId, table.channel)
      .where(sql`${table.status} = 'LINKED'`),
    check('channel_identities_channel', sql`${table.channel} in ('WHATSAPP')`),
    check(
      'channel_identities_status',
      sql`${table.status} in ('PROVISIONAL', 'LINKED', 'REVOKED')`,
    ),
    check(
      'channel_identities_linked_account',
      sql`(${table.status} = 'LINKED') = (${table.accountId} is not null)`,
    ),
    check(
      'channel_identities_last4',
      sql`${table.phoneLast4} is null or ${table.phoneLast4} ~ '^[0-9]{4}$'`,
    ),
  ],
);

// One-time codes a signed-in person sends from WhatsApp to connect it. Only a hash is kept.
export const channelLinkCodes = pgTable(
  'channel_link_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    optInVersion: text('opt_in_version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('channel_link_codes_hash_unique').on(table.codeHash),
    index('channel_link_codes_account_idx').on(table.accountId),
  ],
);

// The webhook inbox: each verified delivery, encrypted, until the job has handled it. The
// payload is cleared once handled; the row stays a few days so a repeated delivery is spotted.
export const channelWebhookEvents = pgTable(
  'channel_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel').notNull().default('WHATSAPP'),
    eventHash: text('event_hash').notNull(),
    payloadCiphertext: bytea('payload_ciphertext'),
    payloadNonce: bytea('payload_nonce'),
    payloadKeyVersion: text('payload_key_version'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    // After a failure the delivery waits (1, 2, 4 ... minutes) before it is tried again.
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (table) => [
    unique('channel_webhook_events_hash_unique').on(table.eventHash),
    index('channel_webhook_events_pending_idx')
      .on(table.receivedAt)
      .where(sql`${table.processedAt} is null`),
    check(
      'channel_webhook_events_payload_whole',
      sql`(${table.payloadCiphertext} is null) = (${table.payloadNonce} is null) and (${table.payloadNonce} is null) = (${table.payloadKeyVersion} is null)`,
    ),
  ],
);

// One row per WhatsApp message in either direction: ids, kind and delivery state only, never
// the text. Inbound ids make a repeated message a no-op; outbound rows track delivery and cost.
export const channelMessages = pgTable(
  'channel_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => channelIdentities.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    errorCode: integer('error_code'),
    pricingCategory: text('pricing_category'),
    billable: boolean('billable'),
    providerTimestamp: timestamp('provider_timestamp', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('channel_messages_provider_unique').on(table.providerMessageId),
    index('channel_messages_identity_idx').on(table.identityId, table.createdAt),
    check('channel_messages_direction', sql`${table.direction} in ('IN', 'OUT')`),
    check(
      'channel_messages_state',
      sql`${table.state} in ('RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED')`,
    ),
  ],
);

// --- Online payment attempts (Small Commercial V1 S11, ADR 0020) ---
// One row per time an agency owner or admin starts paying an invoice through the hosted
// gateway. The row is the VisaStack side of the conversation: `merchant_tran_id` is generated
// here, never reused and unguessable, and it is the only thing that binds a gateway callback to
// one invoice. The status moves only on what the gateway's own validation says, never on what a
// browser or an unauthenticated callback claims. `RECORDED` means the money is in the cash
// ledger (exactly one ONLINE row whose source is this attempt); `HELD_FOR_REVIEW` is money the
// gateway confirmed that VisaStack did not count (risky, already paid, or not matching), with
// the plain code in `reason_code`. The gateway's own transaction ids are provider references,
// not personal data, and no card data is ever stored. `initiated_by_account_id` carries no
// foreign key for the same reason as the ledger: it is a financial record that must outlive the
// person. Nothing here is applicant-owned.
export const paymentAttemptStatus = pgEnum('payment_attempt_status', [
  'CREATED',
  'REDIRECTED',
  'VALIDATED',
  'RECORDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'HELD_FOR_REVIEW',
]);

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    merchantTranId: text('merchant_tran_id').notNull(),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    currency: text('currency').notNull(),
    status: paymentAttemptStatus('status').notNull().default('CREATED'),
    providerSessionKey: text('provider_session_key'),
    providerValId: text('provider_val_id'),
    bankTranId: text('bank_tran_id'),
    riskLevel: integer('risk_level'),
    lastProviderStatus: text('last_provider_status'),
    // A plain code (risky_payment, already_paid, mismatch, ...) set with HELD_FOR_REVIEW, and
    // start_failed or start_incomplete with FAILED. Never provider text.
    reasonCode: text('reason_code'),
    initiatedByAccountId: uuid('initiated_by_account_id'),
    redirectedAt: timestamp('redirected_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('payment_attempts_invoice_idx').on(table.invoiceId),
    index('payment_attempts_status_redirected_idx').on(table.status, table.redirectedAt),
    unique('payment_attempts_merchant_tran_unique').on(table.merchantTranId),
    unique('payment_attempts_provider_val_unique').on(table.provider, table.providerValId),
    check('payment_attempts_amount_positive', sql`${table.amountMinorUnits} > 0`),
    check(
      'payment_attempts_recorded_has_time',
      sql`${table.status} <> 'RECORDED' or ${table.recordedAt} is not null`,
    ),
    check(
      'payment_attempts_held_has_reason',
      sql`${table.status} <> 'HELD_FOR_REVIEW' or ${table.reasonCode} is not null`,
    ),
  ],
);

// --- Agency invoices, manual payment reports and receipts (Small Commercial V1 S12, ADR 0020) ---
// `manual_payment_claims`: an agency owner or admin saying "I paid another way". A claim records
// no money. Only a platform owner's approval does, through the one recording function, which
// writes a MANUAL_CLAIM ledger row whose source is the claim. A decided claim is frozen by a
// trigger (the decision, who made it and when can never be edited or removed), and at most one
// claim per invoice can wait for a decision. The people on a claim carry no foreign keys for the
// same reason as the ledger: a financial record outlives the person.
export const manualClaimMethod = pgEnum('manual_claim_method', [
  'BANK_TRANSFER',
  'BKASH',
  'CHEQUE',
  'OTHER',
]);

export const manualClaimStatus = pgEnum('manual_claim_status', [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
]);

export const manualPaymentClaims = pgTable(
  'manual_payment_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    submittedByAccountId: uuid('submitted_by_account_id').notNull(),
    method: manualClaimMethod('method').notNull(),
    // A short outside reference (a transfer id, a cheque number). Never a document's content.
    reference: text('reference').notNull(),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    currency: text('currency').notNull(),
    paidOn: timestamp('paid_on', { withTimezone: true }).notNull(),
    note: text('note'),
    status: manualClaimStatus('status').notNull().default('SUBMITTED'),
    decidedByAccountId: uuid('decided_by_account_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    ...timestamps,
  },
  (table) => [
    index('manual_payment_claims_invoice_idx').on(table.invoiceId),
    index('manual_payment_claims_org_status_idx').on(table.organizationId, table.status),
    uniqueIndex('manual_payment_claims_one_waiting_unique')
      .on(table.invoiceId)
      .where(sql`${table.status} = 'SUBMITTED'`),
    check('manual_payment_claims_amount_positive', sql`${table.amountMinorUnits} > 0`),
    check(
      'manual_payment_claims_reference_bounds',
      sql`length(btrim(${table.reference})) between 1 and 120`,
    ),
    check(
      'manual_payment_claims_note_bounds',
      sql`${table.note} is null or length(${table.note}) <= 500`,
    ),
    check(
      'manual_payment_claims_decision_shape',
      sql`(${table.status} = 'SUBMITTED' and ${table.decidedAt} is null and ${table.decidedByAccountId} is null)
        or (${table.status} <> 'SUBMITTED' and ${table.decidedAt} is not null and ${table.decidedByAccountId} is not null)`,
    ),
    check(
      'manual_payment_claims_rejection_has_reason',
      sql`${table.status} <> 'REJECTED' or length(btrim(coalesce(${table.decisionReason}, ''))) > 0`,
    ),
  ],
);

// `billing_receipts`: the optional proof of payment file on a claim (a bank slip or a screenshot).
// It is an organization-owned billing file, never a traveller document: its own table, its own
// object-key prefix, readable only by the agency's owners and admins and by platform billing
// staff. It is stored only after the safety scan passed (`scan_status` is therefore always
// CLEAN), and one claim has at most one file.
export const billingReceipts = pgTable(
  'billing_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .unique()
      .references(() => manualPaymentClaims.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    storageObjectId: uuid('storage_object_id')
      .notNull()
      .unique()
      .references(() => storageObjects.id, { onDelete: 'restrict' }),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    contentSha256: text('content_sha256').notNull(),
    scanStatus: text('scan_status').notNull().default('CLEAN'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('billing_receipts_org_idx').on(table.organizationId),
    check('billing_receipts_scanned_clean', sql`${table.scanStatus} = 'CLEAN'`),
    check('billing_receipts_sha256_format', sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check('billing_receipts_size_bounds', sql`${table.sizeBytes} between 1 and 5242880`),
    check(
      'billing_receipts_type',
      sql`${table.contentType} in ('application/pdf', 'image/jpeg', 'image/png')`,
    ),
  ],
);

// `payment_receipts`: the numbered receipt an agency receives for money that is in the ledger.
// Exactly one receipt per ledger row (the unique `invoice_payment_id`), so a receipt exists only
// for a recorded collection and a replay finds the first one. Numbers run 1, 2, 3 ... per
// organization with no gaps: each number is taken from the organization's counter row inside the
// transaction that records the money, so a recording that rolls back gives its number back, and
// two recordings at once take turns on the counter's row lock. Receipts are append-only (a
// trigger refuses edits and deletes). They carry amounts, currency and ids, nothing personal.
export const paymentReceiptCounters = pgTable(
  'payment_receipt_counters',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (table) => [check('payment_receipt_counters_not_negative', sql`${table.lastNumber} >= 0`)],
);

export const paymentReceipts = pgTable(
  'payment_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    invoicePaymentId: uuid('invoice_payment_id')
      .notNull()
      .unique()
      .references(() => invoicePayments.id, { onDelete: 'restrict' }),
    receiptNumber: integer('receipt_number').notNull(),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    currency: text('currency').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payment_receipts_invoice_idx').on(table.invoiceId),
    unique('payment_receipts_org_number_unique').on(table.organizationId, table.receiptNumber),
    check('payment_receipts_number_positive', sql`${table.receiptNumber} > 0`),
    check('payment_receipts_amount_positive', sql`${table.amountMinorUnits} > 0`),
  ],
);

// A private calendar subscription link for one traveller (v1.2 B05 live feed, ADR 0016). Calendar
// apps cannot sign in, so the link carries a long random secret; only its SHA-256 is kept, so
// nobody can read a working link back out of the database. One link per traveller at most: a new
// link replaces the old one, and stopping it deletes the row (the old address then answers "not
// found"). The account that turned it on is the one the feed reads as, through the access gate,
// every time a calendar app asks; if that account no longer owns the traveller, the feed stops.
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id')
      .notNull()
      .unique('calendar_feeds_applicant_unique')
      .references(() => applicants.id, { onDelete: 'cascade' }),
    ownerAccountId: uuid('owner_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    secretHash: text('secret_hash').notNull().unique('calendar_feeds_secret_hash_unique'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    linkMadeAt: timestamp('link_made_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('calendar_feeds_owner_idx').on(table.ownerAccountId),
    check('calendar_feeds_secret_hash_shape', sql`${table.secretHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
