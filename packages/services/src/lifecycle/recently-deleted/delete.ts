import { type Result, err, ok } from '@visastack/core';
import { and, asc, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { AuthorizedApplicant } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
// Imported by the foundation's path, which the read-path guard recognises.
import { presentDocumentCondition } from '../../lifecycle/foundation/conditions';
import { incrementMaterialRevision } from '../../material-revision';
import { recordProductEvent } from '../../product-events';
import { assignReferenceCodes, referenceCodesFor } from '../../reference-codes';
import { FINISHED_CASE_STATES, duplicateStatus } from '../duplicates/status';
import { lifecycleCommandCovers } from '../foundation/access';
import type { DuplicateBlockReason } from '../foundation/actions';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { openDeletionReceipt } from '../foundation/receipts';

/*
 * Delete Duplicate (LC-C, owner decisions D2 to D5, D8). The person removes an exact copy; it
 * waits in Recently Deleted for 30 days (restorable), then is destroyed through the verified
 * erasure engine (purge.ts). Every open case that used it, and every AI app choice of it, moves
 * to the identical copy that stays, in the same transaction; each switched case gets one
 * material revision bump (its confirmation no longer stands). Restoring later never switches back.
 */

/** How long a deleted duplicate stays restorable (D3). */
export const RECENTLY_DELETED_DAYS = 30;
const DAY_MS = 86_400_000;
/** The receipt's own rule for a document kind (receipts.ts). */
const CATALOGUE_KEY = /^[a-z][a-z0-9_.-]{0,79}$/;

/** Why a deletion is refused. The web layer maps these exact messages to its own words. */
export const DELETE_DUPLICATE_REFUSALS = {
  notOwner: 'only the record owner can delete a duplicate',
  notDuplicate: 'this document is not an exact duplicate of another usable document',
  alreadyDeleted: 'this document is already deleted',
  blocked: {
    FINISHED_CASE: 'a finished case used this document',
    AGENCY_REQUEST_ANSWER: 'this document answered an agency request',
    CONTRIBUTOR_HANDOVER: 'a contributor handed this document over',
    SHARED_BY_NAME: 'a share names this document',
    LEGAL_HOLD: 'a legal hold covers this document',
  } satisfies Record<DuplicateBlockReason, string>,
} as const;

/** One open case that uses the duplicate and will switch to the copy that stays. */
export interface SwitchedCase {
  readonly missionId: string;
  readonly title: string;
}

export interface DeleteDuplicatePreview {
  readonly survivorDocumentId: string;
  /** The copy that stays, as the person's own list names it (for their screen only, never stored). */
  readonly survivorName: string;
  readonly cases: readonly SwitchedCase[];
  /** When it would be removed for good if not restored. */
  readonly purgeAfter: Date;
}

export interface DeleteDuplicateOutcome extends Omit<DeleteDuplicatePreview, 'survivorName'> {
  readonly receiptId: string;
}

function refusalFor(
  status: Awaited<ReturnType<typeof duplicateStatus>>,
): ServiceError | { readonly survivorDocumentId: string } {
  if (!status) return serviceError('not_found', 'document not found');
  if (!status.isDuplicate || !status.survivorDocumentId) {
    return serviceError('invalid', DELETE_DUPLICATE_REFUSALS.notDuplicate);
  }
  if (status.blockReason) {
    return serviceError('invalid', DELETE_DUPLICATE_REFUSALS.blocked[status.blockReason]);
  }
  return { survivorDocumentId: status.survivorDocumentId };
}

/** The open cases selecting `documentId`, oldest first. Finished cases block deletion (D5). */
async function openCasesSelecting(db: Db, documentId: string): Promise<SwitchedCase[]> {
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
        notInArray(schema.missions.state, [...FINISHED_CASE_STATES]),
      ),
    )
    .orderBy(asc(schema.missions.createdAt), asc(schema.missions.id));
  return rows.map((row) => ({ missionId: row.missionId, title: row.title }));
}

/**
 * What deleting a duplicate will do, for the confirmation: the copy that stays, the open cases
 * that will switch to it and the date it would be removed for good. Owner only; refused exactly
 * when `deleteDuplicate` would be.
 */
export async function previewDeleteDuplicate(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly documentId: string },
  options: { readonly now?: Date } = {},
): Promise<Result<DeleteDuplicatePreview, ServiceError>> {
  const applicantId = access.applicant.id;
  if (!lifecycleCommandCovers(access, applicantId)) {
    return err(serviceError('forbidden', DELETE_DUPLICATE_REFUSALS.notOwner));
  }
  if (!isUuid(input.documentId) || !(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('not_found', 'document not found'));
  }
  const documentId = input.documentId.toLowerCase();
  const now = options.now ?? new Date();
  const decided = refusalFor(await duplicateStatus(access.tx, documentId, access, { now }));
  if ('code' in decided) return err(decided);
  const survivor = first(
    await access.tx
      .select({
        approvedName: schema.documents.approvedName,
        originalName: schema.documents.originalName,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, decided.survivorDocumentId),
          eq(schema.documents.applicantId, applicantId),
          presentDocumentCondition(),
        ),
      ),
  );
  if (!survivor) return err(serviceError('invalid', DELETE_DUPLICATE_REFUSALS.notDuplicate));
  return ok({
    survivorDocumentId: decided.survivorDocumentId,
    survivorName: survivor.approvedName ?? survivor.originalName,
    cases: await openCasesSelecting(access.tx, documentId),
    purgeAfter: new Date(now.getTime() + RECENTLY_DELETED_DAYS * DAY_MS),
  });
}

