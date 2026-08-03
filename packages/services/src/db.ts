import { schema } from '@visastack/db';
import { sql } from 'drizzle-orm';
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

/**
 * Namespace for per-email advisory locks — the high bits of the composite
 * `pg_advisory_xact_lock(int, int)` key, keeping this lock space disjoint
 * from any single-bigint `pg_advisory_xact_lock(key)` used elsewhere (e.g.
 * `audit.ts`'s chain lock, `platform-roles.ts`'s grant lock).
 */
const EMAIL_LOCK_NAMESPACE = 733_100_1;

/**
 * Acquire a transaction-scoped advisory lock scoped to one normalized email
 * address, released automatically on commit or rollback. Serializes any two
 * operations that each check-then-mutate account/invitation state for the
 * SAME email — e.g. account provisioning creating a first-time account
 * while `createInvitation` concurrently creates a pending invitation for
 * that same address (Codex review, PR #65): a plain read, no matter how
 * late in a transaction, can never see a concurrent transaction's
 * not-yet-committed write, so nothing short of a shared lock actually closes
 * a cross-table race like this — narrowing the read-check's timing only
 * narrows the window, it never closes it. Different emails never contend
 * (hashed into the key), so ordinary concurrent sign-ins for different
 * addresses are never serialized against each other.
 */
export async function lockOnEmail(tx: Db, email: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${EMAIL_LOCK_NAMESPACE}, hashtext(${email}))`);
}
