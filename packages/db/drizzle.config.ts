import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration. `generate` produces reviewed, reversible SQL
 * migrations from the schema and does not require a live database. The
 * canonical writable store is Neon Postgres (Build Spec §15); `DATABASE_URL`
 * is only needed for `migrate`/`push` against a real database.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
});
