/**
 * UMPE P4: whether the trip package tables exist yet. The code ships before its migration runs in
 * production, so until then every reader answers "nothing chosen, nothing confirmed" and every
 * writer refuses plainly, and cases behave exactly as before. `to_regclass` never raises, so a
 * surrounding transaction is never aborted. Only "present" is remembered per database handle (a
 * table is never dropped); "missing" is asked again next time.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db';

/** Case states whose package is no longer worked on: nothing is re-evaluated, changed or sent. */
export const INACTIVE_CASE_STATES = ['CLOSED', 'CANCELLED', 'SUBMITTED'] as const;

const PACKAGE_TABLES = ['umpe_package_choices', 'umpe_package_handoffs', 'umpe_package_changes'];
const SOURCE_TABLES = ['official_sources', 'source_change_candidates'];

const packagePresent = new WeakSet<object>();
const sourcesPresent = new WeakSet<object>();

async function allPresent(
  db: Db,
  tables: readonly string[],
  seen: WeakSet<object>,
): Promise<boolean> {
  if (seen.has(db)) return true;
  const checks = tables.map((t) => sql`to_regclass(${t}::text) is not null`);
  const rows = await db
    .select({ present: sql<boolean>`(${sql.join(checks, sql` and `)})` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) seen.add(db);
  return found;
}

/** The three P4 tables (migration "umpe trip package"). */
export function packageTablesPresent(db: Db): Promise<boolean> {
  return allPresent(db, PACKAGE_TABLES, packagePresent);
}

/** The source monitoring tables (UMPE P10, migration 0115), read for the freshness check. */
export function sourceTablesPresent(db: Db): Promise<boolean> {
  return allPresent(db, SOURCE_TABLES, sourcesPresent);
}
