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

/** True for a Postgres unique-violation error (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
