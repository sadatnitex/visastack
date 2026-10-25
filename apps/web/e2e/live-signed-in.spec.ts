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
 *
 * One sign-in per run and no retries: sign-in is limited per email address
 * per hour, so repeated attempts would lock the test account out.
 */

const email = process.env.LIVE_CHECK_EMAIL;
const password = process.env.LIVE_CHECK_PASSWORD;

test.skip(!email || !password, 'LIVE_CHECK_EMAIL and LIVE_CHECK_PASSWORD are not set');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ retries: 0 });

const ERROR_WORDING = /We hit a snag loading this page|This page did not load|Something went wrong/;

async function signIn(page: Page) {
  await page.goto('/auth/sign-in?next=%2Fapp');
  await page.getByLabel('Email address').fill(email ?? '');
  await page.getByLabel('Password', { exact: true }).fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/auth/sign-in') || url.search.includes('e='),
    {
      timeout: 60_000,
    },
  );
  const landed = new URL(page.url());
  // Names the page it landed on, never the address or password used.
  expect(
    landed.pathname.startsWith('/app'),
    `Sign-in ended on ${landed.pathname}${landed.search}`,
  ).toBe(true);
}

async function expectPageWorks(page: Page, where: string) {
  expect(new URL(page.url()).pathname.startsWith('/auth/'), `${where} sent back to sign-in`).toBe(
    false,
  );
  await expect(page.locator('.app-frame'), where).toBeVisible();
  await expect(page.getByText(ERROR_WORDING), `${where} shows an error`).toHaveCount(0);
}

test('the test account signs in and the signed-in workspace works', async ({ page }) => {
  test.setTimeout(180_000);

  await test.step('signs in through the real sign-in page', async () => {
    await signIn(page);
    await expectPageWorks(page, 'The workspace');
    await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
  });

  await test.step('on a phone, shows who you are acting as without opening More', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.workspace-toolbar .workspace-chip summary')).toBeVisible();
    await expect(page.locator('.app-more-toggle')).toHaveAttribute('aria-expanded', 'false');
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, 'The phone page scrolls sideways').toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await test.step("opens the test person's profile, documents, cases and sharing pages", async () => {
    // The account's own person, from its context list, never a guessed id.
    const person = await page
      .locator('.app-shell-nav .workspace-selector nav a[href^="/app/applicant/"]')
      .first()
      .getAttribute('href', { timeout: 10_000 })
      .catch(() => null);
    expect(
      person,
      'The test account has no person yet; add one so these pages are covered',
    ).not.toBeNull();
    for (const section of ['', '/profile', '/documents', '/missions', '/sharing']) {
      const response = await page.goto(`${person}${section}`);
      expect(response?.status(), `${person}${section}`).toBeLessThan(400);
      await expectPageWorks(page, `${person}${section}`);
    }
  });
});
