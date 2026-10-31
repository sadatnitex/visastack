import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import BalancedShardSequencer from './vitest-shards';

// Tests here start an in-process Postgres for each case. Under a busy machine (all packages
// testing at once, or a slower build server) that start can pass the 10 second default, so the
// limits are explicit and generous. A genuinely hung test still fails, just after a minute.
export default defineConfig({
  test: {
    // Migrates one database for the whole run; every test database starts from its snapshot.
    globalSetup: [fileURLToPath(new URL('../db/src/test-global-setup.ts', import.meta.url))],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // CI shards are split by how long each file takes (see vitest-shards.ts), so no shard waits
    // on a much slower one. Without --shard this changes nothing.
    sequence: { sequencer: BalancedShardSequencer },
  },
});
