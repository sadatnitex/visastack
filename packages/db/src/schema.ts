import {
  CONSENT_TYPES,
  DOCUMENT_STATES,
  FACT_STATUSES,
  MEMBERSHIP_ROLES,
  MISSION_STATES,
  ORGANIZATION_STATUSES,
  PERMISSION_ACTIONS,
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
export const factStatus = pgEnum('fact_status', FACT_STATUSES);
export const fieldSensitivity = pgEnum('field_sensitivity', [
  'STANDARD',
  'SENSITIVE',
  'RESTRICTED',
]);

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

// --- Persisted document intelligence (Release C; master directive §11/§13) -
// Deterministic extraction/classification/naming records. Scoped to what this
// release actually implements — the AI-proposal tables (FieldProposal,
// EvidenceLocation, Conflict, CorrectionFeedback) belong to the separate AI PR
// and are deliberately NOT added here.

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
export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    status: jobStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    index('processing_jobs_status_available_idx').on(table.status, table.availableAt),
    index('processing_jobs_document_version_idx').on(table.documentVersionId),
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
