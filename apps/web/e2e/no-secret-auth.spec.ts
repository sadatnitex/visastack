import { expect, test } from '@playwright/test';

test('account recovery explains verification without exposing an account', async ({ page }) => {
  await page.goto('/auth/account-recovery');
  await expect(
    page.getByRole('heading', { name: 'Account Access Needs Verification' }),
  ).toBeVisible();
  await expect(
    page.getByText('Resetting a password confirms access to your email.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Home', exact: true })).toHaveAttribute(
    'href',
    '/',
  );
});
import { isNeonSignInRedirect } from '../scripts/auth-redirect.mjs';

test('existing-account signup feedback offers sign-in and password recovery', async ({ page }) => {
  await page.goto('/auth/sign-up?e=exists');
  await expect(
    page.getByText('An account already uses this email.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'reset your password', exact: true }),
  ).toHaveAttribute('href', '/auth/forgot-password');
  await page.getByRole('link', { name: 'reset your password', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Email Address' })).toBeVisible();
});

/**
 * No-secret authentication/deployment checks (master directive §8B).
 * These never require signed-in credentials and always run in ordinary CI.
 *
 * Tests tagged `@live` are the small set that also runs against the production site after each
 * deployment (playwright-smoke.yml, `--grep @live`). Pull requests still run every test here.
 * Keep the tagged set small: each one costs the live site requests (Vercel Hobby CPU pause,
 * 30 Oct 2026), and scripts/live-checks.test.mjs fails above 12.
 */

test.describe('public surfaces', () => {
  test('landing page renders', { tag: '@live' }, async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('status page renders', async ({ page }) => {
    const response = await page.goto('/status');
    expect(response?.status()).toBe(200);
  });

  test('sign-in page renders', { tag: '@live' }, async ({ page }) => {
    const response = await page.goto('/auth/sign-in');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible();
  });

  test(
    'readiness answers with a status that matches its body',
    { tag: '@live' },
    async ({ request }) => {
      const response = await request.get('/api/health/ready');
      const body = (await response.json()) as { status?: unknown };
      // Same rule as scripts/smoke.mjs: 200 means ready, 503 means degraded, nothing else.
      expect(
        (response.status() === 200 && body.status === 'ready') ||
          (response.status() === 503 && body.status === 'degraded'),
      ).toBe(true);
    },
  );
});

test.describe('unauthenticated access is denied, never leaked', () => {
  for (const path of ['/app', '/app/privacy']) {
    test(
      `${path} redirects to same-site sign-in without rendering the workspace`,
      {
        tag: path === '/app' ? '@live' : [],
      },
      async ({ page, request, baseURL }) => {
        if (!baseURL) throw new Error('A deployment URL is required');
        const response = await request.get(path, { maxRedirects: 0 });
        expect([302, 307]).toContain(response.status());
        const locationHeader = 'location';
        expect(isNeonSignInRedirect(response.headers()[locationHeader] ?? '', baseURL)).toBe(true);
        await page.goto(path);
        expect(isNeonSignInRedirect(page.url(), baseURL)).toBe(true);
        await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible();
      },
    );
  }

  test('/callback is publicly reachable (not itself gated by auth)', async ({ request }) => {
    const response = await request.get('/callback', { maxRedirects: 0 });
    expect(response.status()).toBeLessThan(500);
    expect(response.status()).not.toBe(404);
  });
});
