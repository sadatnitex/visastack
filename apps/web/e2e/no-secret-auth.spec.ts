import { expect, test } from '@playwright/test';

/**
 * No-secret authentication/deployment checks (master directive §8B).
 * These never require WorkOS credentials and always run in ordinary CI.
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
  test('/app redirects to WorkOS instead of rendering the workspace', async ({ page }) => {
    await page.goto('/app');
    // Middleware-owned auth (ADR: middlewareAuth) sends an unauthenticated
    // visitor to the WorkOS-hosted sign-in — the workspace content must never
    // render for them.
    await expect(page).toHaveURL(/workos\.com|authkit\.app/);
  });

  test('a nested protected route also redirects, never rendering applicant content', async ({
    page,
  }) => {
    await page.goto('/app/privacy');
    await expect(page).toHaveURL(/workos\.com|authkit\.app/);
    // Never assert on page content here beyond the URL — if this ever starts
    // rendering app chrome instead of redirecting, that IS the P0 regression.
  });

  test('/callback is publicly reachable (not itself gated by auth)', async ({ request }) => {
    const response = await request.get('/callback', { maxRedirects: 0 });
    expect(response.status()).toBeLessThan(500);
    expect(response.status()).not.toBe(404);
  });
});
