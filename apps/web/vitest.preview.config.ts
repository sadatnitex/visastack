import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The screen preview (`pnpm --filter @visastack/web preview`). It is kept out of the normal
 * test run on purpose: it builds a database, seeds a made-up world and renders every page.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['preview/**/*.preview.tsx'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./test/server-only-shim.ts', import.meta.url)),
    },
  },
});
