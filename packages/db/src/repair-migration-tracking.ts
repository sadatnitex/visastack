import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { DATABASE_URL_ENV_CANDIDATES, resolveDatabaseUrl } from './client';

/**
 * ONE-TIME REPAIR, not a general-purpose tool: run once (2026-09-17) to fix a
 * specific, diagnosed problem, then this file and its workflow
 * (db-repair-migration-tracking.yml) are deleted in a follow-up commit.
 *
 * What happened: drizzle-orm's neon-http migrate() (node_modules/drizzle-orm/
 * neon-http/migrator.js) only records every pending migration's tracking row
 * in ONE batch, after ALL of them have run their SQL (see the two separate
 * loops in that file). A run that gets interrupted after executing a
 * migration's DDL but before that final batch-insert loop completes leaves
 * the schema ahead of what drizzle.__drizzle_migrations records, with NO
 * tracking row for the migration that actually ran. This project's Vercel
 * preview builds have been interrupted (by the now-fixed Neon branch-limit
 * failure) at essentially every deployment this session, so this is the most
 * likely explanation, though the exact interrupted run cannot be identified
 * after the fact. `db:migrate` (the real migrator) then always retries from
 * its own last recorded row, hits the same already-applied migration's
 * CREATE TABLE again, and fails on a genuine "already exists" error, exactly
 * the failure this repair is fixing (known-issues.md item 36).
 *
 * What this does: walks the same migration journal `db:migrate` uses, in the
 * same order, using the exact same hash/timestamp computation (reusing
 * drizzle-orm's own readMigrationFiles rather than reimplementing it, so a
 * later real `db:migrate` run treats every row this writes identically to
 * one it would have written itself). For each migration not yet recorded, it
 * runs each statement and only swallows the narrow set of Postgres error
 * codes that mean "the exact object this statement creates already exists"
 * (duplicate_table/object/column/function/schema), continuing to the next
 * statement; anything else aborts the whole run immediately, unrecorded,
 * fail-closed, so a genuine bug is never mistaken for this specific problem.
 * A migration whose every statement already existed is recorded with no
 * schema change at all; one with any new statement actually applies it. Full
 * log output is the audit trail for this run, since this is the one place
 * this session touches live data directly rather than through a reviewed,
 * repeatable migration file.
 */

// Postgres duplicate_* codes (Class 42): the exact object this statement
// would create already exists, not any other kind of failure.
const ALREADY_EXISTS_CODES = new Set([
  '42701', // duplicate_column
  '42710', // duplicate_object (types, constraints)
  '42723', // duplicate_function
  '42P06', // duplicate_schema
  '42P07', // duplicate_table (tables, indexes, views)
]);

interface JournalEntry {
  readonly when: number;
  readonly tag: string;
}

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    throw new Error(
      `No database connection string found. Set one of these as a repository Actions secret: ${DATABASE_URL_ENV_CANDIDATES.join(', ')}.`,
    );
  }
  const sql = neon(connectionString);
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

  await sql('CREATE SCHEMA IF NOT EXISTS drizzle');
  await sql(
    'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
  );

  const lastRows = (await sql(
    'select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
  )) as unknown as ReadonlyArray<{ created_at: string | number }>;
  const lastAppliedMillis = lastRows[0] ? Number(lastRows[0].created_at) : -1;
  process.stdout.write(`last recorded migration timestamp: ${lastAppliedMillis}\n`);

  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
    entries: readonly JournalEntry[];
  };

  for (const entry of journal.entries) {
    if (entry.when <= lastAppliedMillis) continue;

    const raw = readFileSync(`${migrationsFolder}/${entry.tag}.sql`, 'utf8');
    const statements = raw
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    process.stdout.write(`\n${entry.tag}: ${statements.length} statement(s)\n`);
    let appliedCount = 0;
    let skippedCount = 0;
    for (const statement of statements) {
      try {
        await sql(statement);
        appliedCount += 1;
        process.stdout.write(`  applied: ${statement.slice(0, 70).replace(/\s+/g, ' ')}...\n`);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code && ALREADY_EXISTS_CODES.has(code)) {
          skippedCount += 1;
          process.stdout.write(
            `  already exists (${code}), skipped: ${statement.slice(0, 70).replace(/\s+/g, ' ')}...\n`,
          );
          continue;
        }
        throw error;
      }
    }

    const hash = createHash('sha256').update(raw).digest('hex');
    await sql('insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)', [
      hash,
      entry.when,
    ]);
    process.stdout.write(
      `${entry.tag}: recorded (${appliedCount} applied, ${skippedCount} already existed).\n`,
    );
  }

  process.stdout.write('\nrepair complete\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`repair failed: ${(error as Error).message}\n`);
  process.exit(1);
});
