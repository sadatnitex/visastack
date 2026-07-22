import type {
  AccountId,
  AgencyId,
  ApplicantId,
  DocumentId,
  MissionId,
  PermissionAction,
  Result,
} from '@visastack/core';
import { err, ok } from '@visastack/core';
import { type Actor, type Grant, authorize } from '@visastack/policy';
import { desc, eq } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import type { AccessRef, AccessVariant, StorageBucket, StoragePort } from './storage';

/**
 * Document Vault (Build Spec §4.2, §7, §11; PRD §2).
 *
 * Phase 1 covers document/version metadata and **permission-aware** preview and
 * download. Every access decision is delegated to the policy engine
 * (default-deny), so the owner, an organization member with an accepted grant,
 * and a just-in-time support grant all flow through one authoritative gate.
 * DOWNLOAD_ORIGINAL always requires step-up (Build Spec §14). Access is issued
 * as a short-lived reference via the injected `StoragePort` — no bytes or
 * addresses are hard-coded here.
 */

export type Document = typeof schema.documents.$inferSelect;
export type DocumentVersion = typeof schema.documentVersions.$inferSelect;
export type StorageObject = typeof schema.storageObjects.$inferSelect;

const DEFAULT_ACCESS_TTL_SECONDS = 300;

// --- Registration (owner-authorized, consent-gated) ------------------------

export interface RegisterDocumentInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly originalName: string;
  readonly docType?: string;
  readonly source?: string;
}

/** Create a document record owned by the applicant's account. */
export async function registerDocument(
  db: Db,
  input: RegisterDocumentInput,
): Promise<Result<Document, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'documents may only be registered by the owning account'));
  }
  if (input.originalName.trim().length === 0) {
    return err(serviceError('invalid', 'a document name is required'));
  }
  if (!(await hasConsent(db, applicant.ownerAccountId, 'CORE_PROCESSING'))) {
    return err(serviceError('consent_required', 'CORE_PROCESSING consent is required'));
  }

  return db.transaction(async (tx) => {
    const document = required(
      first(
        await tx
          .insert(schema.documents)
          .values({
            applicantId: input.applicantId,
            originalName: input.originalName.trim(),
            docType: input.docType ?? null,
            source: input.source ?? null,
            uploaderAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'document',
    );
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_REGISTERED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      metadata: { docType: input.docType ?? null },
    });
    return ok(document);
  });
}

export interface AddDocumentVersionInput {
  readonly actorAccountId: string;
  readonly documentId: string;
  readonly bucket: StorageBucket;
  readonly objectKey: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
  readonly safetyStatus?: DocumentVersion['safetyStatus'];
  readonly processingStatus?: DocumentVersion['processingStatus'];
}

export interface AddDocumentVersionResult {
  readonly version: DocumentVersion;
  readonly storageObject: StorageObject;
}

/** Attach a new stored version to a document (metadata + storage object). */
export async function addDocumentVersion(
  db: Db,
  input: AddDocumentVersionInput,
): Promise<Result<AddDocumentVersionResult, ServiceError>> {
  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .limit(1),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));
  const applicant = await getApplicant(db, document.applicantId);
  if (!applicant || applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'versions may only be added by the owning account'));
  }

  return db.transaction(async (tx) => {
    const storageObject = required(
      first(
        await tx
          .insert(schema.storageObjects)
          .values({
            bucket: input.bucket,
            objectKey: input.objectKey,
            sizeBytes: input.sizeBytes ?? null,
            contentHash: input.sha256 ?? null,
          })
          .returning(),
      ),
      'storage object',
    );

    const top = first(
      await tx
        .select({ versionNumber: schema.documentVersions.versionNumber })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, input.documentId))
        .orderBy(desc(schema.documentVersions.versionNumber))
        .limit(1),
    );
    const nextNumber = (top?.versionNumber ?? 0) + 1;

    const version = required(
      first(
        await tx
          .insert(schema.documentVersions)
          .values({
            documentId: input.documentId,
            versionNumber: nextNumber,
            storageObjectId: storageObject.id,
            safetyStatus: input.safetyStatus ?? 'PENDING',
            processingStatus: input.processingStatus ?? 'UPLOADING',
            sizeBytes: input.sizeBytes ?? null,
            sha256: input.sha256 ?? null,
          })
          .returning(),
      ),
      'document version',
    );

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_VERSION_ADDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document_version',
      resourceId: version.id,
      metadata: { documentId: input.documentId, versionNumber: nextNumber },
    });
    return ok({ version, storageObject });
  });
}

