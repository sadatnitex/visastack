import type { Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { AuthorizedApplicant } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { type Db, schema } from '../../db';
import { isDocumentVersionUsable } from '../../documents';
import { activeOrVerifiedErasureStorageObjectIds } from '../../erasure';
import { type ServiceError, serviceError } from '../../errors';
// Imported by the foundation's path, which the read-path guard recognises.
import {
  everydayDocumentCondition,
  presentDocumentCondition,
} from '../../lifecycle/foundation/conditions';
import { incrementMaterialRevision } from '../../material-revision';
import { createTask } from '../../missions';
import { recordProductEvent } from '../../product-events';
import { lifecycleAccessCovers, lifecycleCommandCovers } from '../foundation/access';
import { availableDocumentActions } from '../foundation/actions';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { getDocumentLifecycles } from '../foundation/state';

/*
 * Replace With a Newer Document (LC-B, PROGRAMME section 3 and lanes/B.md).
 *
 * The old document is never changed or removed: it is linked forward to the newer one
 * (`documents.superseded_by_document_id`), every case that selected it gets a material revision
 * bump (its confirmation no longer stands) and a visible task, and every snapshot stays exactly
 * as it was. Only the record owner may replace, and only with another of the same person's
 * documents.
 */

/** A case that selected the old document and is flagged by the replacement. */
export interface ReplacedInCase {
  readonly missionId: string;
  readonly title: string;
}

export interface ReplaceDocumentOutcome {
  readonly flaggedMissionIds: readonly string[];
  readonly cases: readonly ReplacedInCase[];
}

/** One document that can be chosen as the newer one. */
export interface ReplacementCandidate {
  readonly documentId: string;
  readonly name: string;
  readonly uploadedAt: Date;
  /** Checked and readable: it can be chosen now. False while the safety check is still running. */
  readonly ready: boolean;
}

export interface ReplacementOptions {
  /** The kind of the document being replaced (catalogue key), or null when not known yet. */
  readonly docType: string | null;
  readonly candidates: readonly ReplacementCandidate[];
  /** The cases that will be updated and will need to be confirmed again. */
  readonly cases: readonly ReplacedInCase[];
}

const SAME_DOCUMENT = 'a document cannot replace itself';
const ALREADY_REPLACED = 'this document has already been replaced';
const NEWER_ALREADY_REPLACED = 'the newer document has itself been replaced';
const NOT_USABLE = 'the newer document is still being checked or cannot be opened';
const NOT_CURRENT = 'only a current document can be replaced, with another current document';
const OTHER_KIND = 'the newer document must be the same kind of document';

function documentName(row: {
  readonly approvedName: string | null;
  readonly originalName: string;
}) {
  return row.approvedName ?? row.originalName;
}

/** Whether the latest version of each document is checked, readable and not being erased. */
async function usableDocuments(
  db: Db,
  documentIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (documentIds.length === 0) return new Set();
  const versions = await db
    .select({
      documentId: schema.documentVersions.documentId,
      versionNumber: schema.documentVersions.versionNumber,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
      storageObjectId: schema.documentVersions.storageObjectId,
    })
    .from(schema.documentVersions)
    .where(inArray(schema.documentVersions.documentId, [...documentIds]));
  const latest = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    const seen = latest.get(version.documentId);
    if (!seen || version.versionNumber > seen.versionNumber)
      latest.set(version.documentId, version);
  }
  const erased = await activeOrVerifiedErasureStorageObjectIds(
    db,
    [...latest.values()].map((version) => version.storageObjectId),
  );
  const usable = new Set<string>();
  for (const version of latest.values()) {
    if (
      isDocumentVersionUsable({
        safetyStatus: version.safetyStatus,
        processingStatus: version.processingStatus,
        erased: erased.has(version.storageObjectId),
      })
    ) {
      usable.add(version.documentId);
    }
  }
  return usable;
}

/** The cases selecting `documentId`, by name, oldest first. */
async function casesSelecting(db: Db, documentId: string): Promise<ReplacedInCase[]> {
  return db
    .selectDistinct({
      missionId: schema.missions.id,
      title: schema.missions.title,
      createdAt: schema.missions.createdAt,
    })
    .from(schema.selectedEvidence)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.selectedEvidence.missionId))
    .where(eq(schema.selectedEvidence.documentId, documentId))
    .orderBy(asc(schema.missions.createdAt), asc(schema.missions.id))
    .then((rows) => rows.map((row) => ({ missionId: row.missionId, title: row.title })));
}

