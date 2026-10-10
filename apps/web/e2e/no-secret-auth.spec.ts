import { expect, test } from '@playwright/test';

test('account recovery explains verification without exposing an account', async ({ page }) => {
  await page.goto('/auth/account-recovery');
  await expect(
    page.getByRole('heading', { name: 'Account access needs verification' }),
  ).toBeVisible();
  await expect(
    page.getByText('Resetting a password confirms access to your email.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to home', exact: true })).toHaveAttribute(
    'href',
    '/',
  );
});
import { isNeonSignInRedirect } from '../scripts/auth-redirect.mjs';

/**
 * No-secret authentication/deployment checks (master directive §8B).
 * These never require signed-in credentials and always run in ordinary CI.
 */

test.describe('public surfaces', () => {
  test('landing page renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('status page renders', async ({ page }) => {
    const response = await page.goto('/status');
    expect(response?.status()).toBe(200);
  });
});

test.describe('unauthenticated access is denied, never leaked', () => {
  for (const path of ['/app', '/app/privacy']) {
    test(`${path} redirects to same-site sign-in without rendering the workspace`, async ({
      page,
      request,
      baseURL,
    }) => {
      if (!baseURL) throw new Error('A deployment URL is required');
      const response = await request.get(path, { maxRedirects: 0 });
      expect([302, 307]).toContain(response.status());
      const locationHeader = 'location';
      expect(isNeonSignInRedirect(response.headers()[locationHeader] ?? '', baseURL)).toBe(true);
      await page.goto(path);
      expect(isNeonSignInRedirect(page.url(), baseURL)).toBe(true);
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    });
  }

  test('/callback is publicly reachable (not itself gated by auth)', async ({ request }) => {
    const response = await request.get('/callback', { maxRedirects: 0 });
    expect(response.status()).toBeLessThan(500);
    expect(response.status()).not.toBe(404);
  });
});
