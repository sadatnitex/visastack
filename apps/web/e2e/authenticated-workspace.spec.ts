import { expect, test } from '@playwright/test';

/**
 * Authenticated workspace journey (master directive §8B/§8C).
 *
 * Requires a real WorkOS **staging** test identity — this spec is the shared
 * source of truth for both:
 *   - an optional local/manual run (set the env vars yourself), and
 *   - the `workos-staging-e2e.yml` GitHub Actions workflow, which supplies
 *     them from repository secrets and is SKIPPED entirely when absent.
 *
 * Required env vars (documented here; no values are ever committed):
 *   WORKOS_STAGING_TEST_EMAIL    — a synthetic WorkOS-staging test user email
 *   WORKOS_STAGING_TEST_PASSWORD — that user's password
 *
 * Synthetic identity only. Never production credentials. Never logs
 * credentials or session tokens (Playwright's default HTML report can capture
 * request headers — traces are attached only on failure, per playwright.config).
 *
 * KNOWN LIMITATION (documented per the truthful-status requirement): the exact
 * selectors on WorkOS's hosted AuthKit sign-in page have not been verified live
 * against WorkOS staging in this session (no credentials were available to run
 * it). Role/label-based locators are used deliberately (the most resilient
 * Playwright pattern to hosted-UI markup changes), but this spec should be
 * treated as "implemented, not yet verified" until it is actually run once
 * against real WorkOS staging credentials.
 */

/** Variable-keyed env read — avoids the index-signature lint/type rule. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

const email = getEnv('WORKOS_STAGING_TEST_EMAIL');
const password = getEnv('WORKOS_STAGING_TEST_PASSWORD');
const hasCredentials = Boolean(email && password);

test.describe('authenticated workspace journey', () => {
  test.skip(!hasCredentials, 'WORKOS_STAGING_TEST_EMAIL / WORKOS_STAGING_TEST_PASSWORD not set');

  async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/app');
    await expect(page).toHaveURL(/workos\.com|authkit\.app/);
    await page.getByLabel(/email/i).fill(email ?? '');
    await page.getByRole('button', { name: /continue|next|sign in/i }).click();
    await page.getByLabel(/password/i).fill(password ?? '');
    await page.getByRole('button', { name: /sign in|continue|log in/i }).click();
    await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 });
  }

  test('signs in and reaches the authenticated workspace', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/your workspace/i)).toBeVisible();
  });

  test('creates an applicant, saves a fact, logs out, signs in again, and the fact persists', async ({
    page,
  }) => {
    await signIn(page);

    const applicantName = `E2E Synthetic ${Date.now()}`;
    await page.getByLabel(/display name|applicant name/i).fill(applicantName);
    await page.getByRole('button', { name: /create applicant|add applicant/i }).click();
    await expect(page.getByText(applicantName)).toBeVisible();

    await page.getByText(applicantName).click();
    // The exact manual-profile field markup is not yet confirmed against a
    // live run; this targets the first available text field on the applicant
    // page as a best-effort persistence probe.
    const firstField = page.getByRole('textbox').first();
    const syntheticValue = `synthetic-${Date.now()}`;
    await firstField.fill(syntheticValue);
    await page.keyboard.press('Enter');

    await page.getByRole('button', { name: /sign out|log out/i }).click();
    await expect(page).toHaveURL(/workos\.com|authkit\.app|\/$/);

    await signIn(page);
    await page.getByText(applicantName).click();
    await expect(page.getByRole('textbox').first()).toHaveValue(syntheticValue);
  });

  test('terminating the session denies the next protected request', async ({ page, context }) => {
    await signIn(page);
    await page.getByRole('button', { name: /sign out|log out/i }).click();
    await context.clearCookies();
    await page.goto('/app/privacy');
    await expect(page).toHaveURL(/workos\.com|authkit\.app/);
  });
});
