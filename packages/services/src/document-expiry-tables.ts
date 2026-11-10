/**
 * Whether the document expiry entries table exists yet. The code ships before its migration runs
 * in production, so until then every reader answers "no typed dates" and the writer refuses
 * plainly, and every page reads exactly as before. `to_regclass` never raises, so a surrounding
 * transaction is never aborted. Only "present" is remembered per database handle (a table is
 * never dropped); "missing" is asked again next time.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db';

const present = new WeakSet<object>();

/** The table of typed and read document expiry dates (migration "document expiry entries"). */
export async function documentExpiryEntriesTablePresent(db: Db): Promise<boolean> {
  if (present.has(db)) return true;
  const rows = await db
    .select({ present: sql<boolean>`to_regclass('document_expiry_entries') is not null` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) present.add(db);
  return found;
}
