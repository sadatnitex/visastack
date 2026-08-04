import type {
  ApplicantId,
  DocumentId,
  DocumentState,
  PermissionAction,
  Result,
} from '@visastack/core';
import { err, ok } from '@visastack/core';
import { type Actor, authorize } from '@visastack/policy';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { hasActiveOrVerifiedErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { recordProductEvent } from './product-events';
import { loadGrantsForPolicy } from './sharing';
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
    // Lock the document row (Codex review, PR-B2, round 1): `purgeExpiredDocuments`
    // and `finalizeVerifiedJob` take the identical lock on the identical row
    // before, respectively, enqueueing erasure jobs for the document's
    // current versions and deciding whether every one of them has verified.
    // Without this lock (and the refusal below), a version attached in the
    // gap after a purge is queued would have no erasure job of its own — the
    // document would eventually be deleted once its ORIGINAL siblings all
    // verify, cascading this late version away with its bytes permanently
    // unreachable (no job, no document_versions row, no way to rediscover it).
    await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .for('update');
    const activePurgeJob = first(
      await tx
        .select({ id: schema.erasureJobs.id })
        .from(schema.erasureJobs)
        .where(
          and(
            eq(schema.erasureJobs.documentId, input.documentId),
            ne(schema.erasureJobs.status, 'VERIFIED'),
          ),
        )
        .limit(1),
    );
    if (activePurgeJob) {
      return err(
        serviceError(
          'invalid',
          'this document has a retention purge in progress and cannot be modified until it completes',
        ),
      );
    }

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
    await recordProductEvent(tx, {
      eventType: 'DOCUMENT_UPLOADED',
      accountId: input.actorAccountId,
    });
    return ok({ version, storageObject });
  });
}

export interface RegisterDocumentWithVersionInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly originalName: string;
  readonly docType?: string;
  readonly source?: string;
  readonly bucket: StorageBucket;
  readonly objectKey: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
}

/** Carries a `ServiceError` out through a transaction rollback (a returned `err()` does not itself abort the transaction — only a throw does). */
class RegistrationAborted extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

/**
 * Register a brand-new document and attach its first version atomically
 * (master directive §7 "PR 6" — upload consistency). `registerDocument` and
 * `addDocumentVersion` each commit independently when called separately, so
 * a failure in the second call after the first has already succeeded would
 * otherwise leave a document row with zero versions behind — nobody can
 * complete it, and nothing ever retries or cleans it up. Wrapping both in
 * one transaction (a savepoint-backed nested transaction, since each still
 * opens its own) makes that partial state impossible: either both rows
 * exist, or neither does.
 */
