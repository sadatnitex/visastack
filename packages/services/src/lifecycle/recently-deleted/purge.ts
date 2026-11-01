import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { SystemScope } from '../../access/principal';
import { type Db, schema } from '../../db';
import { lifecycleTablesPresent } from '../foundation/presence';
import { enqueueDocumentRemoval } from '../foundation/removal';

/*
 * The end of Recently Deleted (LC-C, owner decision D3). Each deleted duplicate whose 30 days are
 * over starts its verified removal through the foundation's `enqueueDocumentRemoval`, which
 * re-checks legal holds under the traveller and document locks: a hold placed during the 30 days
 * keeps the document (its Removal Record reads Kept (Legal Requirement)) and nothing is queued. A
 * kept document is tried again on a later run, so it goes once the hold is released. The erasure
 * worker then destroys every file, verifies it is gone and only then deletes the document row,
 * so the storage figure drops only after verification.
 */

/** At most this many documents start removal per run; the rest wait for the next run. */
export const PURGE_BATCH_LIMIT = 100;

export interface PurgeDueDocumentsResult {
  readonly queued: number;
  readonly removed: number;
  readonly blocked: number;
  readonly failed: number;
}

const NOTHING: PurgeDueDocumentsResult = Object.freeze({
  queued: 0,
  removed: 0,
  blocked: 0,
  failed: 0,
});

/**
 * Start the removal of every deleted duplicate whose time in Recently Deleted is over. Runs as the
 * `process-erasure` job only. Each document gets its own transaction, so one failure never holds
 * back the others. With the lifecycle tables missing there is nothing to do.
 */
export async function purgeDueDocuments(
  db: Db,
  scope: SystemScope<'process-erasure'>,
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<PurgeDueDocumentsResult> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-erasure') {
    throw new Error('the Recently Deleted purge needs the scope of the erasure job');
  }
  if (!(await lifecycleTablesPresent(db))) return NOTHING;
  const now = options.now ?? new Date();
  const lc = schema.documentLifecycle;
  const receipts = schema.deletionReceipts;
  const due = await db
    .select({ documentId: lc.documentId, applicantId: lc.applicantId, receiptId: lc.receiptId })
    .from(lc)
    .innerJoin(receipts, eq(receipts.id, lc.receiptId))
    .where(
      and(
        isNotNull(lc.deletedAt),
        eq(lc.deletePath, 'DUPLICATE'),
        lte(lc.purgeAfter, now),
        // Already removing: the erasure worker has it. Kept for a hold: tried again.
        inArray(receipts.status, ['SCHEDULED', 'BLOCKED']),
      ),
    )
    .orderBy(asc(lc.purgeAfter), asc(lc.documentId))
    .limit(options.limit ?? PURGE_BATCH_LIMIT);

  let queued = 0;
  let removed = 0;
  let blocked = 0;
  let failed = 0;
  for (const row of due) {
    if (!row.receiptId) continue;
    const receiptId = row.receiptId;
    try {
      const outcome = await db.transaction((tx) =>
        enqueueDocumentRemoval(
          tx,
          { documentId: row.documentId, applicantId: row.applicantId, receiptId },
          scope,
          { now },
        ),
      );
      if (!outcome.ok) failed += 1;
      else if (outcome.value.outcome === 'QUEUED') queued += 1;
      else if (outcome.value.outcome === 'REMOVED') removed += 1;
      else blocked += 1;
    } catch {
      failed += 1;
    }
  }
  return { queued, removed, blocked, failed };
}
