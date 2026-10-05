import { sql } from 'drizzle-orm';
import type { ExecutableDb } from './client';

/**
 * Migration drift: whether the database has every migration this build ships.
 *
 * `isSchemaApplied` only proves one early table exists, so a deployment whose
 * code is newer than its database looked ready while pages that read the newer
 * tables failed. The migrator records each applied migration in
 * `drizzle.__drizzle_migrations` with the journal's own timestamp, and applies
 * a migration only when that timestamp is newer than the newest one recorded.
 * This applies the same rule to report what is still pending.
 */

/** The two fields of a `meta/_journal.json` entry that decide what is pending. */
export interface MigrationJournalEntry {
  readonly tag: string;
  readonly when: number;
}

export interface MigrationStatus {
  /** Migrations this build ships. */
  readonly expected: number;
  /** Migrations the database has recorded as applied. */
  readonly applied: number;
  /** Shipped migrations the database has not applied, oldest first. */
  readonly pending: readonly string[];
}

/** Postgres `undefined_table` (42P01) or `invalid_schema_name` (3F000), as raised directly or wrapped by a driver. */
function isMissingMigrationTable(error: unknown): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || depth > 3) return false;
    const { code, message, cause } = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === '42P01' || code === '3F000') return true;
    if (
      typeof message === 'string' &&
      /(relation|schema) .* does not exist/i.test(message) &&
      /__drizzle_migrations|"drizzle"|schema drizzle/i.test(message)
    ) {
      return true;
    }
    return visit(cause, depth + 1);
  };
  return visit(error, 0);
}

interface MigrationCountRow {
  readonly n?: unknown;
  readonly newest?: unknown;
}

function firstRow(result: unknown): MigrationCountRow | undefined {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows[0] as MigrationCountRow | undefined) : undefined;
}

/**
 * Compares the migrations recorded in the database with the journal shipped in
 * this build. A database that has never been migrated reports everything as
 * pending; any other failure (a dropped connection, say) is the caller's to
 * handle, never reported as "nothing pending".
 */
export async function getMigrationStatus(
  db: ExecutableDb,
  journal: readonly MigrationJournalEntry[],
): Promise<MigrationStatus> {
  let applied = 0;
  let newestApplied: number | null = null;
  try {
    const result = await db.execute(
      sql`select count(*)::int as n, max(created_at)::text as newest from drizzle.__drizzle_migrations`,
    );
    const row = firstRow(result);
    applied = Number(row?.n ?? 0);
    newestApplied = row?.newest == null ? null : Number(row.newest);
  } catch (error) {
    if (!isMissingMigrationTable(error)) throw error;
  }
  const pending = [...journal]
    .sort((a, b) => a.when - b.when)
    .filter((entry) => newestApplied === null || entry.when > newestApplied)
    .map((entry) => entry.tag);
  return { expected: journal.length, applied, pending };
}