/**
 * Delete Duplicate. `access` is the record owner's MANAGE proof for the document's traveller.
 * One transaction: the traveller and the document are locked (so two deletions of identical
 * copies cannot both pass), the duplicate rule is checked again, open cases and AI app choices
 * move to the copy that stays, the document enters Recently Deleted for 30 days and a Removal
 * Record is written. `atUpload` marks "Remove This New Copy" right after an upload.
 */
export async function deleteDuplicate(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly documentId: string; readonly atUpload?: boolean },
  options: { readonly now?: Date } = {},
): Promise<Result<DeleteDuplicateOutcome, ServiceError>> {
  const applicantId = access.applicant.id;
  if (!lifecycleCommandCovers(access, applicantId)) {
    return err(serviceError('forbidden', DELETE_DUPLICATE_REFUSALS.notOwner));
  }
  if (!isUuid(input.documentId) || !(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('not_found', 'document not found'));
  }
  const documentId = input.documentId.toLowerCase();
  const now = options.now ?? new Date();
  const ownerAccountId = access.applicant.ownerAccountId;

  return access.tx.transaction(async (tx) => {
    // The same lock order as the removal and the erasure worker: the traveller, then the document.
    await tx
      .select({ id: schema.applicants.id })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId))
      .for('update');
    const document = first(
      await tx
        .select({
          id: schema.documents.id,
          docType: schema.documents.docType,
          createdAt: schema.documents.createdAt,
          uploaderAccountId: schema.documents.uploaderAccountId,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.applicantId, applicantId),
            presentDocumentCondition(),
          ),
        )
        .for('update'),
    );
    if (!document) {
      const deleted = first(
        await tx
          .select({ deletedAt: schema.documentLifecycle.deletedAt })
          .from(schema.documentLifecycle)
          .where(
            and(
              eq(schema.documentLifecycle.documentId, documentId),
              eq(schema.documentLifecycle.applicantId, applicantId),
            ),
          ),
      );
      return deleted?.deletedAt
        ? err(serviceError('stale', DELETE_DUPLICATE_REFUSALS.alreadyDeleted))
        : err(serviceError('not_found', 'document not found'));
    }

    // Nothing decided before the locks is trusted: the copy that stays may have just gone.
    const decided = refusalFor(await duplicateStatus(tx, documentId, access, { now }));
    if ('code' in decided) return err(decided);
    const survivorId = decided.survivorDocumentId;

    // Open cases move to the copy that stays (D4). A case that already selected the survivor for
    // the same requirement keeps that one selection.
    const cases = await openCasesSelecting(tx, documentId);
    const missionIds = cases.map((c) => c.missionId);
    let acknowledgementsReset = 0;
    if (missionIds.length > 0) {
      const selections = await tx
        .select({
          id: schema.selectedEvidence.id,
          missionId: schema.selectedEvidence.missionId,
          packRequirementId: schema.selectedEvidence.packRequirementId,
        })
        .from(schema.selectedEvidence)
        .where(
          and(
            eq(schema.selectedEvidence.documentId, documentId),
            inArray(schema.selectedEvidence.missionId, missionIds),
          ),
        );
      const survivorSelections = await tx
        .select({
          missionId: schema.selectedEvidence.missionId,
          packRequirementId: schema.selectedEvidence.packRequirementId,
        })
        .from(schema.selectedEvidence)
        .where(
          and(
            eq(schema.selectedEvidence.documentId, survivorId),
            inArray(schema.selectedEvidence.missionId, missionIds),
          ),
        );
      const taken = new Set(survivorSelections.map((s) => `${s.missionId}|${s.packRequirementId}`));
      for (const selection of selections) {
        if (taken.has(`${selection.missionId}|${selection.packRequirementId}`)) {
          await tx
            .delete(schema.selectedEvidence)
            .where(eq(schema.selectedEvidence.id, selection.id));
        } else {
          await tx
            .update(schema.selectedEvidence)
            .set({ documentId: survivorId })
            .where(eq(schema.selectedEvidence.id, selection.id));
        }
      }
      const [live] = await tx
        .select({ value: count() })
        .from(schema.acknowledgements)
        .where(
          and(
            inArray(schema.acknowledgements.missionId, missionIds),
            eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
            isNull(schema.acknowledgements.invalidatedAt),
          ),
        );
      acknowledgementsReset = Number(live?.value ?? 0);
      for (const missionId of missionIds) await incrementMaterialRevision(tx, missionId);
    }

    // AI app choices move too (D4); a connection that already holds the survivor keeps that one.
    const choices = await tx
      .select({ connectionId: schema.aiConnectionDocuments.connectionId })
      .from(schema.aiConnectionDocuments)
      .where(eq(schema.aiConnectionDocuments.documentId, documentId));
    let aiChoicesMoved = 0;
    let aiChoicesRemoved = 0;
    for (const { connectionId } of choices) {
      const holdsSurvivor = first(
        await tx
          .select({ connectionId: schema.aiConnectionDocuments.connectionId })
          .from(schema.aiConnectionDocuments)
          .where(
            and(
              eq(schema.aiConnectionDocuments.connectionId, connectionId),
              eq(schema.aiConnectionDocuments.documentId, survivorId),
            ),
          ),
      );
      const choice = and(
        eq(schema.aiConnectionDocuments.connectionId, connectionId),
        eq(schema.aiConnectionDocuments.documentId, documentId),
      );
      if (holdsSurvivor) {
        await tx.delete(schema.aiConnectionDocuments).where(choice);
        aiChoicesRemoved += 1;
      } else {
        await tx.update(schema.aiConnectionDocuments).set({ documentId: survivorId }).where(choice);
        aiChoicesMoved += 1;
      }
    }

    // Category shares that captured this document lose it when it goes; never widened to the copy.
    const [shares] = await tx
      .select({ value: count() })
      .from(schema.grants)
      .where(
        and(
          eq(schema.grants.applicantId, applicantId),
          sql`${documentId}::uuid = any(${schema.grants.documentScopeSnapshot})`,
          inArray(schema.grants.status, ['ACTIVE', 'PAUSED', 'PENDING_ACCEPTANCE']),
        ),
      );
    const sharesAffected = Number(shares?.value ?? 0);

    // Reference codes only, never a name or title (D8).
    await assignReferenceCodes(tx, 'D', [documentId]);
    await assignReferenceCodes(tx, 'C', missionIds);
    const documentCode = (await referenceCodesFor(tx, 'D', [documentId])).get(documentId);
    if (!documentCode) throw new Error('delete duplicate: no reference code for the document');
    const caseCodes = await referenceCodesFor(tx, 'C', missionIds);

    const purgeAfter = new Date(now.getTime() + RECENTLY_DELETED_DAYS * DAY_MS);
    const receipt = await openDeletionReceipt(
      tx,
      {
        applicantId,
        subjectKind: 'DOCUMENT',
        subjectCode: documentCode,
        // A catalogue key only; anything else (an older free label) is left out, never a title.
        documentKind: CATALOGUE_KEY.test(document.docType ?? '') ? document.docType : null,
        uploadedAt: document.createdAt,
        uploadedByRole:
          document.uploaderAccountId === null
            ? 'SYSTEM'
            : document.uploaderAccountId === ownerAccountId
              ? 'OWNER'
              : 'AGENCY_MEMBER',
        path: 'DUPLICATE',
        requestedByAccountId: ownerAccountId,
        requestedAt: now,
        scheduledFor: purgeAfter,
        status: 'SCHEDULED',
        effects: {
          ...(missionIds.length > 0
            ? { casesSwitched: missionIds.flatMap((id) => caseCodes.get(id) ?? []) }
            : {}),
          ...(acknowledgementsReset > 0 ? { acknowledgementsReset } : {}),
          ...(sharesAffected > 0 ? { sharesAffected } : {}),
          ...(aiChoicesMoved > 0 ? { aiChoicesMoved } : {}),
          ...(aiChoicesRemoved > 0 ? { aiChoicesRemoved } : {}),
        },
      },
      access,
    );
    if (!receipt.ok) throw new Error(`delete duplicate: receipt refused (${receipt.error.code})`);

    const lifecycle = {
      deletedAt: now,
      deletedByAccountId: ownerAccountId,
      deletePath: 'DUPLICATE' as const,
      purgeAfter,
      receiptId: receipt.value.id,
      updatedAt: now,
    };
    await tx
      .insert(schema.documentLifecycle)
      .values({ documentId, applicantId, ...lifecycle })
      .onConflictDoUpdate({ target: schema.documentLifecycle.documentId, set: lifecycle });

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_DELETED',
      actorAccountId: ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: documentId,
      metadata: {
        receiptId: receipt.value.id,
        path: 'DUPLICATE',
        survivorDocumentId: survivorId,
        casesSwitched: missionIds.length,
        aiChoicesMoved,
        aiChoicesRemoved,
        atUpload: input.atUpload === true,
      },
    });
    await recordProductEvent(tx, {
      eventType: input.atUpload ? 'DUPLICATE_REMOVED_AT_UPLOAD' : 'DOCUMENT_DELETED',
      accountId: ownerAccountId,
    });

    return ok({ receiptId: receipt.value.id, survivorDocumentId: survivorId, cases, purgeAfter });
  });
}
