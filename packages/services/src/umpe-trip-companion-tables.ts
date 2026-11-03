/**
 * UMPE UX6: whether the trip companions table exists yet. The code ships before its migration runs
 * in production, so until then every reader answers "nothing" and every writer refuses plainly, and
 * trips behave exactly as before. `to_regclass` never raises, so a surrounding transaction is never
 * aborted. Only "present" is remembered per database handle (a table is never dropped); "missing"
 * is asked again next time.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db';

const present = new WeakSet<object>();

/** The companions table (migration "umpe trip companions"). */
export async function tripCompanionsTablePresent(db: Db): Promise<boolean> {
  if (present.has(db)) return true;
  const rows = await db
    .select({ present: sql<boolean>`to_regclass('umpe_trip_companions') is not null` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) present.add(db);
  return found;
}
