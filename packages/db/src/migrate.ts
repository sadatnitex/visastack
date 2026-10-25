import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { DATABASE_URL_ENV_CANDIDATES, resolveDatabaseUrl } from './client';
import { migrationsFolder } from './paths';

/**
 * Applies the reviewed SQL migrations to Neon. Run deliberately (not on every
 * deploy) with DATABASE_URL set:
 *
 *   DATABASE_URL=... pnpm --filter @visastack/db db:migrate
 *
 * Migrations against the protected production branch are an intentional,
 * reviewed operation (Build Spec §15).
 *
 * Commercial V1 directive Part 9 section 13 asks for a dedicated migration credential: a database
 * role used only here, never the application's own. Set `MIGRATION_DATABASE_URL` to that role's
 * connection string and it is used in preference to everything else. Without it the script still
 * works (the shared candidates above) but says so loudly, because migrating with the
 * application's own credential is a launch blocker, not a standing arrangement.
 */
async function main(): Promise<void> {
  const { MIGRATION_DATABASE_URL: dedicated } = process.env;
  const connectionString =
    dedicated && dedicated.length > 0 ? dedicated : resolveDatabaseUrl(process.env);
  if (!connectionString) {
    throw new Error(
      `No database connection string found. Set MIGRATION_DATABASE_URL (preferred) or one of these as a repository Actions secret: ${DATABASE_URL_ENV_CANDIDATES.join(', ')}.`,
    );
  }
  if (!dedicated) {
    process.stderr.write(
      'warning: MIGRATION_DATABASE_URL is not set, so migrations run with the application credential. A dedicated migration credential is required before commercial launch.\n',
    );
  }
  const db = drizzle(neon(connectionString));
  await migrate(db, { migrationsFolder });
  // The release record needs the migration version this run brought the database to.
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
    entries: { tag: string }[];
  };
  const newest = journal.entries.at(-1)?.tag ?? 'unknown';
  process.stdout.write(
    `migrations applied (credential: ${dedicated ? 'dedicated' : 'application'}); newest migration in this build: ${newest}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`migration failed: ${(error as Error).message}\n`);
  process.exit(1);
});
