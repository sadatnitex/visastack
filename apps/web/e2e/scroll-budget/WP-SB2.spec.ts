import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { VIEWPORTS, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB2: the case workspace with worst-case data (a 60-item checklist, 120 tasks, 80 notes, 60
 * complaints, 60 feedback notes, 60 snapshots) stays within its phone budget, and the same case
 * laid out the old way does not. This file enforces its budgets (plan section 5), including the
 * open snapshot since WP-SB11.
 */

const FIXTURE = 'WP-SB2';

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

test.describe('WP-SB2 case workspace', () => {
  test('a worst-case case fits 3 screens on a phone and on a desktop', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'case' });
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
  });

  test('the same case laid out without the caps breaks the budget', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'case-uncapped' });
    await expect(
      expectWithinBudget(page, { screens: 3, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });

  test('on a phone the header keeps only More and the next step stays on screen', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'case' });
    await page.setViewportSize(VIEWPORTS.phone);
    await expect(page.locator('.case-header-wide')).toBeHidden();
    await expect(page.getByText('More', { exact: true })).toBeVisible();
    const bar = page.locator('.case-sticky-next .sticky-action-bar');
    await expect(bar).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(VIEWPORTS.phone.height + 1);
    await page.setViewportSize(VIEWPORTS.desktop);
    await expect(page.locator('.case-header-wide a').first()).toBeVisible();
    await expect(bar).toBeHidden();
  });

  test('a snapshot with 130 entries opens on its first group and folds to one screen', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'snapshot' });
    await page.setViewportSize(VIEWPORTS.phone);
    const groups = page.locator('details.collapsible-group');
    await expect(groups).toHaveCount(3);
    await expect(page.locator('#snapshot-requirements')).toHaveAttribute('open', '');
    await expect(page.locator('#snapshot-facts')).not.toHaveAttribute('open', '');
    // WP-SB11: as it opens, the first group draws 8 of its 60 rows and then Show More, so the
    // open snapshot fits the phone budget too.
    await expect(page.locator('#snapshot-requirements .row')).toHaveCount(8);
    await expect(
      page.locator('#snapshot-requirements').getByText('Showing 8 of 60 requirements.'),
    ).toBeVisible();
    await expect(
      page.locator('#snapshot-requirements').getByRole('link', { name: 'Show More requirements' }),
    ).toHaveAttribute(
      'href',
      '/app/mission/synthetic-case/snapshots/synthetic-snapshot?requirements=16&open=requirements#snapshot-requirements-row-8',
    );
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 2, viewport, mode: 'enforce' });
    }
    await page.setViewportSize(VIEWPORTS.phone);
    // With its first group closed again, every part of the snapshot is one tap away.
    await page.locator('#snapshot-requirements > summary').click();
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 2, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
  });

  test('the open snapshot breaks the phone budget when its group draws every row', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'snapshot-uncapped' });
    await expect(page.locator('#snapshot-requirements .row')).toHaveCount(60);
    await expect(
      expectWithinBudget(page, { screens: 2, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });
});