/**
 * How the shared logic is called. `replaceDocument` (every new caller) checks everything.
 * `supersedeDocument` (wallet.ts, kept with its old signature for older tests) passes
 * `legacy: true`, which skips only the two checks it never had: that the newer document is
 * usable and of the same kind. It has no caller outside tests.
 */
export interface ApplyReplacementOptions {
  readonly legacy: boolean;
}

/**
 * The replace logic shared by `replaceDocument` and `supersedeDocument`. Takes the owner's MANAGE
 * proof; refuses the same document, a loop, an already-replaced document, a document of another
 * person and (unless legacy) a newer document that is not usable or not the same kind.
 */
export async function applyReplacement(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly oldDocumentId: string; readonly newDocumentId: string },
  options: ApplyReplacementOptions,
): Promise<Result<ReplaceDocumentOutcome, ServiceError>> {
  const applicantId = access.applicant.id;
  if (!lifecycleCommandCovers(access, applicantId)) {
    return err(serviceError('forbidden', 'only the record owner can replace a document'));
  }
  if (!isUuid(input.oldDocumentId) || !isUuid(input.newDocumentId)) {
    return err(serviceError('not_found', 'document not found'));
  }
  const oldId = input.oldDocumentId.toLowerCase();
  const newId = input.newDocumentId.toLowerCase();
  if (oldId === newId) return err(serviceError('invalid', SAME_DOCUMENT));

  const db = access.tx;
  const lifecycle = await lifecycleTablesPresent(db);
  const loadPair = (tx: Db, lock: boolean) => {
    const query = tx
      .select({
        id: schema.documents.id,
        docType: schema.documents.docType,
        originalName: schema.documents.originalName,
        approvedName: schema.documents.approvedName,
        supersededBy: schema.documents.supersededByDocumentId,
      })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, [oldId, newId]),
          // Same person only: a document of anyone else is simply not found.
          eq(schema.documents.applicantId, applicantId),
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      )
      .orderBy(asc(schema.documents.id));
    return lock ? query.for('update') : query;
  };

  const check = async (tx: Db, lock: boolean) => {
    const rows = await loadPair(tx, lock);
    const oldDocument = rows.find((row) => row.id === oldId);
    const newDocument = rows.find((row) => row.id === newId);
    if (!oldDocument) return err(serviceError('not_found', 'document not found'));
    if (!newDocument) return err(serviceError('not_found', 'replacement document not found'));
    if (oldDocument.supersededBy) return err(serviceError('invalid', ALREADY_REPLACED));
    // A loop: the newer document was itself replaced (by the old one or by anything else), so
    // linking the old one to it would point at an outdated document or close a circle.
    if (newDocument.supersededBy) return err(serviceError('invalid', NEWER_ALREADY_REPLACED));
    return ok({ oldDocument, newDocument });
  };

  const before = await check(db, false);
  if (!before.ok) return before;
  const { oldDocument, newDocument } = before.value;

  if (
    !options.legacy &&
    oldDocument.docType !== null &&
    newDocument.docType !== oldDocument.docType
  ) {
    return err(serviceError('invalid', OTHER_KIND));
  }
  if (lifecycle) {
    const states = await getDocumentLifecycles(db, [oldId, newId], access);
    const oldState = states.get(oldId);
    const newState = states.get(newId);
    const oldAllowsReplace =
      oldState !== undefined &&
      availableDocumentActions({
        state: oldState.state,
        replaced: oldState.replaced,
        isDuplicate: false,
        duplicateBlockReason: null,
        pendingRequest: false,
        legalHold: false,
        requestsSwitchOn: false,
      }).includes('REPLACE');
    if (!oldAllowsReplace || newState?.state !== 'CURRENT') {
      return err(serviceError('invalid', NOT_CURRENT));
    }
  }
  if (!options.legacy && !(await usableDocuments(db, [newId])).has(newId)) {
    return err(serviceError('invalid', NOT_USABLE));
  }

  const actorAccountId = access.applicant.ownerAccountId;
  return db.transaction(async (tx) => {
    // Both rows locked in id order, then checked again: two replacements at once (the same one
    // twice, or A by B and B by A) cannot both pass.
    const locked = await check(tx, true);
    if (!locked.ok) return locked;
    // Conditional as well, so the old document is linked forward exactly once.
    const updated = await tx
      .update(schema.documents)
      .set({ supersededByDocumentId: newId })
      .where(and(eq(schema.documents.id, oldId), isNull(schema.documents.supersededByDocumentId)))
      .returning({ id: schema.documents.id });
    if (updated.length === 0) return err(serviceError('invalid', ALREADY_REPLACED));

    const cases = await casesSelecting(tx, oldId);
    const name = documentName(locked.value.oldDocument);
    for (const { missionId } of cases) {
      // A replaced document is a material change (v1.2 E03): bump the case revision in this
      // same transaction, which also voids a live confirmation made with the old document.
      // Snapshots stay exact.
      await incrementMaterialRevision(tx, missionId);
      const task = await createTask(tx, {
        actorAccountId,
        missionId,
        description: `"${name}" was replaced with a newer document. Check that this case uses the right one, then confirm the case again.`,
      });
      if (!task.ok) throw new Error(`replace: case task refused (${task.error.code})`);
    }

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_SUPERSEDED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: oldId,
      metadata: { newDocumentId: newId, flaggedMissionCount: cases.length },
    });
    await recordProductEvent(tx, { eventType: 'DOCUMENT_REPLACED', accountId: actorAccountId });

    return ok({ flaggedMissionIds: cases.map((c) => c.missionId), cases });
  });
}

