import { defineConfig, devices } from '@playwright/test';

/** Variable-keyed env read — avoids the index-signature lint/type rule. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Playwright foundation (master directive §8B).
 *
 * `baseURL` targets a deployed preview/production URL by default — these are
 * deployment-verification tests, not a local dev-server smoke. Point it at
 * localhost explicitly for local iteration:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm --filter @visastack/web e2e
 */
const baseURL = getEnv('PLAYWRIGHT_BASE_URL') ?? 'https://visastack-five.vercel.app';
const isCI = Boolean(getEnv('CI'));

export default defineConfig({
  testDir: './e2e',
  // Credentialed Neon checks have their own guarded staging configuration.
  testIgnore: ['neon-staging-routes.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    trace: getEnv('E2E_AUTHENTICATED') === 'true' ? 'off' : 'on-first-retry',
    // Never let a screenshot/trace on a redirected auth page linger with a
    // real session — retained only on failure, and pilot data policy forbids
    // real applicant data in any test run.
    screenshot: getEnv('E2E_AUTHENTICATED') === 'true' ? 'off' : 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
