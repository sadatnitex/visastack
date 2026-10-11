import type {
  AccountId,
  AgencyId,
  ApplicantId,
  DocumentId,
  DocumentState,
  PermissionAction,
  Result,
} from '@visastack/core';
import { err, ok } from '@visastack/core';
import { type Actor, type Grant as PolicyGrant, authorize } from '@visastack/policy';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { orgGrantPermits } from './agency';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { isInFlightContributorSubmission } from './contributor-requests';
import { type Db, first, required, schema } from './db';
import {
  type DocumentAccessActorKind,
  type DocumentAccessTokenFields,
  appendDocumentAccessToken,
  signDocumentAccessToken,
} from './document-access-token';
import { hasActiveOrVerifiedErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { isValidDocumentDateString } from './expiry';
import { incrementMaterialRevision, missionsSelectingDocument } from './material-revision';
import { listMembershipsForAccount } from './organizations';
import { recordProductEvent } from './product-events';
import { loadGrantsForPolicy } from './sharing';
import type { AccessRef, AccessVariant, StorageBucket, StoragePort } from './storage';
import { loadSupportGrantsForPolicy } from './support-access';

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

/**
 * EVI-06's explicit maximum ("maximum 60-second lifetime, rechecked at
 * redemption"). Was 300 (5 minutes) before Commercial V1 Part 3; a 60-second
 * window alone would still leave a mid-life grant revocation able to redeem
 * successfully, which is why redemption also replays the original
 * authorization decision against live state (see `recheckDocumentAccess`),
 * not just the shorter window on its own.
 */
const DEFAULT_ACCESS_TTL_SECONDS = 60;

// --- Registration (owner-authorized, consent-gated) ------------------------

export interface RegisterDocumentInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly originalName: string;
  readonly docType?: string;
  readonly source?: string;
  // CAS-08: whether this document appears in the applicant's own browsable
  // wallet. True for every normal, owner-initiated registration (the
  // default below matches that). A contributor-initiated one passes this
  // explicitly, driven by the contributor's own allowWalletReuse choice.
  readonly walletVisible?: boolean;
  // CAS-08: set ONLY by contributor-requests.ts's own submission
  // orchestration, never from user input directly, naming the specific,
  // already-claimed (SUBMITTED, not yet completed) contributor_requests row
  // this call is acting under. The one alternate path to the owner-account
  // check below - verified via isInFlightContributorSubmission, not merely
  // trusted because this field is present.
  readonly onBehalfOfContributorRequestId?: string;
}

/** Create a document record owned by the applicant's account (or, narrowly, by a bound CAS-08 contributor acting for it). */
export async function registerDocument(
  db: Db,
  input: RegisterDocumentInput,
): Promise<Result<Document, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    const asContributor =
      input.onBehalfOfContributorRequestId !== undefined &&
      (await isInFlightContributorSubmission(db, {
        contributorRequestId: input.onBehalfOfContributorRequestId,
        actorAccountId: input.actorAccountId,
        applicantId: input.applicantId,
      }));
    if (!asContributor) {
      return err(
        serviceError('forbidden', 'documents may only be registered by the owning account'),
      );
    }
  }
  if (input.originalName.trim().length === 0) {
    return err(serviceError('invalid', 'a document name is required'));
  }
  if (!(await hasConsent(db, applicant.ownerAccountId, 'CORE_PROCESSING'))) {
    return err(serviceError('consent_required', 'Core processing consent is required'));
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
            walletVisible: input.walletVisible ?? true,
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
  // CAS-08: see RegisterDocumentInput's identical field for what this is and how it's verified.
  readonly onBehalfOfContributorRequestId?: string;
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
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    const asContributor =
      input.onBehalfOfContributorRequestId !== undefined &&
      (await isInFlightContributorSubmission(db, {
        contributorRequestId: input.onBehalfOfContributorRequestId,
        actorAccountId: input.actorAccountId,
        applicantId: document.applicantId,
      }));
    if (!asContributor) {
      return err(serviceError('forbidden', 'versions may only be added by the owning account'));
    }
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

    // TRU-03 (Part 7 §4): "selected document version" is material even when
    // the selection itself doesn't change -- see material-revision.ts's own
    // doc comment for why this can't live in missions.ts directly.
    for (const missionId of await missionsSelectingDocument(tx, input.documentId)) {
      await incrementMaterialRevision(tx, missionId);
    }

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
  readonly walletVisible?: boolean;
  readonly onBehalfOfContributorRequestId?: string;
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
        ...(input.walletVisible !== undefined ? { walletVisible: input.walletVisible } : {}),
        ...(input.onBehalfOfContributorRequestId !== undefined
          ? { onBehalfOfContributorRequestId: input.onBehalfOfContributorRequestId }
          : {}),
      });
      if (!registered.ok) throw new RegistrationAborted(registered.error);

      const versioned = await addDocumentVersion(tx, {
        actorAccountId: input.actorAccountId,
        documentId: registered.value.id,
        bucket: input.bucket,
        objectKey: input.objectKey,
        ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
        ...(input.sha256 !== undefined ? { sha256: input.sha256 } : {}),
        ...(input.onBehalfOfContributorRequestId !== undefined
          ? { onBehalfOfContributorRequestId: input.onBehalfOfContributorRequestId }
          : {}),
      });
      if (!versioned.ok) throw new RegistrationAborted(versioned.error);

      return ok(versioned.value);
    });
  } catch (error) {
    if (error instanceof RegistrationAborted) return err(error.serviceError);
    throw error;
  }
}

