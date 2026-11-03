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

const papersPresent = new WeakSet<object>();

/**
 * The companion papers table (migration "umpe trip companion papers", UX6 package 4). It ships
 * after the companions table, so everything about Travel Bookings papers answers "none" while it is
 * missing: the level then behaves as it did before, and the choice list is empty. Same rules as
 * above: never raises, only "present" is remembered.
 */
export async function tripCompanionPapersTablePresent(db: Db): Promise<boolean> {
  if (papersPresent.has(db)) return true;
  const rows = await db
    .select({ present: sql<boolean>`to_regclass('umpe_trip_companion_papers') is not null` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) papersPresent.add(db);
  return found;
}
