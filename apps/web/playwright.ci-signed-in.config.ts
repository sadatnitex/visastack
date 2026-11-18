import { defineConfig, devices } from '@playwright/test';

/** Variable-keyed env read (avoids both the index-signature and the literal-key rule). */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Signed-in guard on the CI machine (docs/operations/ci-signed-in-guard.md): the unchanged
 * production build, started on this machine, with a made-up traveller and agency admin signed in
 * through a loopback stand-in sign-in service. It only ever runs against this machine.
 */
const baseURL = getEnv('PLAYWRIGHT_BASE_URL') ?? 'http://localhost:3100';
const host = new URL(baseURL).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error('The signed-in guard runs only against the app started on this machine.');
}
if (getEnv('VERCEL')) throw new Error('The signed-in guard never runs on Vercel.');
// Local runs may point at an already installed Chromium; CI installs the pinned one.
const executablePath = getEnv('CI_SIGNED_IN_CHROMIUM');

export default defineConfig({
  testDir: './ci-signed-in',
  testMatch: '**/*.guard.ts',
  globalSetup: './ci-signed-in/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(getEnv('CI')),
  retries: 0,
  reporter: getEnv('CI') ? [['github'], ['list']] : [['list']],
  use: { baseURL, trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath, args: ['--no-sandbox'] } } : {}),
      },
    },
  ],
});
