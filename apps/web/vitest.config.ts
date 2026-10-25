import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest covers route-level and lib-level unit tests. Playwright specs under
 * `e2e/` use Playwright's own `test`/`expect`, not vitest's, and are run
 * separately via `pnpm --filter @visastack/web e2e`.
 */
export default defineConfig({
  // `tsconfig.json` sets `"jsx": "preserve"` because Next compiles JSX itself;
  // without this, a test that renders a component fails with "React is not
  // defined" under Vite's classic transform.
  esbuild: { jsx: 'automatic' },
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**'],
    // About 80 test files load a page or the jobs module inside the test itself. A cold load of
    // that graph is quick alone but can pass the 5 second default when every package tests at
    // once or on a slower build server, and a timed-out load keeps running into the next test.
    // The limits are explicit and generous, as in the database packages; a real hang still fails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Inert unless UI_BASELINE_DIR is set (see test/ui-capture-setup.ts).
    setupFiles: ['./test/ui-capture-setup.ts'],
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