export async function registerDocumentWithVersion(
  db: Db,
  input: RegisterDocumentWithVersionInput,
): Promise<Result<AddDocumentVersionResult, ServiceError>> {
  try {
    return await db.transaction(async (tx) => {
      const registered = await registerDocument(tx, {
        actorAccountId: input.actorAccountId,
        applicantId: input.applicantId,
        originalName: input.originalName,
        ...(input.docType !== undefined ? { docType: input.docType } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
      });
      if (!registered.ok) throw new RegistrationAborted(registered.error);

      const versioned = await addDocumentVersion(tx, {
        actorAccountId: input.actorAccountId,
        documentId: registered.value.id,
        bucket: input.bucket,
        objectKey: input.objectKey,
        ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
        ...(input.sha256 !== undefined ? { sha256: input.sha256 } : {}),
      });
      if (!versioned.ok) throw new RegistrationAborted(versioned.error);

      return ok(versioned.value);
    });
  } catch (error) {
    if (error instanceof RegistrationAborted) return err(error.serviceError);
    throw error;
  }
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
  readonly approvedName: string | null;
  readonly docType: string | null;
  readonly latestVersionId: string | null;
  readonly safetyStatus: DocumentVersion['safetyStatus'] | null;
  readonly processingStatus: DocumentVersion['processingStatus'] | null;
  readonly createdAt: string;
  /** A naming proposal awaiting a human decision (Release C), if any. */
  readonly pendingNameVersion: { readonly id: string; readonly proposedName: string } | null;
  /** Deterministic classification of the latest version, if it ran. */
  readonly classification: {
    readonly classifiedType: string | null;
    readonly confidence: number;
    readonly reviewRequired: boolean;
  } | null;
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

    const latestNameVersion = first(
      await db
        .select()
        .from(schema.documentNameVersions)
        .where(eq(schema.documentNameVersions.documentId, doc.id))
        .orderBy(desc(schema.documentNameVersions.versionNumber))
        .limit(1),
    );

    const classification = version
      ? first(
          await db
            .select()
            .from(schema.documentClassifications)
            .where(eq(schema.documentClassifications.documentVersionId, version.id))
            .orderBy(desc(schema.documentClassifications.createdAt))
            .limit(1),
        )
      : undefined;

    summaries.push({
      id: doc.id,
      originalName: doc.originalName,
      approvedName: doc.approvedName,
      docType: doc.docType,
      latestVersionId: version?.id ?? null,
      safetyStatus: version?.safetyStatus ?? null,
      processingStatus: version?.processingStatus ?? null,
      createdAt: doc.createdAt.toISOString(),
      pendingNameVersion:
        latestNameVersion && latestNameVersion.decision === 'PENDING'
          ? { id: latestNameVersion.id, proposedName: latestNameVersion.proposedName }
          : null,
      classification: classification
        ? {
            classifiedType: classification.classifiedType,
            confidence: classification.confidence,
            reviewRequired: classification.reviewRequired,
          }
        : null,
    });
  }
  return ok(summaries);
}

// --- Permission-aware access -----------------------------------------------

/**
 * Processing states from which a version may be previewed/downloaded
 * (master directive §7 "PR 3"). `AWAITING_REVIEW` is the pipeline's normal
 * terminal-success state; `APPROVED` is a further human-review state the
 * pipeline does not yet set but the schema already models — both are safe
 * to serve once `safetyStatus === 'CLEAN'` (checked separately). Everything
 * else (still in flight, quarantined, or a terminal failure/rejection) is
 * excluded by construction.
 */
const SERVABLE_PROCESSING_STATES: ReadonlySet<DocumentState> = new Set([
  'AWAITING_REVIEW',
  'APPROVED',
]);

/**
 * Exported so the UI can gate the preview/download affordance on exactly
 * the same condition the service layer enforces (one canonical definition
 * of "servable" — never two independently-maintained checks that could
 * drift apart).
 */
export function isServableProcessingState(state: DocumentState): boolean {
  return SERVABLE_PROCESSING_STATES.has(state);
}

/**
 * The one canonical "is this document version's content still real"
 * predicate — every consumer that treats a version as usable evidence
 * (`accessDocument`'s preview/download gate, `missions.ts`'s document
 * eligibility for readiness and snapshots) must call this, not maintain its
 * own partial copy.
 *
 * Added `erased` (Codex review, PR-B2, round 4): `accessDocument` gained an
 * erasure-awareness check in round 2/3, but `missions.ts`'s OWN, separate
 * eligibility computation still only checked `safetyStatus`/
 * `processingStatus` — a version whose bytes were already gone (or being
 * actively erased) could still satisfy a mission requirement and be
 * captured as evidence in a snapshot. `erased` is passed in already-resolved
 * (from `hasActiveOrVerifiedErasureJob`/`activeOrVerifiedErasureStorageObjectIds`
 * in `erasure.ts`) rather than looked up here, so this function stays a
 * plain, synchronous predicate usable identically from a single-version
 * check (one query) and a bulk scan (one query for every candidate,
 * avoiding an N+1).
 */
export function isDocumentVersionUsable(input: {
  readonly safetyStatus: DocumentVersion['safetyStatus'];
  readonly processingStatus: DocumentState;
  readonly erased: boolean;
}): boolean {
  return (
    input.safetyStatus === 'CLEAN' &&
    isServableProcessingState(input.processingStatus) &&
    !input.erased
  );
}

