import { defineConfig } from 'vitest/config';

// Only the tests that need a real Postgres server (two or more connections at once): see
// packages/db/src/real-postgres-testing.ts. TEST_POSTGRES_URL must name a throwaway server; without
// it these tests fail, they never skip. CI runs them in the "Test other packages" job against a
// Postgres service container.
export default defineConfig({
  test: {
    include: ['src/**/*.pg.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 120_000,
    // One file at a time: each test makes its own databases on the one server.
    fileParallelism: false,
  },
});
