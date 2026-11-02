/**
 * UMPE P3: whether the document-understanding tables exist yet. The code ships before its
 * migration runs in production, so until then every reader answers "nothing" and every writer does
 * nothing, and uploads behave exactly as before. `to_regclass` never raises, so a surrounding
 * transaction is never aborted. Only "present" is remembered per database handle (a table is never
 * dropped); "missing" is asked again next time.
 */

import { sql } from 'drizzle-orm';
import type { Db } from './db';

const RECEIPTS = 'document_upload_receipts';
const RELATIONS = 'document_relation_proposals';

const receiptsPresent = new WeakSet<object>();
const relationsPresent = new WeakSet<object>();

async function present(db: Db, relation: string, seen: WeakSet<object>): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${relation}::text) is not null` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) seen.add(db);
  return found;
}

export function uploadReceiptsTablePresent(db: Db): Promise<boolean> {
  return present(db, RECEIPTS, receiptsPresent);
}

export function relationProposalsTablePresent(db: Db): Promise<boolean> {
  return present(db, RELATIONS, relationsPresent);
}
