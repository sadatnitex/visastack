import { sql } from 'drizzle-orm';
import type { Db } from './db';

/**
 * Whether migration 0102 has created `redaction_masks` on this database (ADR 0022, S23). Until
 * the owner approves that migration, production has no such table: every safe copy then reads
 * "Not Prepared Yet" and nothing is served. Presence is asked with `to_regclass`, which never
 * raises, so a caller's transaction is never aborted by a missing table. Only "present" is
 * remembered per database handle (the table is never dropped once created); "missing" is asked
 * again every time.
 */
const RELATION = 'redaction_masks';
const PRESENT = new WeakSet<object>();

export async function redactionMasksTablePresent(db: Db): Promise<boolean> {
  if (PRESENT.has(db)) return true;
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${RELATION}::text) is not null` })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) PRESENT.add(db);
  return present;
}
