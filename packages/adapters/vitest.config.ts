import { defineConfig } from 'vitest/config';

// Tests here start an in-process Postgres for each case. Under a busy machine (all packages
// testing at once, or a slower build server) that start can pass the 10 second default, so the
// limits are explicit and generous. A genuinely hung test still fails, just after a minute.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