/** List an applicant's documents (owner-scoped). */
export async function listDocuments(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<Document[], ServiceError>> {
  const applicant = await getApplicant(db, applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to list these documents'));
  }
  const rows = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.applicantId, applicantId));
  return ok(rows);
}

/** A document plus the safety/processing status of its latest version. */
export interface DocumentSummary {
  readonly id: string;
  readonly originalName: string;
  readonly docType: string | null;
  readonly latestVersionId: string | null;
  readonly safetyStatus: DocumentVersion['safetyStatus'] | null;
  readonly processingStatus: DocumentVersion['processingStatus'] | null;
  readonly createdAt: string;
}

/** List an applicant's documents with the latest version's status (owner-scoped). */
export async function listDocumentsDetailed(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<DocumentSummary[], ServiceError>> {
  const listed = await listDocuments(db, actorAccountId, applicantId);
  if (!listed.ok) return listed;

  const summaries: DocumentSummary[] = [];
  for (const doc of listed.value) {
    const version = first(
      await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, doc.id))
        .orderBy(desc(schema.documentVersions.versionNumber))
        .limit(1),
    );
    summaries.push({
      id: doc.id,
      originalName: doc.originalName,
      docType: doc.docType,
      latestVersionId: version?.id ?? null,
      safetyStatus: version?.safetyStatus ?? null,
      processingStatus: version?.processingStatus ?? null,
      createdAt: doc.createdAt.toISOString(),
    });
  }
  return ok(summaries);
}

// --- Permission-aware access -----------------------------------------------

/** Map the grant rows for an applicant into the policy engine's Grant shape. */
async function loadGrants(db: Db, applicantId: string): Promise<Grant[]> {
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  return rows.map((row) => ({
    applicantId: row.applicantId as ApplicantId,
    actions: row.actions as PermissionAction[],
    purpose: row.purpose,
    status: row.status,
    startAt: row.startAt.toISOString(),
    ...(row.recipientAccountId ? { recipientAccountId: row.recipientAccountId as AccountId } : {}),
    ...(row.recipientOrganizationId
      ? { recipientOrganizationId: row.recipientOrganizationId as AgencyId }
      : {}),
    ...(row.missionId ? { missionId: row.missionId as MissionId } : {}),
    ...(row.categories ? { categories: row.categories } : {}),
    ...(row.acceptedAt ? { acceptedAt: row.acceptedAt.toISOString() } : {}),
    ...(row.expiryAt ? { expiryAt: row.expiryAt.toISOString() } : {}),
  }));
}

/** Best-effort audit identity for an actor (owner carries no account id). */
function actorAudit(actor: Actor): { actorAccountId: string | null; actorRole: string } {
  switch (actor.kind) {
    case 'applicant_owner':
      return { actorAccountId: null, actorRole: 'applicant_owner' };
    case 'organization_member':
      return { actorAccountId: actor.accountId, actorRole: `org:${actor.membership.role}` };
    case 'support_admin':
      return { actorAccountId: actor.accountId, actorRole: 'support_admin' };
  }
}

export interface DocumentAccessInput {
  readonly actor: Actor;
  readonly documentId: string;
  readonly purpose: string;
  readonly stepUpSatisfied?: boolean;
  readonly now?: Date;
}

/**
 * Whether this actor is the applicant's owner. The owner actor is minted by the
 * caller only after it has verified `applicant.ownerAccountId === session
 * account` (see the preview server action), so an owner actor for this
 * document's applicant is authoritative.
 */
