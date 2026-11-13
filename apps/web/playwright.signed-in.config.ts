import { defineConfig } from '@playwright/test';

/**
 * The on-demand signed-in journeys against an isolated staging deployment
 * (docs/operations/staging-journeys.md). Used only by .github/workflows/neon-staging-journeys.yml,
 * never by a pull request and never against production.
 *
 * There is no default target: without an explicit origin nothing can run, so a mistake can never
 * send synthetic sign-ins to a real site. The workflow also proves the origin is a non-production
 * deployment of this exact revision before this config is used.
 *
 * One worker, no retries, no skipped tests (a retry would hide a flaky journey; the results check
 * refuses retried and skipped runs). Traces, video and automatic screenshots are off because a
 * signed-in page holds a session; the specs attach screenshots of synthetic accounts on purpose.
 */
/** Variable-keyed env read, to avoid the index-signature lint/type rule. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}
const origin = getEnv('PLAYWRIGHT_BASE_URL');
if (!origin) throw new Error('BLOCKED: explicit isolated staging origin is required.');

/**
 * The order the specs run in is explicit, not an accident of file names. A spec that ends or changes
 * a grant other specs rely on goes in this list, in the order it must run. Each one runs in its own
 * last stage (a project of its own, which depends on the stage before it), after everything else has
 * finished: "journeys" first, then "flagship" (the Answer from Your Records journey, whose last test
 * ends the agency's access), then "revocation" (which finds the access already ended, or ends it).
 * One project for each, because a project does not run its files in the order of a list, and a
 * project gets its own worker. scripts/staging-journeys.test.mjs fails if such a spec is anywhere
 * else, or if the order differs from the one in scripts/check-staging-journey-setup.mjs.
 */
const LAST_STAGE_SPECS = ['answer-from-records.spec.ts', 'agency-loop-revoke.spec.ts'];
const browser = { browserName: 'chromium', colorScheme: 'light' } as const;

export default defineConfig({
  testDir: './e2e/signed-in',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [['json'], ['list']],
  use: {
    baseURL: origin,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'journeys', testIgnore: LAST_STAGE_SPECS, use: browser },
    {
      name: 'flagship',
      testMatch: 'answer-from-records.spec.ts',
      dependencies: ['journeys'],
      use: browser,
    },
    {
      name: 'revocation',
      testMatch: 'agency-loop-revoke.spec.ts',
      dependencies: ['flagship'],
      use: browser,
    },
  ],
});