export interface DuplicateDocumentMatch {
  readonly documentId: string;
  readonly displayName: string;
}

/**
 * Other documents belonging to the SAME applicant that already have a
 * version whose bytes hash identically to `sha256` (EVI-03: "duplicate
 * detection is limited to the authorised subject/scope; do not reveal
 * cross-customer hash matches": the `applicantId` filter here is not an
 * optimization, it is the entire safety requirement this exists to meet).
 * Checks every version of every other document, not only the latest: a
 * duplicate of a superseded version is still meaningfully "you already have
 * this file," and this is advisory only (informs the caller; never blocks
 * or rejects the upload it's checking against).
 */
export async function findDuplicateVersions(
  db: Db,
  input: {
    readonly applicantId: string;
    readonly sha256: string;
    readonly excludeDocumentId: string;
  },
): Promise<DuplicateDocumentMatch[]> {
  const rows = await db
    .selectDistinct({
      documentId: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
    })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(
      and(
        eq(schema.documents.applicantId, input.applicantId),
        eq(schema.documentVersions.sha256, input.sha256),
        ne(schema.documents.id, input.excludeDocumentId),
      ),
    );
  return rows.map((r) => ({
    documentId: r.documentId,
    displayName: r.approvedName ?? r.originalName,
  }));
}

// --- Document review (EVI-03) ------------------------------------------
//
// "Document review supports pending, accepted, replacement required,
// irrelevant and disputed." A judgment on the EVIDENCE itself (is this
// document acceptable), distinct from `missionDecisions` (a
// requirement-scoped, mission-specific judgment in `agency.ts`) and from
// `processingStatus`/`safetyStatus` (pipeline state, not a reviewer's
// opinion). Append-only, like every other decision-history table in this
// schema: the latest row per document is "the" current review status.

export type DocumentReview = typeof schema.documentReviews.$inferSelect;

/**
 * Records a review outcome for a document (applicant owner, or an active
 * member of an organization whose grant currently permits `COMMENT` on
 * this applicant). Mirrors `addNote`'s own authorization shape exactly:
 * the same bar that lets an org comment on a mission's case notes is the
 * bar for judging whether the evidence itself is acceptable. Append-only;
 * never updates or deletes a prior review, so a disputed history stays
 * fully readable even after a later outcome supersedes it.
 */
