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
