import { defineConfig } from 'vitest/config';

/**
 * Vitest covers route-level unit tests only. Playwright specs under `e2e/`
 * use Playwright's own `test`/`expect`, not vitest's, and are run separately
 * via `pnpm --filter @visastack/web e2e`.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
});