export async function recordDocumentReview(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly documentId: string;
    readonly outcome: DocumentReview['outcome'];
    readonly reason?: string;
  },
): Promise<Result<DocumentReview, ServiceError>> {
  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .limit(1),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));

  const applicant = await getApplicant(db, document.applicantId);
  let authorized = applicant?.ownerAccountId === input.actorAccountId;
  if (!authorized) {
    const memberships = await listMembershipsForAccount(db, input.actorAccountId);
    for (const membership of memberships) {
      if (!membership.active) continue;
      if (await orgGrantPermits(db, membership.organization.id, document.applicantId, 'COMMENT')) {
        authorized = true;
        break;
      }
    }
  }
  if (!authorized) return err(serviceError('forbidden', 'not authorized to review this document'));

  return db.transaction(async (tx) => {
    const review = required(
      first(
        await tx
          .insert(schema.documentReviews)
          .values({
            documentId: input.documentId,
            outcome: input.outcome,
            reason: input.reason ?? null,
            reviewedByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'review',
    );
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_REVIEWED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      metadata: { outcome: input.outcome },
    });
    return ok(review);
  });
}

/**
 * Set or clear a document's own claimed date (NTF-01, Part 5 §1
 * "case-specific freshness/staleness"): the "as of" date the Expiry
 * Centre's `classifyStaleness` compares against a requirement's
 * `maxAgeDays`. Owner-asserted, like `walletVisible` - nothing extracts
 * this automatically today, so it stays `null` ("unknown expiry remains
 * unknown") until a human enters it. Same authorization as
 * `recordDocumentReview`: the applicant owner, or an org member holding at
 * least COMMENT on this applicant.
 */
export async function setDocumentDate(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly documentId: string;
    /** Strict `YYYY-MM-DD`, not in the future; `null` clears a mistaken entry. Validate with `isValidDocumentDateString` before calling. */
    readonly documentDate: string | null;
  },
): Promise<Result<Document, ServiceError>> {
  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .limit(1),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));

  const applicant = await getApplicant(db, document.applicantId);
  let authorized = applicant?.ownerAccountId === input.actorAccountId;
  if (!authorized) {
    const memberships = await listMembershipsForAccount(db, input.actorAccountId);
    for (const membership of memberships) {
      if (!membership.active) continue;
      if (await orgGrantPermits(db, membership.organization.id, document.applicantId, 'COMMENT')) {
        authorized = true;
        break;
      }
    }
  }
  if (!authorized) return err(serviceError('forbidden', 'not authorized to edit this document'));

  if (input.documentDate !== null && !isValidDocumentDateString(input.documentDate)) {
    return err(
      serviceError('invalid', 'documentDate must be a valid YYYY-MM-DD date, not in the future'),
    );
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.documents)
          .set({ documentDate: input.documentDate })
          .where(eq(schema.documents.id, input.documentId))
          .returning(),
      ),
      'document',
    );
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_DATE_SET',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      metadata: { documentDate: input.documentDate },
    });
    return ok(updated);
  });
}

/** The current (most recent) review outcome for a document, or `undefined` if never reviewed. */
export async function getCurrentDocumentReview(
  db: Db,
  documentId: string,
): Promise<DocumentReview | undefined> {
  return first(
    await db
      .select()
      .from(schema.documentReviews)
      .where(eq(schema.documentReviews.documentId, documentId))
      .orderBy(desc(schema.documentReviews.createdAt))
      .limit(1),
  );
}

