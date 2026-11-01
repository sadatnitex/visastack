import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectFixedPanel, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB5: the agency Cases, Activity, Clients and Dashboard pages at their row caps with
 * worst-case data (200 cases, 300 notes, 400 invitations and 300 requests). The Cases budget
 * (3 screens with 200 cases) and the Activity log panel are the plan's acceptance and are
 * enforced; Clients (both sizes) and the Dashboard table (phone) are over budget and reported,
 * the Dashboard table enforces on a desktop (docs/uiux/SCROLL-BUDGET.md). The page tests prove the
 * real pages apply these caps and read data for the one open case only.
 */

const FIXTURE = 'WP-SB5';

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

test.describe('WP-SB5 scroll budget', () => {
  test('cases with 200 cases lists 15 and stays within 3 screens', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'cases', total: 200, shown: 15 });
    await expect(page.locator('.agency-case-list-row')).toHaveCount(15);
    await expect(page.getByText('Showing 15 of 200 cases.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show More cases' })).toHaveAttribute(
      'href',
      '/app/agency/o1/cases?before=next-page#agency-case-list',
    );
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
  });

  test('case activity keeps 50 notes in the fixed log panel with filters', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'activity', total: 300, shown: 50 });
    const panel = page.getByRole('region', { name: 'Case Activity Entries' });
    await expect(panel.locator('li')).toHaveCount(50);
    await expect(page.getByRole('link', { name: 'Show Older Entries' })).toBeVisible();
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
      const { scrolls } = await expectFixedPanel(panel, { viewport, mode: 'enforce' });
      expect(scrolls).toBe(true);
    }
    await noSeriousAxe(page);
  });

  test('clients lists 15 invitations and 15 requests, forms closed', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'clients', total: 400, shown: 15 });
    await expect(page.locator('#client-invitation-list .row')).toHaveCount(15);
    await expect(page.locator('#agency-evidence-request-list .row')).toHaveCount(15);
    await expect(page.locator('details#invite-client')).not.toHaveAttribute('open', '');
    for (const viewport of ['phone', 'desktop'] as const) {
      // Over budget (phone 4.22, desktop 3.64 screens, WP-SB10): reported, not enforced, until
      // the two 15-row lists are settled. Recorded in docs/uiux/SCROLL-BUDGET.md.
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'report' });
    }
    await noSeriousAxe(page);
  });

  test('the dashboard table shows the 10 most urgent cases, then Show More', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'dashboard', total: 200, shown: 10 });
    await expect(page.locator('#agency-case-table-rows tr')).toHaveCount(10);
    await expect(page.getByRole('link', { name: 'View All Cases' })).toBeVisible();
    for (const viewport of ['phone', 'desktop'] as const) {
      // Over budget on a phone (3.1 screens, WP-SB10): reported, not enforced, until the table
      // above the list is settled. Recorded in docs/uiux/SCROLL-BUDGET.md; desktop enforces.
      await expectWithinBudget(page, {
        screens: 3,
        viewport,
        ...(viewport === 'phone' ? { mode: 'report' as const } : {}),
      });
    }
    await noSeriousAxe(page);
  });

  test('the cases budget fails when the list cap is lost', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'cases', total: 200, shown: 200 });
    await expect(
      expectWithinBudget(page, { screens: 3, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });
});
