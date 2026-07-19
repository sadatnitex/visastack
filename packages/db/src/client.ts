import { neon } from '@neondatabase/serverless';
import { type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * Neon client factory and lightweight health probes.
 *
 * Neon is the only canonical writable store (Build Spec §15). This module
 * reads the connection string from the caller (never hard-codes it) and
 * exposes probes used by the readiness endpoint — they surface connectivity
 * and whether migrations have been applied, without leaking any secret.
 */

/** A driver-agnostic surface: both the Neon and PGlite drivers satisfy it. */
export interface ExecutableDb {
  execute(query: SQL): Promise<unknown>;
}

export function createNeonDb(connectionString: string) {
  return drizzle(neon(connectionString), { schema });
}

export type NeonDb = ReturnType<typeof createNeonDb>;

/** Returns true if a trivial query succeeds (throws are the caller's to handle). */
export async function checkConnection(db: ExecutableDb): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}

/** True once the canonical schema has been migrated (probes the accounts table). */
export async function isSchemaApplied(db: ExecutableDb): Promise<boolean> {
  try {
    await db.execute(sql`select 1 from accounts limit 1`);
    return true;
  } catch {
    return false;
  }
}
