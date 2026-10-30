import { sql } from 'drizzle-orm';
import type { Db } from './db';

/**
 * Whether migration 0106 (S20, AI app original files) has run. Kept apart from
 * `ai-connection-files.ts` so the AI feature settings can ask it without loading the rest.
 */

/** Database handles already seen with migration 0106 in place. Only a "yes" is kept. */
const READY = new WeakSet<object>();

/**
 * Whether migration 0106 has run: the table and its same-record trigger (its last statement) both
 * exist. Read from the catalogue, so it never fails a transaction the way a query on a missing
 * table would. A "yes" is cached per database handle; a "no" is never cached.
 */
export async function aiFilesAvailable(db: Db): Promise<boolean> {
  if (READY.has(db)) return true;
  const rows = await db
    .select({
      ready: sql<boolean>`(
        to_regclass('ai_connection_documents') is not null
        and exists (
          select 1 from pg_trigger where tgname = 'ai_connection_documents_same_record'
        )
      )`,
    })
    .from(sql`(select 1) as probe`);
  const ready = rows[0]?.ready === true;
  if (ready) READY.add(db);
  return ready;
}