/** Full review history for a document, newest first (audit/transparency). */
export async function listDocumentReviews(db: Db, documentId: string): Promise<DocumentReview[]> {
  return db
    .select()
    .from(schema.documentReviews)
    .where(eq(schema.documentReviews.documentId, documentId))
    .orderBy(desc(schema.documentReviews.createdAt));
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
  readonly latestVersionNumber?: number | null;
  readonly updatedAt?: string;
  readonly safetyStatus: DocumentVersion['safetyStatus'] | null;
  readonly processingStatus: DocumentVersion['processingStatus'] | null;
  readonly createdAt: string;
  /** NTF-01: the document's own claimed date (`YYYY-MM-DD`), for case-specific staleness. `null` = unknown, never fabricated. */
  readonly documentDate: string | null;
  readonly expiresAt: string | null;
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

  // Three queries for the whole list, not three per document. Measured on a database 40 ms away,
  // the per-document version took 1.3 s at p95 for a traveller with six documents
  // (docs/operations/capacity.md).
  const documentIds = listed.value.map((doc) => doc.id);
  const latestVersion = new Map<string, DocumentVersion>();
  const latestNameVersion = new Map<string, typeof schema.documentNameVersions.$inferSelect>();
  const latestClassification = new Map<
    string,
    typeof schema.documentClassifications.$inferSelect
  >();
  if (documentIds.length > 0) {
    const versions = await db
      .select()
      .from(schema.documentVersions)
      .where(inArray(schema.documentVersions.documentId, documentIds))
      .orderBy(desc(schema.documentVersions.versionNumber));
    for (const version of versions) {
      if (!latestVersion.has(version.documentId)) latestVersion.set(version.documentId, version);
    }
    const nameVersions = await db
      .select()
      .from(schema.documentNameVersions)
      .where(inArray(schema.documentNameVersions.documentId, documentIds))
      .orderBy(desc(schema.documentNameVersions.versionNumber));
    for (const nameVersion of nameVersions) {
      if (!latestNameVersion.has(nameVersion.documentId)) {
        latestNameVersion.set(nameVersion.documentId, nameVersion);
      }
    }
    const latestVersionIds = [...latestVersion.values()].map((version) => version.id);
    if (latestVersionIds.length > 0) {
      const classifications = await db
        .select()
        .from(schema.documentClassifications)
        .where(inArray(schema.documentClassifications.documentVersionId, latestVersionIds))
        .orderBy(desc(schema.documentClassifications.createdAt));
      for (const classification of classifications) {
        if (!latestClassification.has(classification.documentVersionId)) {
          latestClassification.set(classification.documentVersionId, classification);
        }
      }
    }
  }

  const summaries: DocumentSummary[] = listed.value.map((doc) => {
    const version = latestVersion.get(doc.id);
    const nameVersion = latestNameVersion.get(doc.id);
    const classification = version ? latestClassification.get(version.id) : undefined;
    return {
      id: doc.id,
      originalName: doc.originalName,
      approvedName: doc.approvedName,
      docType: doc.docType,
      latestVersionId: version?.id ?? null,
      latestVersionNumber: version?.versionNumber ?? null,
      updatedAt: new Date(
        Math.max(
          doc.updatedAt.getTime(),
          version?.updatedAt.getTime() ?? 0,
          nameVersion?.createdAt.getTime() ?? 0,
        ),
      ).toISOString(),
      safetyStatus: version?.safetyStatus ?? null,
      processingStatus: version?.processingStatus ?? null,
      createdAt: doc.createdAt.toISOString(),
      documentDate: doc.documentDate,
      expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
      pendingNameVersion:
        nameVersion && nameVersion.decision === 'PENDING'
          ? { id: nameVersion.id, proposedName: nameVersion.proposedName }
          : null,
      classification: classification
        ? {
            classifiedType: classification.classifiedType,
            confidence: classification.confidence,
            reviewRequired: classification.reviewRequired,
          }
        : null,
    };
  });
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
  /**
   * Signs the redemption-time access-context token (EVI-06/SEC-05). The
   * same secret the storage backend uses to sign its own blob token
   * (`BLOB_SIGNING_SECRET`); a distinct namespace prefix inside the signed
   * payload (`document-access-token.ts`'s `DAT1`) keeps the two token
   * kinds from ever being confused, so reusing the secret needs no new
   * secret-provisioning step.
   */
  readonly accessTokenSecret: string;
}

/** Reduces an `Actor` to the fields `document-access-token.ts` needs to reconstruct it fresh at redemption. */
function actorAccessContext(actor: Actor): {
  readonly actorKind: DocumentAccessActorKind;
  readonly actorAccountId?: string;
  readonly organizationId?: string;
} {
  switch (actor.kind) {
    case 'applicant_owner':
      return { actorKind: actor.kind };
    case 'organization_member':
      return {
        actorKind: actor.kind,
        actorAccountId: actor.accountId,
        organizationId: actor.membership.organizationId,
      };
    case 'individual_recipient':
    case 'support_admin':
      return { actorKind: actor.kind, actorAccountId: actor.accountId };
  }
}

