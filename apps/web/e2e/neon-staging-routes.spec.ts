import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
// Actual deployed routes only. No fixture markup and no skipped authenticated checks.
// This captures route evidence; it does not certify every lifecycle or PDF alignment.
function configured(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`BLOCKED: missing staging setting ${name}`);
  return value;
}
const person = configured('E2E_TRAVELLER_ID');
const mission = configured('E2E_CASE_ID');
const org = configured('E2E_AGENCY_ORG_ID');
async function signIn(page: Page, role: string) {
  await page.goto('/auth/sign-in');
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page
    .getByLabel('Email address', { exact: true })
    .fill(configured(`NEON_STAGING_${role}_EMAIL`));
  await page
    .getByLabel('Password', { exact: true })
    .fill(configured(`NEON_STAGING_${role}_PASSWORD`));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/);
}
const screens = [
  { name: '01-home', path: '/' },
  { name: '02-trust', path: '/trust' },
  { name: '03-signup', path: '/auth/sign-up' },
  { name: '04-overview', path: `/app/applicant/${person}`, role: 'TRAVELLER' },
  { name: '05-profile', path: `/app/applicant/${person}/profile`, role: 'TRAVELLER' },
  { name: '06-documents', path: `/app/applicant/${person}/documents`, role: 'TRAVELLER' },
  { name: '07-case', path: `/app/mission/${mission}`, role: 'TRAVELLER' },
  { name: '08-sharing', path: `/app/applicant/${person}/sharing`, role: 'TRAVELLER' },
  { name: '09-agency', path: `/app/agency/${org}`, role: 'AGENCY_ADMIN' },
  { name: '10-admin', path: '/app/admin', role: 'PLATFORM_ADMIN' },
];
for (const screen of screens)
  test(`actual reference route ${screen.name}`, async ({ page }, info) => {
    if (screen.role) await signIn(page, screen.role);
    const response = await page.goto(screen.path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(
      new RegExp(`${screen.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    );
    await expect(page.locator('main')).toBeVisible();
    if (screen.role) {
      await expect(page.locator('.app-frame')).toBeVisible();
      await expect(page.locator('.pilot-banner')).toHaveCount(0);
    }
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const issues = await new AxeBuilder({ page }).analyze();
    expect(
      issues.violations.filter(
        (issue) => issue.impact === 'critical' || issue.impact === 'serious',
      ),
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${screen.name}.png`), fullPage: true });
  });
test('a different Neon identity cannot open the traveller record', async ({ page }) => {
  await signIn(page, 'OTHER_TRAVELLER');
  const response = await page.goto(`/app/applicant/${person}/profile`);
  expect(response?.status()).toBe(404);
});
test('an agency worker cannot discover administrator team controls', async ({ page }) => {
  await signIn(page, 'AGENCY_WORKER');
  await page.goto(`/app/agency/${org}`);
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.locator(`.app-shell-nav a[href="/app/agency/${org}/team"]`)).toHaveCount(0);
  await page.goto(`/app/agency/${org}/team`);
  await expect(page.getByText(/administrator|admin-only|owner or admin/i).first()).toBeVisible();
});
test('a traveller is refused platform administration', async ({ page }) => {
  await signIn(page, 'TRAVELLER');
  await page.goto('/app/admin');
  await expect(
    page.getByText('This area is restricted to platform administrators.', { exact: false }),
  ).toBeVisible();
});
