import type { Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, isNull, ne, notInArray } from 'drizzle-orm';
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
import { lifecycleCommandCovers } from '../foundation/access';
import { availableDocumentActions } from '../foundation/actions';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { getDocumentLifecycles } from '../foundation/state';

/*
 * Replace With a Newer Document (LC-B, PROGRAMME section 3 and lanes/B.md).
 *
 * The old document is never changed or removed: it is linked forward to the newer one
 * (`documents.superseded_by_document_id`). Every open case that selected it gets a material
 * revision bump (its confirmation no longer stands) and a visible task; a finished case keeps
 * its record exactly as it was, and every snapshot stays byte-identical. Only the record owner
 * may replace, and only with another of the same person's current documents.
 */

/** Why a replacement is refused. The web layer maps these exact messages to its own words. */
export const REPLACE_REFUSALS = {
  notOwner: 'only the record owner can replace a document',
  sameDocument: 'a document cannot replace itself',
  alreadyReplaced: 'this document has already been replaced',
  newerReplaced: 'the newer document has itself been replaced',
  checking: 'the newer document is still being checked',
  cannotUse: 'the newer document cannot be used',
  expired: 'the newer document has expired',
  notCurrent: 'only a current document can be replaced, with another current document',
  otherKind: 'the newer document must be the same kind of document',
} as const;

/**
 * Case states that are over (owner decision D5: closed, cancelled, submitted). A replacement
 * leaves them exactly as they were: no revision bump, no task, not listed as updated.
 */
export const FINISHED_CASE_STATES_FOR_REPLACE = ['CLOSED', 'CANCELLED', 'SUBMITTED'] as const;

/** A case that selected the old document and is flagged by the replacement. */
export interface ReplacedInCase {
  readonly missionId: string;
  readonly title: string;
}

export interface ReplaceDocumentOutcome {
  readonly flaggedMissionIds: readonly string[];
  readonly cases: readonly ReplacedInCase[];
}

/**
 * Whether a document can be chosen as the newer one: READY (checked and readable), CHECKING
 * (the safety check or reading is still running) or CANNOT_USE (failed, quarantined, being
 * erased, expired, or never had a file).
 */
export type ReplacementStatus = 'READY' | 'CHECKING' | 'CANNOT_USE';

/** One document that can be chosen as the newer one. */
export interface ReplacementCandidate {
  readonly documentId: string;
  readonly name: string;
  readonly uploadedAt: Date;
  readonly status: ReplacementStatus;
}

export interface ReplacementOptions {
  /** The kind of the document being replaced (catalogue key), or null when not known yet. */
  readonly docType: string | null;
  readonly candidates: readonly ReplacementCandidate[];
  /** The open cases that will be updated and will need to be confirmed again. */
  readonly cases: readonly ReplacedInCase[];
}

const IN_FLIGHT_SAFETY: ReadonlySet<string> = new Set(['PENDING', 'SCANNING']);
const IN_FLIGHT_PROCESSING: ReadonlySet<string> = new Set([
  'UPLOADING',
  'QUARANTINED',
  'SCANNING',
  'NORMALIZING',
  'EXTRACTING',
]);

function documentName(row: {
  readonly approvedName: string | null;
  readonly originalName: string;
}) {
  return row.approvedName ?? row.originalName;
}

/**
 * The status of each document's latest version: the same "usable" rule as previews and case
 * readiness (`isDocumentVersionUsable`), plus "not expired" as readiness also requires.
 */
async function replacementStatuses(
  db: Db,
  documents: readonly { readonly id: string; readonly expiresAt: Date | null }[],
  now: Date,
): Promise<ReadonlyMap<string, ReplacementStatus>> {
  const statuses = new Map<string, ReplacementStatus>();
  if (documents.length === 0) return statuses;
  const versions = await db
    .select({
      documentId: schema.documentVersions.documentId,
      versionNumber: schema.documentVersions.versionNumber,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
      storageObjectId: schema.documentVersions.storageObjectId,
    })
    .from(schema.documentVersions)
    .where(
      inArray(
        schema.documentVersions.documentId,
        documents.map((doc) => doc.id),
      ),
    );
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
  for (const doc of documents) {
    const version = latest.get(doc.id);
    if (!version || erased.has(version.storageObjectId)) {
      statuses.set(doc.id, 'CANNOT_USE');
    } else if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) {
      statuses.set(doc.id, 'CANNOT_USE');
    } else if (
      isDocumentVersionUsable({
        safetyStatus: version.safetyStatus,
        processingStatus: version.processingStatus,
        erased: false,
      })
    ) {
      statuses.set(doc.id, 'READY');
    } else if (
      IN_FLIGHT_SAFETY.has(version.safetyStatus) ||
      (version.safetyStatus === 'CLEAN' && IN_FLIGHT_PROCESSING.has(version.processingStatus))
    ) {
      statuses.set(doc.id, 'CHECKING');
    } else {
      statuses.set(doc.id, 'CANNOT_USE');
    }
  }
  return statuses;
}