/**
 * Ordinary grants for this applicant, plus this actor's own active support
 * grants merged in when the actor is `support_admin`. `authorize()`'s
 * `support_admin` case (`packages/policy/src/authorize.ts`) filters
 * candidate grants by `recipientAccountId`, the same shape
 * `loadSupportGrantsForPolicy` already converts a support grant row into,
 * so merging it into the same list is sufficient; no separate authorization
 * path is needed. Previously always omitted here, which made support_admin
 * document access structurally unreachable regardless of any support grant
 * that existed (known-issues.md item 23) even though SEC-06's own
 * support-grant issuance/approval/revocation machinery was itself correct.
 * Skipped for every other actor kind to avoid an unneeded query on the
 * ordinary preview/download path.
 */
async function loadGrantsForActor(
  db: Db,
  applicantId: string,
  actor: Actor,
): Promise<PolicyGrant[]> {
  const grants = await loadGrantsForPolicy(db, applicantId);
  if (actor.kind !== 'support_admin') return grants;
  const supportGrants = await loadSupportGrantsForPolicy(db, applicantId);
  return [...grants, ...supportGrants];
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

  // Preview is ALWAYS the rendered `redacted` derivative, for the owner and
  // any third party alike (PRD §5: "Use safe rendered previews with active
  // content removed; originals are explicit downloads, never an untrusted
  // inline PDF shortcut", corrected this chunk; an earlier build gave the
  // owner the raw original here, which the newer PRD text explicitly rules
  // out). `/api/blob/[key]` renders it via `PreviewRendererPort`; it never
  // falls through to original bytes. Downloads keep the requested variant
  // (original still requires DOWNLOAD_ORIGINAL + step-up).
  const effectiveVariant: AccessVariant = disposition === 'preview' ? 'redacted' : variant;

  const now = input.now ?? new Date();
  const grants = await loadGrantsForActor(db, document.applicantId, input.actor);
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
    // The current approved name if one exists, else the preserved original,
    // never the opaque storage key (master directive §10/§18/§21E).
    filename: document.approvedName ?? document.originalName,
  });

  // A second, separate signed token (EVI-06/SEC-05) riding alongside the
  // storage-generic blob token on the same URL, carrying just enough for
  // the serving route to replay this exact authorization decision against
  // LIVE state at redemption. See document-access-token.ts's module doc
  // comment for why this is not folded into the blob token itself.
  const accessTokenFields: Omit<DocumentAccessTokenFields, 'sig'> = {
    documentId: document.id,
    documentVersionId: version.id,
    ...actorAccessContext(input.actor),
    action,
    purpose: input.purpose,
    stepUpSatisfied: input.stepUpSatisfied ?? false,
    exp: Math.floor(now.getTime() / 1000) + DEFAULT_ACCESS_TTL_SECONDS,
  };
  const signedAccessTokenFields: DocumentAccessTokenFields = {
    ...accessTokenFields,
    sig: signDocumentAccessToken(input.accessTokenSecret, accessTokenFields),
  };
  return ok({ ...ref, url: appendDocumentAccessToken(ref.url, signedAccessTokenFields) });
}

