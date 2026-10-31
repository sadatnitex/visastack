import { sql } from 'drizzle-orm';
import type { Db } from './db';

/**
 * Whether the two agency AI migrations (S22) have run. Kept apart from the agency AI services so
 * the AI feature settings and the sharing screens can ask without loading the rest.
 *
 * - `aiAssistAvailable`: the first migration added `AI_ASSIST` to the sharing permission enum.
 *   Until then the permission is never written (a write would fail), the traveller's choice is not
 *   shown, and nothing reads it as granted.
 * - `agencyAiAvailable`: both migrations ran: the permission, the agency setting table, the agency
 *   connection table and the kind guard trigger (the last statement). Until then no agency
 *   connection can be made and the agency setting reads "Available After the Next Update".
 *
 * Both are read from the catalogue, so they never fail a transaction the way a query on a missing
 * table or an unknown enum value would. A "yes" is cached per database handle; a "no" never is.
 */

const ASSIST_READY = new WeakSet<object>();
const AGENCY_READY = new WeakSet<object>();

const ASSIST_PRESENT = sql<boolean>`exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'permission_action' and e.enumlabel = 'AI_ASSIST'
)`;

/** Whether `AI_ASSIST` exists as a sharing permission in this database. */
export async function aiAssistAvailable(db: Db): Promise<boolean> {
  if (ASSIST_READY.has(db) || AGENCY_READY.has(db)) return true;
  const rows = await db.select({ ready: ASSIST_PRESENT }).from(sql`(select 1) as probe`);
  const ready = rows[0]?.ready === true;
  if (ready) ASSIST_READY.add(db);
  return ready;
}

/** Whether agency AI connections can be stored: both S22 migrations are in place. */
export async function agencyAiAvailable(db: Db): Promise<boolean> {
  if (AGENCY_READY.has(db)) return true;
  const rows = await db
    .select({
      ready: sql<boolean>`(
        ${ASSIST_PRESENT}
        and to_regclass('organization_ai_settings') is not null
        and to_regclass('ai_connection_agencies') is not null
        and exists (select 1 from pg_trigger where tgname = 'ai_connection_agencies_fixed')
      )`,
    })
    .from(sql`(select 1) as probe`);
  const ready = rows[0]?.ready === true;
  if (ready) AGENCY_READY.add(db);
  return ready;
}
