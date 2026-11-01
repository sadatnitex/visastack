import { and, eq } from 'drizzle-orm';
import { type Db, schema } from '../../db';
// Imported by the foundation's path, which the read-path guard recognises.
import { everydayDocumentCondition } from '../../lifecycle/foundation/conditions';
import { type LifecycleAccess, lifecycleAccessCovers } from '../foundation/access';
import { lifecycleTablesPresent } from '../foundation/presence';
import { duplicateStatuses } from './status';

/*
 * Tidy Up (LC-C, lanes/C.md step 7): how much one traveller's documents could be tidied. Counts
 * only, for a calm card on Home that appears when there is something to do. The everyday list is
 * what is counted: anything archived or deleted is already tidied.
 */

export interface TidyUpCounts {
  /** Exact copies that may be deleted (D2, D5). */
  readonly duplicates: number;
  /** Documents whose expiry date has passed. */
  readonly expired: number;
  /** Documents a newer one replaced. */
  readonly replaced: number;
}

/** At most this many everyday documents are looked at per traveller. */
const TIDY_READ_LIMIT = 500;

/**
 * What could be tidied in `applicantId`'s documents, or null before migration 0113 (archiving
 * and deleting do not exist yet, so there is nothing to offer) and for an access that does not
 * cover the record.
 */
export async function tidyUpCounts(
  db: Db,
  applicantId: string,
  access: LifecycleAccess,
  options: { readonly now?: Date } = {},
): Promise<TidyUpCounts | null> {
  if (!lifecycleAccessCovers(access, applicantId)) return null;
  if (!(await lifecycleTablesPresent(db))) return null;
  const now = options.now ?? new Date();
  const documents = schema.documents;
  const rows = await db
    .select({
      id: documents.id,
      expiresAt: documents.expiresAt,
      supersededBy: documents.supersededByDocumentId,
    })
    .from(documents)
    .where(
      and(
        eq(documents.applicantId, applicantId),
        eq(documents.walletVisible, true),
        everydayDocumentCondition(),
      ),
    )
    .limit(TIDY_READ_LIMIT);
  const expired = rows.filter((row) => row.expiresAt && row.expiresAt.getTime() <= now.getTime());
  const replaced = rows.filter((row) => row.supersededBy !== null);
  const statuses = await duplicateStatuses(
    db,
    rows.map((row) => row.id),
    access,
    { now },
  );
  // Two identical copies are each other's duplicate, but only one of them can go: count a copy
  // only when the one that would stay for it is not itself being counted.
  let duplicates = 0;
  const staying = new Set<string>();
  for (const [documentId, status] of statuses) {
    if (!status.isDuplicate || status.blockReason !== null || !status.survivorDocumentId) continue;
    if (staying.has(documentId)) continue;
    duplicates += 1;
    staying.add(status.survivorDocumentId);
  }
  return { duplicates, expired: expired.length, replaced: replaced.length };
}
