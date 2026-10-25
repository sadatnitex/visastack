import { type Page, expect, test } from '@playwright/test';

/**
 * Live signed-in check (owner request, 25 Oct 2026).
 *
 * Signs in to the deployed site with a dedicated test account the owner
 * created (made-up details only) and confirms the signed-in workspace works.
 * Read-only: it opens pages and menus, and creates, edits or shares nothing.
 *
 * Credentials come only from the environment (GitHub Actions secrets
 * LIVE_CHECK_EMAIL and LIVE_CHECK_PASSWORD) and are never printed. Traces,
 * screenshots and video are off for this file, because a trace can record
 * what was typed into the password field. Skipped when the secrets are absent.
 */

const email = process.env.LIVE_CHECK_EMAIL;
const password = process.env.LIVE_CHECK_PASSWORD;

test.skip(!email || !password, 'LIVE_CHECK_EMAIL and LIVE_CHECK_PASSWORD are not set');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/auth/sign-in?next=%2Fapp');
  await page.getByLabel('Email address').fill(email ?? '');
  await page.getByLabel('Password', { exact: true }).fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 30_000 });
}

test('signs in and reaches the signed-in workspace', async ({ page }) => {
  await signIn(page);
  expect(new URL(page.url()).pathname.startsWith('/auth/')).toBe(false);
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
});

test('on a phone, shows who you are acting as without opening More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const chip = page.locator('.workspace-toolbar .workspace-chip summary');
  await expect(chip).toBeVisible();
  await expect(page.locator('.app-more-toggle')).toHaveAttribute('aria-expanded', 'false');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test('opens the profile, documents, cases and sharing pages of the test person', async ({
  page,
}) => {
  await signIn(page);
  // The test account's own person, from the context menu, never a guessed id.
  const person = await page
    .locator('.app-shell-nav .workspace-selector nav a[href^="/app/applicant/"]')
    .first()
    .getAttribute('href', { timeout: 10_000 })
    .catch(() => null);
  test.skip(!person, 'The test account has no person yet; add one to cover these pages');
  for (const section of ['', '/profile', '/documents', '/missions', '/sharing']) {
    const response = await page.goto(`${person}${section}`);
    expect(response?.status(), `${person}${section}`).toBeLessThan(400);
    expect(new URL(page.url()).pathname.startsWith('/auth/')).toBe(false);
    await expect(page.locator('main, .app-main').first()).toBeVisible();
  }
});
