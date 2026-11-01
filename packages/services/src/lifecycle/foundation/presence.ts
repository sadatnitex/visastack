import { sql } from 'drizzle-orm';
import type { Db } from '../../db';

/**
 * The four tables of migration 0113 (resource lifecycle). Literal names, not `schema.X` read at
 * module load (tests that mock the database would crash), pinned by presence.test.ts.
 */
export const LIFECYCLE_RELATIONS = [
  'document_lifecycle',
  'applicant_lifecycle',
  'document_removal_requests',
  'deletion_receipts',
] as const;

const PRESENT = new WeakSet<object>();

/**
 * Whether migration 0113 has created all four lifecycle tables on this database. Until the owner
 * approves that migration, production has none of them: every lifecycle read and command then
 * behaves exactly as before and every lifecycle action stays hidden. Asked with `to_regclass`,
 * which never raises, so a caller's transaction is never aborted by a missing table. Only
 * "present" is remembered per database handle (the tables are never dropped once created);
 * "missing" is asked again every time, so the first request after the migration sees it.
 */
export async function lifecycleTablesPresent(db: Db): Promise<boolean> {
  if (PRESENT.has(db)) return true;
  const [documentTable, applicantTable, requestTable, receiptTable] = LIFECYCLE_RELATIONS;
  const rows = await db
    .select({
      present: sql<boolean>`(to_regclass(${documentTable}::text) is not null
        and to_regclass(${applicantTable}::text) is not null
        and to_regclass(${requestTable}::text) is not null
        and to_regclass(${receiptTable}::text) is not null)`,
    })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) PRESENT.add(db);
  return present;
}
