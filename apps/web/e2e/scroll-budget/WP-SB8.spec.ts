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
    await expect(page.locator('#land-hero-title')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.c1-cta .c1-pill').first()).toBeInViewport({ ratio: 1 });
    await expectWithinBudget(page, { screens: 6, viewport: 'phone', mode: 'enforce' });
    // Desktop holds the same number of screens (enforced since WP-SB10).
    await expectWithinBudget(page, { screens: 6, viewport: 'desktop' });
  });

  test('opening every story group still leaves no sideways scroll, and the closed page breaks without the groups', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto('/');
    await page.evaluate(() => {
      for (const group of document.querySelectorAll('details.land-group')) {
        group.setAttribute('open', '');
      }
    });
    // Everything open is what the page was before WP-SB8: over budget, which proves the check bites.
    await expect(
      expectWithinBudget(page, { screens: 6, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
  });

  test('the menu links open their group, and a closed group opens from the keyboard', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    // A full load into a group's address opens it.
    await page.goto('/#for-agencies');
    await expect(page.locator('#for-agencies')).toHaveAttribute('open', '');
    await expect(page.getByText('Stop Chasing Documents by Message')).toBeInViewport();
    // The site menu moves within the page; its link still opens the group it names.
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    await page.getByRole('link', { name: 'How It Works', exact: true }).click();
    await expect(page.locator('#how-it-works')).toHaveAttribute('open', '');
    await expect(page.getByText('Add Your Details Once')).toBeInViewport();
    // The keyboard opens any other group; groups open independently.
    const summary = page.locator('#problem > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#problem')).toHaveAttribute('open', '');
    await expect(page.getByText('Without One Profile')).toBeVisible();
    await expect(page.locator('#capabilities')).not.toHaveAttribute('open', '');
    await noSeriousAxe(page, '.land-story');
  });

  test('on a phone the product cards sit in one row that scrolls inside itself', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto('/');
    const row = page.locator('.c1-bento');
    const facts = await row.evaluate((element) => ({
      display: getComputedStyle(element).display,
      scrolls: element.scrollWidth > element.clientWidth,
      tops: [...element.children].map((child) => Math.round(child.getBoundingClientRect().top)),
    }));
    expect(facts.display).toBe('flex');
    expect(facts.scrolls).toBe(true);
    expect(new Set(facts.tops).size).toBe(1);
    await row.focus();
    await expect(row).toBeFocused();
    await noSeriousAxe(page, '#product');
    // On a desktop the reference grid stays, and the row is no longer a keyboard stop.
    await page.setViewportSize(VIEWPORTS.desktop);
    expect(await row.evaluate((element) => getComputedStyle(element).display)).toBe('grid');
    await expect(row).not.toHaveAttribute('tabindex', /.*/);
  });
});

test.describe('WP-SB8 trust page', () => {
  test('fits 6 screens on a phone and a desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    const response = await page.goto('/trust');
    expect(response?.status()).toBeLessThan(500);
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
