import { type Result, err, ok } from '@visastack/core';
import { and, eq, inArray } from 'drizzle-orm';
import { appendAuditEvent } from '../../audit';
import { type Db, first, schema } from '../../db';
import { enqueueErasureJob } from '../../erasure';
import { type ServiceError, serviceError } from '../../errors';
import { documentBlockedByLegalHold } from '../../legal-hold';
import { incrementMaterialRevision, missionsSelectingDocument } from '../../material-revision';
import { type LifecycleAccess, lifecycleAccessCovers, lifecycleActorAccountId } from './access';
import { isUuid } from './ids';
import { lifecycleTablesPresent } from './presence';

export interface EnqueueDocumentRemovalInput {
  readonly documentId: string;
  readonly applicantId: string;
  readonly receiptId: string;
}

export type EnqueueDocumentRemovalOutcome =
  /** Every stored file of the document is queued for verified erasure; the record reads Removing Securely. */
  | { readonly outcome: 'QUEUED'; readonly storageObjects: number }
  /** The document had no stored file: its record is gone now and the receipt reads Removed. */
  | { readonly outcome: 'REMOVED' }
  /** A legal hold covers the document: nothing is queued and the receipt reads Kept (Legal Requirement). */
  | { readonly outcome: 'BLOCKED' };

/**
 * Start the verified removal of one deleted document (a duplicate whose 30 days ended, or a file
 * support approved for removal), inside the caller's transaction.
 *
 * Takes the same locks, in the same order, as the retention purge and the erasure worker: the
 * applicant row first (so a legal hold being placed is seen), then the document row (so no new
 * version can slip in between this and the queue). Refuses unless the document is the
 * applicant's, sits in Recently Deleted or was approved for removal, and names this receipt.
 * A legal hold that covers it (the whole record, the document, or a case selecting it) queues
 * nothing and records the receipt as blocked. Otherwise one `DOCUMENT_REMOVAL` erasure job is
 * queued per distinct stored file (safe copies made from it go with it), and the receipt moves
 * to Removing. The worker deletes the document row only after every one of its files is verified
 * gone (erasure.ts).
 */
export async function enqueueDocumentRemoval(
  tx: Db,
  input: EnqueueDocumentRemovalInput,
  access: LifecycleAccess,
): Promise<Result<EnqueueDocumentRemovalOutcome, ServiceError>> {
  if (!isUuid(input.documentId) || !isUuid(input.applicantId) || !isUuid(input.receiptId)) {
    return err(serviceError('invalid', 'name the document, its record and its removal record'));
  }
  if (!lifecycleAccessCovers(access, input.applicantId)) {
    return err(serviceError('forbidden', 'this document cannot be removed'));
  }
  if (!(await lifecycleTablesPresent(tx))) {
    return err(serviceError('not_found', 'document not found'));
  }

  await tx
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, input.applicantId))
    .for('update');
  const document = first(
    await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, input.documentId),
          eq(schema.documents.applicantId, input.applicantId),
        ),
      )
      .for('update'),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));

  const lifecycle = first(
    await tx
      .select({
        deletedAt: schema.documentLifecycle.deletedAt,
        receiptId: schema.documentLifecycle.receiptId,
      })
      .from(schema.documentLifecycle)
      .where(eq(schema.documentLifecycle.documentId, input.documentId)),
  );
  if (!lifecycle?.deletedAt || lifecycle.receiptId !== input.receiptId) {
    return err(serviceError('invalid', 'this document is not waiting to be removed'));
  }
  const receipt = first(
    await tx
      .select({ status: schema.deletionReceipts.status })
      .from(schema.deletionReceipts)
      .where(
        and(
          eq(schema.deletionReceipts.id, input.receiptId),
          eq(schema.deletionReceipts.applicantId, input.applicantId),
        ),
      )
      .for('update'),
  );
  if (!receipt || !['SCHEDULED', 'REMOVING', 'BLOCKED'].includes(receipt.status)) {
    return err(serviceError('stale', 'this removal has already finished'));
  }

  const actorAccountId = lifecycleActorAccountId(access);
  const audit = (eventType: string, metadata: Record<string, unknown>) =>
    appendAuditEvent(tx, {
      eventType,
      actorAccountId,
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'document',
      resourceId: input.documentId,
      metadata: { receiptId: input.receiptId, ...metadata },
    });

  if (
    await documentBlockedByLegalHold(tx, {
      applicantId: input.applicantId,
      documentId: input.documentId,
    })
  ) {
    if (receipt.status !== 'BLOCKED') {
      await tx
        .update(schema.deletionReceipts)
        .set({ status: 'BLOCKED' })
        .where(eq(schema.deletionReceipts.id, input.receiptId));
    }
    await audit('DOCUMENT_REMOVAL_BLOCKED', { cause: 'LEGAL_HOLD' });
    return ok({ outcome: 'BLOCKED' });
  }

  const versions = await tx
    .select({ storageObjectId: schema.documentVersions.storageObjectId })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, input.documentId));
  const storageObjectIds = [...new Set(versions.map((version) => version.storageObjectId))];

  if (storageObjectIds.length === 0) {
    // Nothing stored to verify: the record goes now, as the worker would after verification.
    for (const missionId of await missionsSelectingDocument(tx, input.documentId)) {
      await incrementMaterialRevision(tx, missionId);
    }
    await tx.delete(schema.documents).where(eq(schema.documents.id, input.documentId));
    await moveReceipt(tx, input.receiptId, receipt.status, 'REMOVED', new Date());
    await audit('DOCUMENT_REMOVAL_QUEUED', { storageObjects: 0 });
    return ok({ outcome: 'REMOVED' });
  }

  const objects = await tx
    .select()
    .from(schema.storageObjects)
    .where(inArray(schema.storageObjects.id, storageObjectIds));
  for (const object of objects) {
    await enqueueErasureJob(tx, {
      reason: 'DOCUMENT_REMOVAL',
      bucket: object.bucket,
      objectKey: object.objectKey,
      expectedHash: object.contentHash,
      storageObjectId: object.id,
      documentId: input.documentId,
      applicantId: input.applicantId,
    });
  }
  await moveReceipt(tx, input.receiptId, receipt.status, 'REMOVING', null);
  await audit('DOCUMENT_REMOVAL_QUEUED', { storageObjects: objects.length });
  return ok({ outcome: 'QUEUED', storageObjects: objects.length });
}

async function moveReceipt(
  tx: Db,
  receiptId: string,
  from: string,
  to: 'REMOVING' | 'REMOVED',
  verifiedGoneAt: Date | null,
): Promise<void> {
  // REMOVED is reached through REMOVING, the only way the receipt guard allows.
  if (from !== 'REMOVING') {
    await tx
      .update(schema.deletionReceipts)
      .set({ status: 'REMOVING' })
      .where(eq(schema.deletionReceipts.id, receiptId));
  }
  if (to === 'REMOVED') {
    await tx
      .update(schema.deletionReceipts)
      .set({ status: 'REMOVED', ...(verifiedGoneAt ? { verifiedGoneAt } : {}) })
      .where(eq(schema.deletionReceipts.id, receiptId));
  }
}
