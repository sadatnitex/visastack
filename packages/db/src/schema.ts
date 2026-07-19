import {
  CONSENT_TYPES,
  DOCUMENT_STATES,
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

// --- Shared timestamp columns ----------------------------------------------
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// --- Accounts (WorkOS-backed login) ----------------------------------------
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
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
    actorAccountId: uuid('actor_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
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
