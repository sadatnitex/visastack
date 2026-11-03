/**
 * UMPE P11: whether the checklist correction and rule impact tables exist yet. The code ships
 * before its migration runs in production, so until then every reader answers "nothing yet",
 * every writer refuses plainly, and publishing a pack behaves exactly as before. `to_regclass`
 * never raises, so a surrounding transaction is never aborted. Only "present" is remembered per
 * database handle (a table is never dropped); "missing" is asked again next time.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db';

const CORRECTION_TABLES = ['umpe_checklist_corrections'] as const;
const IMPACT_TABLES = ['umpe_rule_impact_runs', 'umpe_rule_impacts'] as const;

const correctionsPresent = new WeakSet<object>();
const impactsPresent = new WeakSet<object>();

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

/** The suggestion queue table (migration "umpe p11 corrections"). */
export function correctionTablesPresent(db: Db): Promise<boolean> {
  return allPresent(db, CORRECTION_TABLES, correctionsPresent);
}

/** The two rule impact tables (same migration). */
export function ruleImpactTablesPresent(db: Db): Promise<boolean> {
  return allPresent(db, IMPACT_TABLES, impactsPresent);
}

/** Plain words for every screen that meets a missing table. */
export const CORRECTIONS_NOT_READY =
  'Checklist corrections can be used once the database is updated. Try again later.';
