import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectFixedPanel, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB3: sharing, insights, evidence requests and the shared view at their row caps with
 * worst-case data (40 grants and a 300-entry access log, 100 documents, 30 requests, 30 shared
 * details and documents). The sharing and insights budgets are the plan's acceptance and are
 * enforced here; evidence and the shared view are measured and reported. The page tests prove
 * the real pages apply these caps.
 */

const FIXTURE = 'WP-SB3';

async function noSeriousAxe(page: import('@playwright/test').Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test.describe('WP-SB3 scroll budget', () => {
  test('sharing with 40 grants stays within 3 screens, the log in its fixed box', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'sharing', total: 40, shown: 5 });
    await expect(page.locator('.sharing-grant')).toHaveCount(5);
    await expect(page.getByText('Showing 5 of 40 grants.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show More grants' })).toHaveAttribute(
      'href',
      '/app/applicant/a1/sharing?show=10#sharing-grant-6',
    );
    const panel = page.getByRole('region', { name: 'Access Log Entries' });
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
      const { scrolls } = await expectFixedPanel(panel, { viewport, mode: 'enforce' });
      expect(scrolls).toBe(true);
    }
    await noSeriousAxe(page);
  });

  test('insights with 100 documents stays within 3 screens', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'insights', total: 100, shown: 5 });
    await expect(page.locator('details.insights-card-fold')).toHaveCount(6);
    await expect(page.locator('details.insights-card-fold[open] .insights-row')).toHaveCount(5);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
  });

  test('evidence requests and the shared view list ten rows, then Show More', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'evidence', total: 30, shown: 10 });
    await expect(page.locator('.request-item')).toHaveCount(10);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport });
    }
    await noSeriousAxe(page);
    await renderFixture(page, FIXTURE, { view: 'shared', total: 30, shown: 10 });
    await expect(page.getByText('Showing 10 of 30 documents.')).toBeVisible();
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport });
    }
    await noSeriousAxe(page);
  });

  test('the sharing budget fails when the grant cap is lost', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'sharing', total: 40, shown: 40 });
    await expect(
      expectWithinBudget(page, { screens: 3, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });
});
