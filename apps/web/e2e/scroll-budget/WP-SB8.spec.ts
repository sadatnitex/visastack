import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { VIEWPORTS, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB8: public pages and the country list stay within their phone budgets. The landing page and
 * the trust page are measured on the built app (plan section 5); the country list is the real
 * component with every country in the catalogue. This file enforces its budgets.
 *
 * Budgets: the landing page 6 phone screens (plan section 1, "Public landing"); the country list
 * 3 screens (a list page: 12 rows, then Show More). The trust page is held to 6 screens since
 * WP-SB10: its route list is capped at 12, the trust story above it is the shared trust component.
 */

const FIXTURE = 'WP-SB8';

async function noSeriousAxe(page: Page, include: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test.describe('WP-SB8 landing page', () => {
  test('fits 6 screens on a phone, with the headline and main action on the first screen', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto('/');
    await expect(page.locator('#lp-title')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.lp-planner .lp-primary')).toBeInViewport({ ratio: 1 });
    await expectWithinBudget(page, { screens: 6, viewport: 'phone', mode: 'enforce' });
    // Desktop: 12 screens since WP-PUB2 (owner decision, 17 Nov 2026); the approved homepage is a
    // still page of about four.
    await expectWithinBudget(page, { screens: 12, viewport: 'desktop' });
  });

  test('the page is still on a phone, with no scene and no sideways scroll', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto('/');
    await expect(page.locator('[data-scene]')).toHaveCount(0);
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
    await noSeriousAxe(page, 'main');
  });

  test('the anchors other pages link to land on their chapters', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    for (const id of ['how-it-works', 'capabilities', 'for-agencies', 'start']) {
      await page.goto('about:blank');
      await page.goto(`/#${id}`);
      await expect(page.locator(`#${id}`), id).toBeInViewport({ ratio: 0.1 });
    }
  });
});

test.describe('WP-SB8 trust page', () => {
  test('fits 6 screens on a phone and a desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    const response = await page.goto('/trust');
    // Measure the real page, never a not-found or error page that would pass trivially.
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    await expectWithinBudget(page, { screens: 6, viewport: 'phone' });
    await expectWithinBudget(page, { screens: 6, viewport: 'desktop' });
  });

  // WP-PUB3: the check above runs on a build with no database, where the route list is empty. This
  // one renders the same story and route section with 12 route cards, search and Show More, so
  // the budget holds for the page as it ships. The budget stays at 6 screens.
  test('the page with its 12 route cards fits 6 screens on a phone and a desktop', async ({
    page,
  }) => {
    await renderFixture(page, 'PUB3-trust', {});
    await expect(page.locator('.trust-catalog a.card')).toHaveCount(12);
    await expectWithinBudget(page, { screens: 6, viewport: 'phone' });
    await expectWithinBudget(page, { screens: 6, viewport: 'desktop' });
  });
});

test.describe('WP-SB8 country list', () => {
  for (const view of ['traveller', 'agency'] as const) {
    test(`the ${view} list of every country fits 3 screens on a phone and a desktop`, async ({
      page,
    }) => {
      await renderFixture(page, FIXTURE, { view });
      await expect(page.locator('.country-row')).toHaveCount(12);
      await expect(page.locator('output.country-count')).toHaveText(
        /^Showing 12 of \d+ countries\.$/,
      );
      for (const viewport of ['phone', 'desktop'] as const) {
        await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
      }
      const prefix = view === 'agency' ? '/app/agency/org-1/countries/' : '/app/countries/';
      await expect(page.locator('.country-row').first()).toHaveAttribute(
        'href',
        new RegExp(`^${prefix.replaceAll('/', '\\/')}[a-z]{2}$`),
      );
      await noSeriousAxe(page, 'main');
    });
  }

  test('Show More adds 12, moves focus to the first new country and announces the count', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'traveller' });
    await page.setViewportSize(VIEWPORTS.phone);
    const button = page.getByRole('button', { name: 'Show More countries' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.country-row')).toHaveCount(24);
    await expect(page.locator('.country-row').nth(12)).toBeFocused();
    await expect(page.locator('output.country-count')).toHaveText(
      /^Showing 24 of \d+ countries\.$/,
    );
    // The search still covers every country, not only the ones on screen.
    await page.getByLabel('Search Countries').fill('zimbabwe');
    await expect(page.locator('.country-row')).toHaveCount(1);
  });

  test('every country listed at once breaks the budget', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'uncapped' });
    await expect(
      expectWithinBudget(page, { screens: 3, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });
});

/**
 * WP-PUBFIX: the home page and the public country list stay at least 2 percent under the 6-screen
 * phone limit in English and in Bengali (the language choice is the visastack_locale cookie), so a
 * longer line or a longer language never breaks the budget. 6 screens x 0.98 = 5.88 screens.
 */
const MARGIN_SCREENS = 5.88;

for (const language of ['en', 'bn'] as const) {
  for (const path of ['/', '/countries'] as const) {
    test.describe(`WP-PUBFIX ${path} in ${language === 'bn' ? 'Bengali' : 'English'}`, () => {
      test('fits 2 percent under 6 screens on a phone', async ({ page }) => {
        if (language === 'bn') {
          // Bengali is chosen through the real header switch (on a computer, where it is always
          // visible); the choice then stays for the phone-size load below.
          await page.setViewportSize(VIEWPORTS.desktop);
          await page.goto('/');
          await page.locator('.lang-switch').click();
          await expect(page.locator('.lang-switch')).toHaveAttribute('lang', 'en');
        }
        await page.setViewportSize(VIEWPORTS.phone);
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('data-locale', language);
        await expectWithinBudget(page, { screens: MARGIN_SCREENS, viewport: 'phone' });
      });
    });
  }
}
