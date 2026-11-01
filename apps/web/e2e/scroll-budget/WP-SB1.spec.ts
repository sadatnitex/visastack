import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PANEL_MAX_PX, expectFixedPanel, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB1 traveller records and logs, measured with worst-case data and enforced: Profile History
 * and Case History fit three phone screens with 500 saved versions and 40 long cases; consent
 * history and notifications sit in a fixed panel that scrolls inside.
 */

const FIXTURE = 'scroll-budget-sb1';
const VIEWPORTS = ['phone', 'desktop'] as const;

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

async function fixedPanel(panel: import('@playwright/test').Locator): Promise<void> {
  for (const viewport of VIEWPORTS) {
    const { height, scrolls } = await expectFixedPanel(panel, { viewport, mode: 'enforce' });
    expect(scrolls).toBe(true);
    expect(height).toBeLessThanOrEqual(PANEL_MAX_PX[viewport] + 0.5);
  }
}

test.describe('WP-SB1 traveller records within the scroll budget', () => {
  test('Profile History: one fixed log of 50 versions, filters, and older entries on request', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'history' });
    await fixedPanel(page.getByRole('region', { name: 'Profile History Entries' }));
    for (const viewport of VIEWPORTS) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    for (const label of ['Part of the Profile', 'Search', 'What Happened', 'Who', 'When']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Show Older Entries' })).toHaveAttribute(
      'href',
      '/app/applicant/person/history?before=eyJ2IjoxfQ#profile-history-log',
    );
    await expect(page.locator('.activity-log-summary output')).toContainText(
      '500 saved versions in all.',
    );
    await noSeriousAxe(page);
  });

  test('Case History: the latest case open, the rest closed, records in a fixed panel', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'memory' });
    const open = await page
      .locator('details.collapsible-group')
      .evaluateAll((all) => all.map((d) => (d as HTMLDetailsElement).open));
    expect(open).toEqual([true, ...Array(9).fill(false)]);
    await fixedPanel(page.getByRole('region', { name: 'Records of Made-up Case 1' }));
    for (const viewport of VIEWPORTS) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await expect(page.getByRole('status')).toHaveText('Showing 10 of 40 cases.');
    await expect(page.getByRole('link', { name: 'Show More cases' })).toHaveAttribute(
      'href',
      '/app/applicant/person/memory?show=20#memory-case-11',
    );
    // Opening a closed case keeps its records in the same fixed panel.
    await page.locator('#memory-case-2 > summary').click();
    await fixedPanel(page.getByRole('region', { name: 'Records of Made-up Case 2' }));
    await noSeriousAxe(page);
  });

  test('consent history sits in a fixed panel with filters', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'consent' });
    await fixedPanel(page.getByRole('region', { name: 'Consent History Entries' }));
    for (const viewport of VIEWPORTS) {
      await expectWithinBudget(page, { screens: 2, viewport, mode: 'enforce' });
    }
    await expect(page.getByLabel('Result', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show Older Entries' })).toBeVisible();
    await noSeriousAxe(page);
  });

  test('notifications: ten in a fixed panel, Mark All Read, then Show More', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'notifications' });
    await fixedPanel(page.getByRole('region', { name: 'Notification List' }));
    for (const viewport of VIEWPORTS) {
      await expectWithinBudget(page, { screens: 2, viewport, mode: 'enforce' });
    }
    await expect(page.getByRole('button', { name: 'Mark All Read' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show More notifications' })).toHaveAttribute(
      'href',
      '/app/notifications?show=20#notification-11',
    );
    await noSeriousAxe(page);
  });
});