/** The open cases selecting `documentId`, by name, oldest first. */
async function openCasesSelecting(db: Db, documentId: string): Promise<ReplacedInCase[]> {
  const rows = await db
    .selectDistinct({
      missionId: schema.missions.id,
      title: schema.missions.title,
      createdAt: schema.missions.createdAt,
    })
    .from(schema.selectedEvidence)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.selectedEvidence.missionId))
    .where(
      and(
        eq(schema.selectedEvidence.documentId, documentId),
        notInArray(schema.missions.state, [...FINISHED_CASE_STATES_FOR_REPLACE]),
      ),
    )
    .orderBy(asc(schema.missions.createdAt), asc(schema.missions.id));
  return rows.map((row) => ({ missionId: row.missionId, title: row.title }));
}

/**
 * How the shared logic is called. `replaceDocument` (every new caller) checks everything.
 * `supersedeDocument` (wallet.ts, kept with its old signature for older tests) passes
 * `legacy: true`, which skips only the checks it never had: that the newer document is usable,
 * not expired, of the same kind and shown in the person's documents. It has no caller outside
 * tests.
 */
export interface ApplyReplacementOptions {
  readonly legacy: boolean;
}

interface PairRow {
  readonly id: string;
  readonly docType: string | null;
  readonly originalName: string;
  readonly approvedName: string | null;
  readonly expiresAt: Date | null;
  readonly walletVisible: boolean;
  readonly supersededBy: string | null;
}

/**
 * The replace logic shared by `replaceDocument` and `supersedeDocument`. Takes the owner's MANAGE
 * proof; refuses the same document, a loop, an already-replaced document, a document of another
 * person, a document that is not current and (unless legacy) a newer document that is not
 * usable, expired, of another kind or not among the person's own documents.
 */
