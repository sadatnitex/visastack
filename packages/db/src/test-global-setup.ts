import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { buildMigratedSnapshot } from './migrated-snapshot';

/**
 * Vitest global setup: migrate one database for the whole test run and hand its snapshot to every
 * test file through `provide`, so no file pays for running the migrations again.
 */
export default async function setup({ provide }: TestProject): Promise<() => Promise<void>> {
  const dir = await mkdtemp(join(tmpdir(), 'visastack-pglite-'));
  const file = join(dir, 'migrated.tar');
  const snapshot = await buildMigratedSnapshot();
  await writeFile(file, Buffer.from(await snapshot.arrayBuffer()));
  provide('migratedPgliteSnapshot', file);
  return async () => {
    await rm(dir, { recursive: true, force: true });
  };
}