function isApplicantOwner(actor: Actor, applicantId: string): boolean {
  return actor.kind === 'applicant_owner' && actor.applicantId === applicantId;
}

async function accessDocument(
  db: Db,
  storage: StoragePort,
  action: PermissionAction,
  variant: AccessVariant,
  disposition: 'preview' | 'download',
  input: DocumentAccessInput,
): Promise<Result<AccessRef, ServiceError>> {
  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .limit(1),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));

  // Preview variant is owner-scoped (Milestone 2): the applicant's owner may
  // preview their own clean ORIGINAL; any third party gets a `redacted` variant,
  // which the serving route fails closed on until real renditions exist — it can
  // never expose the original bytes as a "preview". Downloads keep the requested
  // variant (original still requires DOWNLOAD_ORIGINAL + step-up).
  const effectiveVariant: AccessVariant =
    disposition === 'preview'
      ? isApplicantOwner(input.actor, document.applicantId)
        ? 'original'
        : 'redacted'
      : variant;

  const now = input.now ?? new Date();
  const grants = await loadGrants(db, document.applicantId);
  const decision = authorize({
    actor: input.actor,
    action,
    resource: {
      applicantId: document.applicantId as ApplicantId,
      documentId: document.id as DocumentId,
    },
    context: {
      now,
      purpose: input.purpose,
      stepUpSatisfied: input.stepUpSatisfied ?? false,
      grants,
    },
  });

  const audit = actorAudit(input.actor);
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_ACCESS',
      actorAccountId: audit.actorAccountId,
      actorRole: audit.actorRole,
      action,
      result: decision.allowed ? 'ALLOWED' : 'DENIED',
      method: 'API',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      reason: decision.allowed ? null : decision.reason,
      metadata: { variant: effectiveVariant, disposition, purpose: input.purpose },
    });
  });

  if (!decision.allowed) {
    return err(serviceError('forbidden', `access denied (${decision.reason})`));
  }

  // Resolve the latest version's storage object.
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, document.id))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  if (!version) return err(serviceError('not_found', 'document has no stored version'));
  const storageObject = first(
    await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, version.storageObjectId))
      .limit(1),
  );
  if (!storageObject) return err(serviceError('not_found', 'stored object missing'));

  const ref = await storage.issueReadRef({
    bucket: storageObject.bucket,
    objectKey: storageObject.objectKey,
    disposition,
    variant: effectiveVariant,
    expiresInSeconds: DEFAULT_ACCESS_TTL_SECONDS,
    // The current approved name if one exists, else the preserved original —
    // never the opaque storage key (master directive §10/§18/§21E).
    filename: document.approvedName ?? document.originalName,
  });
  return ok(ref);
}

/**
 * Permission-checked preview. The owner previews their own clean original; any
 * third party is issued a `redacted` variant, which the serving route fails
 * closed on until real generated renditions exist (Milestone 2) — preview never
 * exposes original bytes to a non-owner.
 */
export async function previewDocument(
  db: Db,
  storage: StoragePort,
  input: DocumentAccessInput,
): Promise<Result<AccessRef, ServiceError>> {
  return accessDocument(db, storage, 'PREVIEW', 'redacted', 'preview', input);
}

export interface DownloadDocumentInput extends DocumentAccessInput {
  /** 'original' requires DOWNLOAD_ORIGINAL + step-up; 'redacted' requires DOWNLOAD_REDACTED. */
  readonly variant?: AccessVariant;
}

/** Permission-checked download; original bytes require step-up (Build Spec §14). */
export async function downloadDocument(
  db: Db,
  storage: StoragePort,
  input: DownloadDocumentInput,
): Promise<Result<AccessRef, ServiceError>> {
  const variant: AccessVariant = input.variant ?? 'redacted';
  const action: PermissionAction =
    variant === 'original' ? 'DOWNLOAD_ORIGINAL' : 'DOWNLOAD_REDACTED';
  return accessDocument(db, storage, action, variant, 'download', input);
}
