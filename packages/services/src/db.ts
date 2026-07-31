import { schema } from '@visastack/db';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * The driver-agnostic database handle the services operate on.
 *
 * Both the production Neon client and the in-memory PGlite test client are
 * `PgDatabase` instances carrying the canonical schema, so services are written
 * once and run identically in tests and production.
 *
 * IMPORTANT: services open interactive transactions (`db.transaction(...)`) so
 * that each audited mutation and its hash-chained audit event commit together.
 * The runtime handle MUST therefore be a transaction-capable driver — the
 * pooled `drizzle-orm/neon-serverless` client or PGlite — NOT the single-shot
 * `neon-http` client used by stateless probes. See ADR-0009.
 */
export type Schema = typeof schema;

export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** Re-export the canonical schema so services reference tables in one place. */
export { schema };

/** Narrow an array's first element without an unchecked index access. */
export function first<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

/**
 * Assert that a write returned its row. A `RETURNING` insert/update that comes
 * back empty is an infrastructure fault, not a recoverable condition, so this
 * throws rather than returning a `ServiceError`.
 */
export function required<T>(row: T | undefined, what: string): T {
  if (row === undefined) {
    throw new Error(`expected ${what} to be returned by the database`);
  }
  return row;
}

function sqlState(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

/**
 * True for a Postgres unique-violation error (SQLSTATE 23505). Drizzle wraps
 * every driver error in a `DrizzleQueryError` (`pg-core/session.ts`), with the
 * real driver error — the one actually carrying `.code` — attached as
 * `.cause`, not on the wrapper itself. Checking only the top-level error
 * silently never matches, which would turn every race this guards (account
 * identity binding, retention policy upserts, etc.) into an unhandled 500
 * instead of the intended race-recovery path. Walks a couple of `.cause`
 * levels defensively rather than assuming exactly one layer of wrapping.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth++) {
    if (sqlState(current) === '23505') return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
