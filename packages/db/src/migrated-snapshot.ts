import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from './paths';

/**
 * Migrates a throwaway database and returns its data directory as an uncompressed tarball. Kept
 * apart from `testing.ts` so the Vitest global setup, which runs outside a test worker, loads no
 * worker-only Vitest code.
 */
export async function buildMigratedSnapshot(): Promise<Blob> {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder });
    return await client.dumpDataDir('none');
  } finally {
    await client.close();
  }
}
