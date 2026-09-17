import { Pool, neon, neonConfig } from '@neondatabase/serverless';
import { type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

/**
 * Neon client factory and lightweight health probes.
 *
 * Neon is the only canonical writable store (Build Spec §15). This module
 * reads the connection string from the caller (never hard-codes it) and
 * exposes probes used by the readiness endpoint — they surface connectivity
 * and whether migrations have been applied, without leaking any secret.
 */

/**
 * Candidate environment variable names for the Neon connection string, in
 * priority order. Vercel's Neon/Postgres integrations use different names
 * depending on how the store was connected, so we resolve across all of them.
 *
 * `DIRECT_DATABASE_URL` is checked first and is never written by that
 * integration (2026-09-17 incident: the integration's own managed
 * DATABASE_URL/POSTGRES_URL/etc. kept resolving to a stale value no matter
 * what was pasted into those same-named fields in Vercel, because the
 * integration re-syncs them on every deploy). Set it manually when the
 * integration-managed names cannot be trusted.
 */
export const DATABASE_URL_ENV_CANDIDATES = [
  'DIRECT_DATABASE_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_PRISMA_URL',
] as const;

/** Variable-keyed default write — avoids the index-signature and literal-key lint rules. */
function ensureEnv(name: string, value: string): void {
  if (process.env[name] === undefined) process.env[name] = value;
}

/** Resolve the connection string from the first present candidate variable. */
export function resolveDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const name of DATABASE_URL_ENV_CANDIDATES) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** A driver-agnostic surface: both the Neon and PGlite drivers satisfy it. */
export interface ExecutableDb {
  execute(query: SQL): Promise<unknown>;
}

export function createNeonDb(connectionString: string) {
  return drizzle(neon(connectionString), { schema });
}

export type NeonDb = ReturnType<typeof createNeonDb>;

/**
 * A transaction-capable pooled client (WebSocket-based) for the application
 * write path. The stateless `neon-http` client above cannot open interactive
 * transactions, which the service layer requires (ADR-0009). Create one per
 * request and end it when done.
 */
export function createPooledDb(connectionString: string) {
  // Force `ws` to its pure-JS frame masker (see apps/web instrumentation.ts for
  // the full rationale). The web app's instrumentation hook sets these before
  // `ws` evaluates; this is a defensive fallback for any other entrypoint.
  ensureEnv('WS_NO_BUFFER_UTIL', '1');
  ensureEnv('WS_NO_UTF_8_VALIDATE', '1');
  if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString });
  const db = drizzlePool(pool, { schema });
  return { db, pool };
}

export type PooledDb = ReturnType<typeof createPooledDb>['db'];

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
