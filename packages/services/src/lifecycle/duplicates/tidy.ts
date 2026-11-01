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
  const statuses = await duplicateStatuses(
    db,
    rows.map((row) => row.id),
    access,
    { now },
  );
  // Identical copies are each other's duplicates, but one of each group must stay. Each group is
  // the deletable copies linked to the copies that would stay for them; it can lose all but one.
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    let at = id;
    while (parent.get(at) !== undefined && parent.get(at) !== at) at = parent.get(at) as string;
    parent.set(id, at);
    return at;
  };
  const join = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const deletable: string[] = [];
  for (const [documentId, status] of statuses) {
    if (!status.isDuplicate || status.blockReason !== null || !status.survivorDocumentId) continue;
    deletable.push(documentId);
    join(documentId, status.survivorDocumentId);
  }
  const groups = new Map<string, { size: number; members: string[] }>();
  for (const id of parent.keys()) {
    const group = groups.get(root(id)) ?? { size: 0, members: [] };
    group.size += 1;
    groups.set(root(id), group);
  }
  for (const id of deletable) groups.get(root(id))?.members.push(id);
  let duplicates = 0;
  const counted = new Set<string>();
  for (const group of groups.values()) {
    const going = group.members.slice(0, Math.max(0, group.size - 1));
    duplicates += going.length;
    for (const id of going) counted.add(id);
  }
  // Each document counts once: a copy that can go, else replaced, else expired.
  let replaced = 0;
  let expired = 0;
  for (const row of rows) {
    if (counted.has(row.id)) continue;
    if (row.supersededBy !== null) replaced += 1;
    else if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) expired += 1;
  }
  return { duplicates, expired, replaced };
}
