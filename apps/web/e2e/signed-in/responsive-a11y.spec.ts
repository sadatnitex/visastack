import { expect, test } from '@playwright/test';
import { VERIFIED_IN_SOURCE as S } from './support/selectors';
import { signIn } from './support/session';
import { NOBODY, ids } from './support/setup';
import {
  WIDTHS,
  checkAccessibility,
  checkKeyboard,
  expectNoSidewaysScroll,
  keepScreenshot,
} from './support/ui';

/**
 * Tier 2, the real pages at five widths (docs/operations/staging-journeys.md): no sideways
 * scroll, no serious WCAG 2.2 AA finding, a usable keyboard path, the Cases anchor link, and the
 * app's own not-found page. Screenshots are taken of synthetic accounts only and kept in the run output and uploaded with it, as
 * evidence, not compared to a stored picture (a stored picture would freeze a design
 * nobody has approved).
 */

const TRAVELLER_PAGES = (traveller: string) => [
  { name: 'overview', path: `/app/applicant/${traveller}` },
  { name: 'documents', path: `/app/applicant/${traveller}/documents` },
  { name: 'add-documents', path: `/app/applicant/${traveller}/documents/add` },
  { name: 'cases', path: `/app/applicant/${traveller}/missions` },
  // The case page with its list and item panel (case page plan, package 1).
  { name: 'case', path: `/app/mission/${ids.case()}` },
  { name: 'sharing', path: `/app/applicant/${traveller}/sharing` },
];

const AGENCY_PAGES = (org: string) => [
  { name: 'agency-home', path: `/app/agency/${org}` },
  { name: 'agency-clients', path: `/app/agency/${org}/clients` },
  { name: 'agency-cases', path: `/app/agency/${org}/cases` },
];

for (const size of WIDTHS) {
  test.describe(`${size.name} ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('traveller pages', async ({ page }, info) => {
      await signIn(page, 'TRAVELLER');
      for (const route of TRAVELLER_PAGES(ids.traveller())) {
        await page.goto(route.path);
        await expect(page.locator('main')).toBeVisible();
        await expectNoSidewaysScroll(page);
        await checkAccessibility(page, info);
        await keepScreenshot(page, info, `${route.name}-${size.width}.png`);
      }
    });

    test('agency pages', async ({ page }, info) => {
      await signIn(page, 'AGENCY_ADMIN');
      for (const route of AGENCY_PAGES(ids.agencyOrg())) {
        await page.goto(route.path);
        await expect(page.locator('main')).toBeVisible();
        await expectNoSidewaysScroll(page);
        await checkAccessibility(page, info);
        await keepScreenshot(page, info, `${route.name}-${size.width}.png`);
      }
    });
  });
}

test.describe('keyboard', () => {
  test('the first stop is a way past the menu, and focus stays visible down the page', async ({
    page,
  }) => {
    await signIn(page, 'TRAVELLER');
    await page.goto(`/app/applicant/${ids.traveller()}/documents`);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to Content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await checkKeyboard(page, 12);
  });
});

test.describe('the Cases anchor link', () => {
  test('an old link that only names the case opens that case', async ({ page }) => {
    const caseId = ids.case();
    await signIn(page, 'AGENCY_ADMIN');
    await page.goto(`/app/agency/${ids.agencyOrg()}/cases#mission-${caseId}`);
    await expect(page).toHaveURL(new RegExp(`[?&]case=${caseId}`));
    await expect(page.locator(`#mission-${caseId}`)).toBeVisible();
  });
});

test.describe('pages that are not there', () => {
  test("a missing page uses the app's own page, tells search engines to stay away and offers a way back", async ({
    page,
  }, info) => {
    await signIn(page, 'TRAVELLER');
    const answer = await page.goto('/app/this-page-does-not-exist');
    // Next may start sending the frame before it knows the page is missing.
    expect([200, 404]).toContain(answer?.status());
    await expect(page.getByRole('heading', { name: S.notFoundHeading })).toBeVisible();
    await expect(page.locator('meta[name="robots"]').last()).toHaveAttribute('content', /noindex/);
    await expect(
      page
        .getByRole('link')
        .filter({ hasText: /home|back|start/i })
        .first(),
    ).toBeVisible();
    await checkAccessibility(page, info);
  });

  test('a record that belongs to nobody looks the same as one the person may not open', async ({
    page,
  }) => {
    await signIn(page, 'TRAVELLER');
    await page.goto(`/app/applicant/${NOBODY}/documents`);
    await expect(page.getByRole('heading', { name: S.notFoundHeading })).toBeVisible();
  });
});
