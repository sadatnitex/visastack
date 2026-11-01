import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { AuthorizedApplicant } from '../../access/require-access';
import { isAiDispatchAllowed } from '../../ai-provider-config';
import { READER_VERSION, aiReadingIdempotencyKey } from '../../ai-reading-job';
import { appendAuditEvent } from '../../audit';
import { hasConsent } from '../../consent';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
import { recordProductEvent } from '../../product-events';
import { lifecycleCommandCovers } from '../foundation/access';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { advanceDeletionReceipt } from '../foundation/receipts';

/*
 * Undo and Restore from Recently Deleted (LC-C, owner decisions D3 and D4). The document comes
 * back exactly as it was before it was deleted, archived or not; the cases and AI app choices that
 * moved to the identical copy stay with that copy (no switch back). Its Removal Record reads
 * Restored. Only a duplicate still inside its 30 days can come back: once removal has started it
 * cannot be stopped from here.
 *
 * Reads go through `document_lifecycle` and the document's versions, never a list of documents:
 * a deleted document is, by design, absent from every document read.
 */

export const RESTORE_REFUSALS = {
  notOwner: 'only the record owner can restore a document',
  notDeleted: 'this document is not in Recently Deleted',
  tooLate: 'this document is already being removed',
} as const;

export type RestoreSource = 'UNDO' | 'RECENTLY_DELETED';

/**
 * Bring a deleted duplicate back. `source` says whether this was the Undo right after deleting
 * or a later Restore from the Recently Deleted list (recorded on the audit trail only).
 */
export async function restoreDeleted(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly documentId: string; readonly source?: RestoreSource },
  options: { readonly now?: Date } = {},
): Promise<Result<{ readonly documentId: string }, ServiceError>> {
  const applicantId = access.applicant.id;
  if (!lifecycleCommandCovers(access, applicantId)) {
    return err(serviceError('forbidden', RESTORE_REFUSALS.notOwner));
  }
  if (!isUuid(input.documentId) || !(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('not_found', 'document not found'));
  }
  const documentId = input.documentId.toLowerCase();
  const now = options.now ?? new Date();
  const source = input.source ?? 'RECENTLY_DELETED';
  const ownerAccountId = access.applicant.ownerAccountId;

  return access.tx.transaction(async (tx) => {
    // The traveller first (the same order as deletion and the purge), then the lifecycle row.
    await tx
      .select({ id: schema.applicants.id })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId))
      .for('update');
    const row = first(
      await tx
        .select({
          deletedAt: schema.documentLifecycle.deletedAt,
          deletePath: schema.documentLifecycle.deletePath,
          purgeAfter: schema.documentLifecycle.purgeAfter,
          receiptId: schema.documentLifecycle.receiptId,
        })
        .from(schema.documentLifecycle)
        .where(
          and(
            eq(schema.documentLifecycle.documentId, documentId),
            eq(schema.documentLifecycle.applicantId, applicantId),
          ),
        )
        .for('update'),
    );
    if (!row?.deletedAt || row.deletePath !== 'DUPLICATE' || !row.receiptId) {
      return err(serviceError('invalid', RESTORE_REFUSALS.notDeleted));
    }
    if (!row.purgeAfter || row.purgeAfter.getTime() <= now.getTime()) {
      return err(serviceError('stale', RESTORE_REFUSALS.tooLate));
    }
    const receipt = first(
      await tx
        .select({ status: schema.deletionReceipts.status })
        .from(schema.deletionReceipts)
        .where(eq(schema.deletionReceipts.id, row.receiptId))
        .for('update'),
    );
    if (receipt?.status !== 'SCHEDULED') {
      return err(serviceError('stale', RESTORE_REFUSALS.tooLate));
    }

    await tx
      .update(schema.documentLifecycle)
      .set({
        deletedAt: null,
        deletedByAccountId: null,
        deletePath: null,
        purgeAfter: null,
        updatedAt: now,
      })
      .where(eq(schema.documentLifecycle.documentId, documentId));
    const moved = await advanceDeletionReceipt(tx, row.receiptId, 'RESTORED', {}, access);
    if (!moved.ok) throw new Error(`restore: receipt refused (${moved.error.code})`);

    const readingQueued = await queueReadingSkippedWhileDeleted(
      tx,
      documentId,
      ownerAccountId,
      row.deletedAt,
    );

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_DELETE_UNDONE',
      actorAccountId: ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: documentId,
      metadata: { receiptId: row.receiptId, source, readingQueued },
    });
    await recordProductEvent(tx, {
      eventType: 'DOCUMENT_DELETE_UNDONE',
      accountId: ownerAccountId,
    });
    return ok({ documentId });
  });
}

/** Undo right after Delete Duplicate: `restoreDeleted` with source UNDO. */
export async function undoDelete(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly documentId: string },
  options: { readonly now?: Date } = {},
): Promise<Result<{ readonly documentId: string }, ServiceError>> {
  return restoreDeleted(access, { documentId: input.documentId, source: 'UNDO' }, options);
}

/**
 * The automatic reading skips a deleted document quietly (ai-reading.ts, intake.ts). When it
 * comes back, the reading it missed is queued again: a reading job finished while it was deleted
 * is put back in the queue, and one never queued because intake ran while it was deleted is added
 * (with the same consent and AI switch checks as intake). The job checks everything again when it
 * runs. Returns whether anything was queued.
 */
async function queueReadingSkippedWhileDeleted(
  tx: Db,
  documentId: string,
  ownerAccountId: string,
  deletedAt: Date,
): Promise<boolean> {
  const version = first(
    await tx
      .select({
        id: schema.documentVersions.id,
        safetyStatus: schema.documentVersions.safetyStatus,
      })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  if (!version || version.safetyStatus !== 'CLEAN') return false;
  const jobs = schema.processingJobs;
  const key = aiReadingIdempotencyKey(version.id);
  const reading = first(
    await tx
      .select({ id: jobs.id, status: jobs.status, completedAt: jobs.completedAt })
      .from(jobs)
      .where(eq(jobs.idempotencyKey, key)),
  );
  if (reading) {
    if (reading.status !== 'DONE' || !reading.completedAt) return false;
    if (reading.completedAt.getTime() < deletedAt.getTime()) return false;
    await tx
      .update(jobs)
      .set({
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        claimedAt: null,
        completedAt: null,
        lastError: null,
        errorCode: null,
      })
      .where(eq(jobs.id, reading.id));
    return true;
  }
  // No reading job: queue one only if intake finished while the document was deleted (it would
  // otherwise have queued it), never for a file whose owner had reading switched off.
  const intakeWhileDeleted = first(
    await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.documentVersionId, version.id),
          eq(jobs.status, 'DONE'),
          gte(jobs.completedAt, deletedAt),
        ),
      )
      .limit(1),
  );
  if (!intakeWhileDeleted) return false;
  const mayReadScans = await hasConsent(tx, ownerAccountId, 'AI_OCR');
  const mayReadDetails = await hasConsent(tx, ownerAccountId, 'AI_EXTRACTION');
  if (!mayReadScans && !mayReadDetails) return false;
  if (!(await isAiDispatchAllowed(tx))) return false;
  const inserted = await tx
    .insert(jobs)
    .values({
      documentVersionId: version.id,
      jobType: 'INTAKE',
      processingVersion: READER_VERSION,
      idempotencyKey: key,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return inserted.length > 0;
}