/** Best-effort audit identity for an actor (owner carries no account id). */
function actorAudit(actor: Actor): { actorAccountId: string | null; actorRole: string } {
  switch (actor.kind) {
    case 'applicant_owner':
      return { actorAccountId: null, actorRole: 'applicant_owner' };
    case 'organization_member':
      return { actorAccountId: actor.accountId, actorRole: `org:${actor.membership.role}` };
    case 'individual_recipient':
      return { actorAccountId: actor.accountId, actorRole: 'individual_recipient' };
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
  const grants = await loadGrantsForPolicy(db, document.applicantId);
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

  if (!decision.allowed) {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_ACCESS',
        actorAccountId: audit.actorAccountId,
        actorRole: audit.actorRole,
        action,
        result: 'DENIED',
        method: 'API',
        applicantId: document.applicantId,
        resourceType: 'document',
        resourceId: document.id,
        reason: decision.reason,
        metadata: { variant: effectiveVariant, disposition, purpose: input.purpose },
      });
    });
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
  // Safety-state enforcement (master directive §7 "PR 3"): an authorized
  // actor still may not preview/download a version that has not been
  // confirmed CLEAN by the scanner, or that has not reached a servable
  // point in the pipeline — a version sitting in UPLOADING/QUARANTINED/
  // SCANNING (not yet scanned) or NEEDS_ATTENTION/FAILED/REJECTED
  // (confirmed unsafe or otherwise stuck) must never be servable, no matter
  // who is asking. A positive allow-list (not a deny-list) so an unknown
  // future state fails closed by construction rather than needing to be
  // remembered. Checked only after authorization succeeds, so an
  // unauthorized actor learns nothing about the document's safety state.
  //
  // Also excludes a version whose bytes are already erased, or being erased
  // right now (Codex review, PR-B2, rounds 2-3): a multi-version document's
  // row survives — by finding #13's design — for as long as ANY sibling
  // erasure job hasn't verified, even once THIS version's own job has (or
  // is mid-flight). Neither `safetyStatus` nor `processingStatus` reflects
  // that; without this check the read path would issue a working-looking
  // reference to bytes that are already gone or about to be.
  //
  // Authorization and servability are audited as ONE combined decision, in
  // a single DOCUMENT_ACCESS event written only after BOTH gates have been
  // evaluated (Codex review, PR-B3, finding #11) — previously, an
  // authorized-but-not-yet-safe-to-serve request appended ALLOWED here
  // first, then a second DENIED event below for the same request: the
  // append-only audit trail recorded an access that never actually
  // happened, and double-counted the request.
  //
  // "No stored version at all" is folded into this same combined decision
  // (Codex review, PR-B3, round 3) rather than returning early above it: an
  // owner can create a document via `registerDocument` before any version
  // is added, and an authorized access attempt against it was reaching a
  // `not_found` return before this deferred audit append ever ran —
  // producing zero DOCUMENT_ACCESS events for an authorized request,
  // exactly the invisibility finding #11 closed for the safety-gate case.
  const erased = version ? await hasActiveOrVerifiedErasureJob(db, version.storageObjectId) : false;
  const servable =
    version !== undefined &&
    isDocumentVersionUsable({
      safetyStatus: version.safetyStatus,
      processingStatus: version.processingStatus,
      erased,
    });
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_ACCESS',
      actorAccountId: audit.actorAccountId,
      actorRole: audit.actorRole,
      action,
      result: servable ? 'ALLOWED' : 'DENIED',
      method: 'API',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      reason: servable
        ? null
        : !version
          ? 'no_stored_version'
          : erased
            ? 'bytes_already_erased'
            : 'not_yet_safe_to_serve',
      metadata: { variant: effectiveVariant, disposition, purpose: input.purpose },
    });
  });
  if (!version) {
    return err(serviceError('not_found', 'document has no stored version'));
  }
  if (!servable) {
    return err(serviceError('forbidden', 'this document is not yet available'));
  }

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
