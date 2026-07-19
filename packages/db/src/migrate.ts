import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

/**
 * Applies the reviewed SQL migrations to Neon. Run deliberately (not on every
 * deploy) with DATABASE_URL set:
 *
 *   DATABASE_URL=... pnpm --filter @visastack/db db:migrate
 *
 * Migrations against the protected production branch are an intentional,
 * reviewed operation (Build Spec §15).
 */
async function main(): Promise<void> {
  const { DATABASE_URL: connectionString } = process.env;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const db = drizzle(neon(connectionString));
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
  await migrate(db, { migrationsFolder });
  process.stdout.write('migrations applied\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`migration failed: ${(error as Error).message}\n`);
  process.exit(1);
});
