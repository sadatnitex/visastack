import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest covers route-level and lib-level unit tests. Playwright specs under
 * `e2e/` use Playwright's own `test`/`expect`, not vitest's, and are run
 * separately via `pnpm --filter @visastack/web e2e`.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
  resolve: {
    alias: {
      // `server-only` is a Next.js-bundler-specific marker package; plain
      // Vite/vitest cannot resolve it at all, so lib modules that start with
      // `import 'server-only'` need a no-op stand-in to be unit-testable.
      'server-only': fileURLToPath(new URL('./test/server-only-shim.ts', import.meta.url)),
    },
  },
});
