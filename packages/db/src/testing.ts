import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { inject } from 'vitest';
import { buildMigratedSnapshot } from './migrated-snapshot';

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

export { migrationsFolder } from './paths';
export { buildMigratedSnapshot } from './migrated-snapshot';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Path of the migrated data-directory snapshot written by the global setup. */
    migratedPgliteSnapshot: string;
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
