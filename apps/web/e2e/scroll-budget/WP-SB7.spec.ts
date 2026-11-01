import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectFixedPanel, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB7: staff data and settings at their caps with worst-case data (500 organizations shown 25
 * at a time, 400 members shown 20, 300 active holds shown 25 in a fixed box, 12 document
 * categories as tabs, 10 AI features folded, a pack version with 140 requirements shown 25).
 * Privacy, Document Protection and AI Settings are settings pages and are held to 3 phone screens
 * here; the capped lists enforce by default since WP-SB10, their caps proven by the page tests.
 */

const FIXTURE = 'WP-SB7';

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

test.describe('WP-SB7 scroll budget', () => {
  test('privacy holds: 25 holds in a fixed box, the picker and form, within 3 screens', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'holds', shown: 25, total: 300 });
    await expect(page.getByRole('link', { name: 'Legal Holds' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('combobox', { name: 'Applicant' })).toBeVisible();
    const panel = page.getByRole('region', { name: 'Active holds' });
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
      const { scrolls } = await expectFixedPanel(panel, { viewport, mode: 'enforce' });
      expect(scrolls).toBe(true);
    }
    await noSeriousAxe(page);
  });

  test('document protection: one category tab open of 12, within 3 screens', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'protection', shown: 20, total: 12 });
    await expect(
      page.getByRole('navigation', { name: 'Document Categories' }).getByRole('link'),
    ).toHaveCount(12);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
  });

  test('AI settings: 10 features folded and grouped, within 3 screens', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'ai', shown: 10, total: 10 });
    await expect(page.locator('details.sb7-fold')).toHaveCount(10);
    await expect(page.locator('details.sb7-fold[open]')).toHaveCount(0);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
  });

  test('organizations, members and a pack list 25, 20 and 25 rows, then a next page', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'organizations', shown: 25, total: 500 });
    await expect(page.locator('#organizations-list tbody tr')).toHaveCount(25);
    await expect(page.getByRole('link', { name: 'Next Page' })).toBeVisible();
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 6, viewport });
    }
    await noSeriousAxe(page);

    await renderFixture(page, FIXTURE, { view: 'members', shown: 20, total: 400 });
    await expect(page.locator('.workspace-member-row')).toHaveCount(20);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 6, viewport });
    }
    await noSeriousAxe(page);

    await renderFixture(page, FIXTURE, { view: 'pack', shown: 25, total: 140 });
    await expect(page.getByText('Showing 25 of 140 requirements.')).toBeVisible();
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 6, viewport });
    }
    await noSeriousAxe(page);
  });

  test('the settings budget fails when far more features are listed', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'ai', shown: 60, total: 60 });
    await expect(
      expectWithinBudget(page, { screens: 3, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });
});
