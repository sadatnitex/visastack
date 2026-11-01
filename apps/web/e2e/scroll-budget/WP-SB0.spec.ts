import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  PANEL_MAX_PX,
  VIEWPORTS,
  expectFixedPanel,
  expectWithinBudget,
  renderFixture,
} from './support';

/**
 * WP-SB0: the shared scroll budget parts with worst-case data, and proof that the guard itself
 * fails on a page that breaks its budget. Budgets here are in report mode (support.ts); the
 * behaviour checks (focus, landing anchor, bar never covering a field) always apply.
 */

const FIXTURE = 'scroll-budget-sb0';

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

test.describe('scroll budget guard', () => {
  test('fails a page that is taller than its budget, in enforce mode only', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'padded', padding: 3 * 844 });
    const reported = await expectWithinBudget(page, {
      screens: 2,
      viewport: 'phone',
      mode: 'report',
    });
    expect(reported.height).toBeGreaterThan(2 * VIEWPORTS.phone.height);
    await expect(
      expectWithinBudget(page, { screens: 2, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
    await expect(
      expectWithinBudget(page, { screens: 4, viewport: 'phone', mode: 'enforce' }),
    ).resolves.toMatchObject({ viewport: 'phone', sideways: 0 });
  });

  test('fails a page that scrolls sideways', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'padded', padding: 10 });
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.style.width = '2000px';
      wide.style.height = '1px';
      document.querySelector('main')?.append(wide);
    });
    await expect(
      expectWithinBudget(page, { screens: 2, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/sideways scroll at phone/);
  });

  test('fails a log whose box has lost its fixed height', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'log', count: 200 });
    const panel = page.locator('.activity-log-scroll');
    await page.addStyleTag({ content: '.activity-log-scroll { max-height: none !important; }' });
    await expect(expectFixedPanel(panel, { viewport: 'desktop', mode: 'enforce' })).rejects.toThrow(
      /panel height/,
    );
  });
});

test.describe('WP-SB0 parts with worst-case data', () => {
  test('a 500-entry log keeps its fixed box and stays within one screen and a half', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'log', count: 500 });
    const panel = page.getByRole('region', { name: 'Access Log Entries' });
    for (const viewport of ['phone', 'desktop'] as const) {
      const { height, scrolls } = await expectFixedPanel(panel, { viewport });
      // The box is real in every mode: it scrolls inside and never grows past the plan's height.
      expect(scrolls).toBe(true);
      expect(height).toBeLessThanOrEqual(PANEL_MAX_PX[viewport] + 0.5);
      await expectWithinBudget(page, { screens: 2, viewport });
    }
    await expect(page.getByRole('link', { name: 'Show Older Entries' })).toHaveAttribute(
      'href',
      '/app/x?before=eyJ2IjoxfQ#access-log',
    );
    await expect(page.locator('.activity-log-summary output')).toContainText(
      '1500 entries in all.',
    );
    await noSeriousAxe(page);
  });

  test('Show More keeps filters, lands on the first new row and is announced politely', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'show-more', count: 200 });
    const link = page.getByRole('link', { name: 'Show More cases' });
    await expect(link).toHaveAttribute('href', '/app/x?status=open&show=20#case-row-10');
    await expect(page.getByRole('status')).toHaveText('Showing 10 of 200 cases.');
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 2, viewport });
    }
    await noSeriousAxe(page);
  });

  test('the sticky bar stays in reach and never covers the last field', async ({ page }) => {
    // The site scrolls smoothly unless reduced motion is asked for; ask, so each position read
    // after a focus or scroll is the final one.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await renderFixture(page, FIXTURE, { view: 'sticky', count: 30 });
    await page.setViewportSize(VIEWPORTS.phone);
    const bar = page.getByRole('group', { name: 'Save This Form' });
    /** How far the field's bottom edge reaches past the top of the bar (0 or less is clear). */
    const overlap = (selector: string) => async () => {
      const field = await page.locator(selector).boundingBox();
      const barBox = await bar.boundingBox();
      return (field?.y ?? 0) + (field?.height ?? 0) - (barBox?.y ?? 0);
    };
    // Mid-form: the bar is pinned to the bottom of the screen.
    await page.locator('#field-10').scrollIntoViewIfNeeded();
    const pinned = await bar.boundingBox();
    expect(pinned).not.toBeNull();
    expect(Math.round((pinned?.y ?? 0) + (pinned?.height ?? 0))).toBeLessThanOrEqual(
      VIEWPORTS.phone.height,
    );
    expect(pinned?.y ?? 0).toBeGreaterThan(VIEWPORTS.phone.height / 2);
    // Keyboard to the last field: it is fully above the bar.
    await page.locator('#field-29').focus();
    await expect.poll(overlap('#field-29')).toBeLessThanOrEqual(0);
    // Tabbing down the form from the top: every field the keyboard reaches is above the bar,
    // with the note making the bar as tall as it gets on a phone.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#field-0').focus();
    for (let n = 1; n < 30; n += 1) {
      await page.keyboard.press('Tab');
      await expect(page.locator(`#field-${n}`)).toBeFocused();
      await expect.poll(overlap(`#field-${n}`), { message: `field ${n}` }).toBeLessThanOrEqual(0);
    }
    // At the very end the bar sits after the last field, in the flow.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(overlap('#field-29')).toBeLessThanOrEqual(0);
    await expectWithinBudget(page, { screens: 3, viewport: 'phone' });
    await noSeriousAxe(page);
  });

  test('collapsible groups open the first group only and fit the budget', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'groups', count: 8 });
    const open = await page
      .locator('details.collapsible-group')
      .evaluateAll((all) => all.map((d) => (d as HTMLDetailsElement).open));
    expect(open).toEqual([true, false, false, false, false, false]);
    const second = page.locator('#docs-group-1 > summary');
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#docs-group-1')).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport });
    }
    await noSeriousAxe(page);
  });
});