export type RecheckDocumentAccessResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Replays the original authorization decision against LIVE state, called by
 * the serving route at redemption (EVI-06/SEC-05: "redemption must recheck
 * access", "revoking a grant before redemption must make an already issued
 * token fail"). Never trusts anything the token itself claims about CURRENT
 * state beyond its own signature/expiry (already verified by the caller):
 * membership, grants, and document servability are all re-read fresh from
 * the database here, not replayed from a mint-time snapshot.
 *
 * Deliberately returns a reason string rather than throwing or returning a
 * bare boolean: the serving route logs which check actually failed, without
 * that reason ever reaching the unauthenticated caller in the HTTP response.
 */
export async function recheckDocumentAccess(
  db: Db,
  fields: Omit<DocumentAccessTokenFields, 'sig' | 'exp'>,
  now: Date = new Date(),
): Promise<RecheckDocumentAccessResult> {
  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, fields.documentId))
      .limit(1),
  );
  if (!document) return { allowed: false, reason: 'document_not_found' };

  let actor: Actor;
  switch (fields.actorKind) {
    case 'applicant_owner':
      actor = { kind: 'applicant_owner', applicantId: document.applicantId as ApplicantId };
      break;
    case 'organization_member': {
      if (!fields.actorAccountId || !fields.organizationId) {
        return { allowed: false, reason: 'missing_organization_member_context' };
      }
      // Fetched fresh, never trusted from the token: a membership
      // deactivated after mint must be reflected here, not the mint-time
      // snapshot the actor originally presented.
      const memberships = await listMembershipsForAccount(db, fields.actorAccountId);
      const membership = memberships.find((m) => m.organization.id === fields.organizationId);
      if (!membership) return { allowed: false, reason: 'membership_not_found' };
      actor = {
        kind: 'organization_member',
        accountId: fields.actorAccountId as AccountId,
        membership: {
          organizationId: fields.organizationId as AgencyId,
          role: membership.role,
          active: membership.active,
          organizationActive: membership.organization.status === 'ACTIVE',
        },
      };
      break;
    }
    case 'individual_recipient':
      if (!fields.actorAccountId) return { allowed: false, reason: 'missing_actor_account_id' };
      actor = { kind: 'individual_recipient', accountId: fields.actorAccountId as AccountId };
      break;
    case 'support_admin':
      if (!fields.actorAccountId) return { allowed: false, reason: 'missing_actor_account_id' };
      actor = { kind: 'support_admin', accountId: fields.actorAccountId as AccountId };
      break;
  }

  // Grants are already loaded live (loadGrantsForActor queries the
  // database directly, never a cache), so a grant revoked after mint is
  // simply absent/inactive here. Support grants are included for a
  // support_admin actor, matching accessDocument's own mint-time behaviour
  // (known-issues.md item 23).
  const grants = await loadGrantsForActor(db, document.applicantId, actor);
  const decision = authorize({
    actor,
    action: fields.action,
    resource: {
      applicantId: document.applicantId as ApplicantId,
      documentId: document.id as DocumentId,
    },
    context: { now, purpose: fields.purpose, stepUpSatisfied: fields.stepUpSatisfied, grants },
  });
  if (!decision.allowed) return { allowed: false, reason: decision.reason };

  // "Exact version" (directive §10): re-checks the SAME version
  // `accessDocument` resolved at mint time (whose storage object the
  // accompanying blob token's objectKey is bound to) -- never "whatever
  // document_versions reports as latest right now". Re-deriving "latest"
  // here would check a DIFFERENT row than the one actually being served
  // the moment a new version appears between mint and redemption: a newer
  // sibling being servable must never paper over the minted version having
  // since been erased or otherwise made unusable, and the reverse (a newer
  // sibling being unsafe) must never block redemption of a still-servable
  // minted version either.
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, fields.documentVersionId))
      .limit(1),
  );
  if (!version || version.documentId !== document.id) {
    return { allowed: false, reason: 'no_stored_version' };
  }
  const erased = await hasActiveOrVerifiedErasureJob(db, version.storageObjectId);
  const servable = isDocumentVersionUsable({
    safetyStatus: version.safetyStatus,
    processingStatus: version.processingStatus,
    erased,
  });
  if (!servable) return { allowed: false, reason: 'not_yet_safe_to_serve' };

  return { allowed: true };
}

/**
 * Permission-checked preview. Always issues a `redacted` variant, a
 * rendered, active-content-stripped derivative, for the owner and any
 * third party alike; preview never exposes original bytes to anyone (PRD
 * §5). The original is reachable only via `downloadDocument`'s explicit
 * `DOWNLOAD_ORIGINAL` action (step-up required).
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
