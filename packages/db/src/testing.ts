import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/**
 * Test support: fresh, fully migrated in-memory databases.
 *
 * Running every shipped migration takes about 1.5 s per database, and most service tests start a
 * new database for each case, so migrating was the bulk of the suite's time. Instead each test
 * worker migrates once, keeps a snapshot of the resulting data directory, and starts every later
 * database from that snapshot (about 0.4 s). Each call still returns its own independent
 * database: nothing written in one test is visible to another.
 *
 * Tests that exercise the migrations themselves (partial or older schemas) keep migrating by hand.
 */

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

let snapshot: Promise<Blob> | undefined;

async function buildSnapshot(): Promise<Blob> {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder });
    return await client.dumpDataDir('none');
  } finally {
    await client.close();
  }
}

/** A new in-memory Postgres with every shipped migration applied. */
export async function createMigratedPglite(): Promise<PGlite> {
  snapshot ??= buildSnapshot().catch((error: unknown) => {
    // Never cache a failed build: the next caller retries instead of inheriting the failure.
    snapshot = undefined;
    throw error;
  });
  return new PGlite({ loadDataDir: await snapshot });
}
