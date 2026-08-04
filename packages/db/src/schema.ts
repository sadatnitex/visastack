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
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
]);
export const erasureJobStatus = pgEnum('erasure_job_status', [
  'PENDING',
  'CLAIMED',
  'DELETED',
  'VERIFIED',
  'FAILED',
  'BLOCKED_BY_HOLD',
]);
export const platformRole = pgEnum('platform_role', [
  'PLATFORM_OWNER',
  'SECURITY_ADMIN',
  'COMPLIANCE_ADMIN',
  'SUPPORT_ADMIN',
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
export const packVersionStatus = pgEnum('pack_version_status', [
  'DRAFT',
  'APPROVED',
  'PUBLISHED',
  'DEPRECATED',
]);
export const requirementKind = pgEnum('requirement_kind', ['FIELD', 'DOCUMENT']);
export const evidenceRequestStatus = pgEnum('evidence_request_status', [
  'OPEN',
  'FULFILLED',
  'DECLINED',
]);
// --- Mission collaboration additions (master directive §7 "PR 10") ---------
export const missionDecisionOutcome = pgEnum('mission_decision_outcome', ['ACCEPTED', 'REJECTED']);
export const missionTaskStatus = pgEnum('mission_task_status', ['OPEN', 'DONE', 'CANCELLED']);
export const generatedOutputKind = pgEnum('generated_output_kind', ['COVER_LETTER']);
export const factStatus = pgEnum('fact_status', FACT_STATUSES);
export const fieldSensitivity = pgEnum('field_sensitivity', [
  'STANDARD',
  'SENSITIVE',
  'RESTRICTED',
]);
export const proposalType = pgEnum('proposal_type', PROPOSAL_TYPES);
export const proposalStatus = pgEnum('proposal_status', ['PENDING', 'APPROVED', 'REJECTED']);
export const aiExtractionRunStatus = pgEnum('ai_extraction_run_status', ['SUCCEEDED', 'FAILED']);

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
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
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
  ...timestamps,
});

// --- Organizations (agencies) ----------------------------------------------
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: organizationStatus('status').notNull().default('PENDING_VERIFICATION'),
  ...timestamps,
});

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

// --- Missions (parallel destination/purpose workspaces; Build Spec §4.3) ----
export const missions = pgTable('missions', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicantId: uuid('applicant_id')
    .notNull()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  destination: text('destination'),
  purpose: text('purpose'),
  state: missionState('state').notNull().default('DRAFT'),
  // The published requirement pack version this mission is assembled against.
  packVersionId: uuid('pack_version_id'),
  ...timestamps,
});

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
    purpose: text('purpose').notNull(),
    status: grantStatus('status').notNull().default('PENDING_ACCEPTANCE'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull().defaultNow(),
    expiryAt: timestamp('expiry_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('grants_applicant_idx').on(table.applicantId),
    // A grant must name a recipient — never an ownerless delegation.
    check(
      'grants_recipient_present',
      sql`${table.recipientAccountId} is not null or ${table.recipientOrganizationId} is not null`,
    ),
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
  expiresAt: timestamp('expires_at', { withTimezone: true }),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('document_classifications_document_version_idx').on(table.documentVersionId)],
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
    value: text('value'),
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
  (table) => [index('fact_versions_fact_idx').on(table.factId)],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_extraction_runs_document_version_idx').on(table.documentVersionId),
    index('ai_extraction_runs_applicant_idx').on(table.applicantId),
    index('ai_extraction_runs_cache_key_idx').on(table.cacheKey),
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
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('evidence_locations_field_proposal_idx').on(table.fieldProposalId)],
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
    approvedByAccountId: uuid('approved_by_account_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [unique('pack_versions_pack_version_unique').on(table.packId, table.version)],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pack_requirements_version_idx').on(table.packVersionId)],
);

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
    createdByAccountId: uuid('created_by_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('mission_snapshots_mission_version_unique').on(table.missionId, table.version),
  ],
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
    authorAccountId: uuid('author_account_id'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mission_notes_mission_idx').on(table.missionId)],
);

// An org asks an applicant for a specific field or document type.
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
    kind: requirementKind('kind').notNull(),
    fieldKey: text('field_key'),
    docType: text('doc_type'),
    message: text('message'),
    status: evidenceRequestStatus('status').notNull().default('OPEN'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('evidence_requests_applicant_idx').on(table.applicantId)],
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
    selectedByAccountId: uuid('selected_by_account_id'),
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
    decidedByAccountId: uuid('decided_by_account_id').notNull(),
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
    assigneeAccountId: uuid('assignee_account_id'),
    status: missionTaskStatus('status').notNull().default('OPEN'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('mission_tasks_mission_idx').on(table.missionId)],
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
    createdByAccountId: uuid('created_by_account_id'),
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
    reason: text('reason').notNull(),
    placedByAccountId: uuid('placed_by_account_id'),
    active: boolean('active').notNull().default(true),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('legal_holds_applicant_idx').on(table.applicantId)],
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
export const accountDeletionRequests = pgTable('account_deletion_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  status: deletionStatus('status').notNull().default('PENDING'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  reason: text('reason'),
  ...timestamps,
});

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
    // Set once, the moment BlobStore.deleteObject() succeeds — and never
    // cleared afterward, even if a later verification failure sends `status`
    // back to PENDING or forward to FAILED (Codex review, PR-B2, round 4).
    // `status` alone can't answer "were the real bytes ever actually
    // deleted" once a job has been retried past DELETED: a lying-delete
    // retry and a plain verification hiccup both land back at the same
    // PENDING/FAILED status with no way to tell them apart. This column is
    // the unambiguous, permanent signal instead — read path servability
    // checks key off it directly, never off `status`.
    bytesDeletedAt: timestamp('bytes_deleted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    index('erasure_jobs_status_available_idx').on(table.status, table.availableAt),
    index('erasure_jobs_storage_object_idx').on(table.storageObjectId),
    index('erasure_jobs_lease_expires_idx').on(table.status, table.leaseExpiresAt),
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
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('product_events_type_time_idx').on(table.eventType, table.occurredAt)],
);