/**
 * Replace With a Newer Document. `access` is the record owner's MANAGE proof (requireAccess) for
 * the applicant both documents belong to. The old document stays exactly as it was and is shown
 * as Replaced; every case that selected it is flagged and will need to be confirmed again.
 */
export async function replaceDocument(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly oldDocumentId: string; readonly newDocumentId: string },
): Promise<Result<ReplaceDocumentOutcome, ServiceError>> {
  return applyReplacement(access, input, { legacy: false });
}

/**
 * What the Replace flow shows for one document: the documents of the same kind that could be the
 * newer one (newest first, with whether each is ready to choose) and the cases that will be
 * updated. Owner only; refused when the document cannot be replaced.
 */
export async function listReplacementOptions(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly oldDocumentId: string },
): Promise<Result<ReplacementOptions, ServiceError>> {
  const applicantId = access.applicant.id;
  if (!lifecycleCommandCovers(access, applicantId) || !lifecycleAccessCovers(access, applicantId)) {
    return err(serviceError('forbidden', 'only the record owner can replace a document'));
  }
  if (!isUuid(input.oldDocumentId)) return err(serviceError('not_found', 'document not found'));
  const oldId = input.oldDocumentId.toLowerCase();
  const db = access.tx;
  const lifecycle = await lifecycleTablesPresent(db);

  const [oldDocument] = await db
    .select({
      id: schema.documents.id,
      docType: schema.documents.docType,
      supersededBy: schema.documents.supersededByDocumentId,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, oldId),
        eq(schema.documents.applicantId, applicantId),
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    );
  if (!oldDocument) return err(serviceError('not_found', 'document not found'));
  if (oldDocument.supersededBy) return err(serviceError('invalid', ALREADY_REPLACED));

  const rows = await db
    .select({
      id: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, applicantId),
        ne(schema.documents.id, oldId),
        isNull(schema.documents.supersededByDocumentId),
        // Only what the person sees in their own documents (CAS-08).
        eq(schema.documents.walletVisible, true),
        oldDocument.docType === null
          ? undefined
          : eq(schema.documents.docType, oldDocument.docType),
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    )
    .orderBy(desc(schema.documents.createdAt), asc(schema.documents.id))
    .limit(50);
  const usable = await usableDocuments(
    db,
    rows.map((row) => row.id),
  );
  return ok({
    docType: oldDocument.docType,
    candidates: rows.map((row) => ({
      documentId: row.id,
      name: documentName(row),
      uploadedAt: row.createdAt,
      ready: usable.has(row.id),
    })),
    cases: await casesSelecting(db, oldId),
  });
}
