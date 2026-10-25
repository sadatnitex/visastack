import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { inject } from 'vitest';

/**
 * Test support: fresh, fully migrated in-memory databases.
 *
 * Running every shipped migration takes about 1.5 s per database, and most service tests start a
 * new database for each case, so migrating was the bulk of the suite's time. Instead the test run
 * migrates once (`test-global-setup.ts`, registered in each package's vitest config), saves the
 * resulting data directory, and every database starts from that copy (about 0.4 s). Each call
 * still returns its own independent database: nothing written in one test is visible to another.
 *
 * Without the global setup (a package that has not registered it) the snapshot is built once per
 * test file instead, which is slower but gives the same databases.
 *
 * Tests that exercise the migrations themselves (partial or older schemas) keep migrating by hand.
 */

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

declare module 'vitest' {
  export interface ProvidedContext {
    /** Path of the migrated data-directory snapshot written by the global setup. */
    migratedPgliteSnapshot: string;
  }
}

/** Migrates a throwaway database and returns its data directory as an uncompressed tarball. */
export async function buildMigratedSnapshot(): Promise<Blob> {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder });
    return await client.dumpDataDir('none');
  } finally {
    await client.close();
  }
}

async function loadSnapshot(): Promise<Blob> {
  const file = inject('migratedPgliteSnapshot') as string | undefined;
  return file ? new Blob([await readFile(file)]) : buildMigratedSnapshot();
}

let snapshot: Promise<Blob> | undefined;

/** A new in-memory Postgres with every shipped migration applied. */
export async function createMigratedPglite(): Promise<PGlite> {
  snapshot ??= loadSnapshot().catch((error: unknown) => {
    // Never cache a failure: the next caller retries instead of inheriting it.
    snapshot = undefined;
    throw error;
  });
  return new PGlite({ loadDataDir: await snapshot });
}
