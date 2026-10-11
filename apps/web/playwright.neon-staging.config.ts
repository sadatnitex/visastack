import { defineConfig } from '@playwright/test';
const targetKey = 'PLAYWRIGHT_BASE_URL';
const baseURL = process.env[targetKey];
if (!baseURL) throw new Error('BLOCKED: explicit isolated staging origin is required.');
export default defineConfig({
  testDir: './e2e',
  testMatch: 'neon-staging-routes.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  forbidOnly: true,
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-light',
      use: { viewport: { width: 1600, height: 1000 }, colorScheme: 'light' },
    },
    {
      name: 'mobile-light',
      use: {
        viewport: { width: 390, height: 844 },
        colorScheme: 'light',
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-dark',
      use: {
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark',
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