export async function applyReplacement(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly oldDocumentId: string; readonly newDocumentId: string },
  options: ApplyReplacementOptions,
): Promise<Result<ReplaceDocumentOutcome, ServiceError>> {
  const applicantId = access.applicant.id;
  if (!lifecycleCommandCovers(access, applicantId)) {
    return err(serviceError('forbidden', REPLACE_REFUSALS.notOwner));
  }
  if (!isUuid(input.oldDocumentId) || !isUuid(input.newDocumentId)) {
    return err(serviceError('not_found', 'document not found'));
  }
  const oldId = input.oldDocumentId.toLowerCase();
  const newId = input.newDocumentId.toLowerCase();
  if (oldId === newId) return err(serviceError('invalid', REPLACE_REFUSALS.sameDocument));

  const lifecycle = await lifecycleTablesPresent(access.tx);
  const now = new Date();

  /** Every check, read through `tx`; with `lock`, both rows are locked first, in id order. */
  const check = async (
    tx: Db,
    lock: boolean,
  ): Promise<Result<{ oldDocument: PairRow; newDocument: PairRow }, ServiceError>> => {
    const query = tx
      .select({
        id: schema.documents.id,
        docType: schema.documents.docType,
        originalName: schema.documents.originalName,
        approvedName: schema.documents.approvedName,
        expiresAt: schema.documents.expiresAt,
        walletVisible: schema.documents.walletVisible,
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
    const rows: PairRow[] = lock ? await query.for('update') : await query;
    const oldDocument = rows.find((row) => row.id === oldId);
    const newDocument = rows.find((row) => row.id === newId);
    if (!oldDocument) return err(serviceError('not_found', 'document not found'));
    if (!newDocument) return err(serviceError('not_found', 'replacement document not found'));
    if (oldDocument.supersededBy) {
      return err(serviceError('invalid', REPLACE_REFUSALS.alreadyReplaced));
    }
    // A loop: the newer document was itself replaced (by the old one or by anything else), so
    // linking the old one to it would point at an outdated document or close a circle.
    if (newDocument.supersededBy) {
      return err(serviceError('invalid', REPLACE_REFUSALS.newerReplaced));
    }
    if (!options.legacy) {
      const sameKind = oldDocument.docType === null || newDocument.docType === oldDocument.docType;
      if (!sameKind) return err(serviceError('invalid', REPLACE_REFUSALS.otherKind));
      // Only what the person keeps in their own documents (CAS-08), as the choice list shows.
      if (!oldDocument.walletVisible || !newDocument.walletVisible) {
        return err(serviceError('not_found', 'document not found'));
      }
    }
    if (lifecycle) {
      const states = await getDocumentLifecycles(tx, [oldId, newId], access, { now });
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
        return err(serviceError('invalid', REPLACE_REFUSALS.notCurrent));
      }
    }
    if (!options.legacy) {
      const status = (await replacementStatuses(tx, [newDocument], now)).get(newId);
      if (status !== 'READY') {
        const expired = newDocument.expiresAt && newDocument.expiresAt.getTime() <= now.getTime();
        const message =
          status === 'CHECKING'
            ? REPLACE_REFUSALS.checking
            : expired
              ? REPLACE_REFUSALS.expired
              : REPLACE_REFUSALS.cannotUse;
        return err(serviceError('invalid', message));
      }
    }
    return ok({ oldDocument, newDocument });
  };

  // A quick read first, so an ordinary refusal opens no transaction.
  const before = await check(access.tx, false);
  if (!before.ok) return before;

  const actorAccountId = access.applicant.ownerAccountId;
  return access.tx.transaction(async (tx) => {
    // Both rows locked, then every check again: two replacements at once (the same one twice,
    // or A by B and B by A) cannot both pass, and nothing decided before the lock is trusted.
    const locked = await check(tx, true);
    if (!locked.ok) return locked;
    // Conditional as well, so the old document is linked forward exactly once.
    const updated = await tx
      .update(schema.documents)
      .set({ supersededByDocumentId: newId })
      .where(and(eq(schema.documents.id, oldId), isNull(schema.documents.supersededByDocumentId)))
      .returning({ id: schema.documents.id });
    if (updated.length === 0) return err(serviceError('invalid', REPLACE_REFUSALS.alreadyReplaced));

    const cases = await openCasesSelecting(tx, oldId);
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
 * as Replaced; every open case that selected it is flagged and will need to be confirmed again.
 */
export async function replaceDocument(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly oldDocumentId: string; readonly newDocumentId: string },
): Promise<Result<ReplaceDocumentOutcome, ServiceError>> {
  return applyReplacement(access, input, { legacy: false });
}

/**
 * What the Replace flow shows for one document: the documents of the same kind that could be the
 * newer one (newest first, with whether each can be chosen) and the open cases that will be
 * updated. Owner only; refused when the document cannot be replaced.
 */
export async function listReplacementOptions(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly oldDocumentId: string },
): Promise<Result<ReplacementOptions, ServiceError>> {
  const applicantId = access.applicant.id;
  if (!lifecycleCommandCovers(access, applicantId)) {
    return err(serviceError('forbidden', REPLACE_REFUSALS.notOwner));
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
        eq(schema.documents.walletVisible, true),
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    );
  if (!oldDocument) return err(serviceError('not_found', 'document not found'));
  if (oldDocument.supersededBy) {
    return err(serviceError('invalid', REPLACE_REFUSALS.alreadyReplaced));
  }

  const rows = await db
    .select({
      id: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      expiresAt: schema.documents.expiresAt,
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
  const statuses = await replacementStatuses(db, rows, new Date());
  return ok({
    docType: oldDocument.docType,
    candidates: rows.map((row) => ({
      documentId: row.id,
      name: documentName(row),
      uploadedAt: row.createdAt,
      status: statuses.get(row.id) ?? 'CANNOT_USE',
    })),
    cases: await openCasesSelecting(db, oldId),
  });
}
