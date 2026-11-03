/**
 * UMPE P5: whether the group trip tables exist yet. The code ships before its migration runs in
 * production, so until then every reader answers "no trips" and every writer refuses plainly,
 * and cases behave exactly as before. `to_regclass` never raises, so a surrounding transaction is
 * never aborted. Only "present" is remembered per database handle (a table is never dropped);
 * "missing" is asked again next time.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db';

const TRIP_TABLES = [
  'umpe_trips',
  'umpe_trip_travellers',
  'umpe_trip_evidence',
  'umpe_trip_evidence_allowances',
] as const;

const present = new WeakSet<object>();

/** The four P5 tables (migration "umpe group trips"). */
export async function tripTablesPresent(db: Db): Promise<boolean> {
  if (present.has(db)) return true;
  const checks = TRIP_TABLES.map((t) => sql`to_regclass(${t}::text) is not null`);
  const rows = await db
    .select({ present: sql<boolean>`(${sql.join(checks, sql` and `)})` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) present.add(db);
  return found;
}
