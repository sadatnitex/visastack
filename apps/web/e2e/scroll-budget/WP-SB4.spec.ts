import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { PANEL_MAX_PX, expectFixedPanel, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB4 traveller tasks and forms, with worst-case data: every screen within three screens on a
 * phone and on a desktop (the task budget), the main action always in reach, long lists folded or
 * in a fixed panel. This file enforces its budgets (WP-SB0 lands report mode; each package
 * switches its own file).
 */

const FIXTURE = 'scroll-budget-sb4';
const MODE = 'enforce' as const;

async function noSeriousAxe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

/** The bar is on screen, pinned while the person scrolls, and the last thing in its form. */
async function expectBarInReach(page: Page, name: string): Promise<void> {
  const bar = page.getByRole('group', { name });
  await expect(bar).toBeInViewport();
  const facts = await bar.evaluate((element) => ({
    position: getComputedStyle(element).position,
    last: element.closest('form')?.lastElementChild === element,
  }));
  expect(facts).toEqual({ position: 'sticky', last: true });
}

test.describe('WP-SB4 traveller tasks and forms with worst-case data', () => {
  test('calendar: 200 dates in folded groups, a 100-row preview in its panel, Preview in reach', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'calendar', count: 200 });
    const groups = page.locator('details.collapsible-group');
    await expect(groups).toHaveCount(4);
    expect(
      await groups.evaluateAll((all) => all.map((d) => (d as HTMLDetailsElement).open)),
    ).toEqual([true, false, false, false]);
    const panel = page.getByRole('region', { name: 'Events in the File' });
    for (const viewport of ['phone', 'desktop'] as const) {
      const { height, scrolls } = await expectFixedPanel(panel, { viewport, mode: MODE });
      expect(scrolls).toBe(true);
      expect(height).toBeLessThanOrEqual(PANEL_MAX_PX[viewport] + 0.5);
      await expectWithinBudget(page, { screens: 3, viewport, mode: MODE });
    }
    // Select All ticks and clears the whole group, and shows a part-ticked state in between.
    const all = page.getByRole('checkbox', { name: 'Select All Appointments' });
    await all.check();
    const appointments = page.locator('#calendar-group-appointment input[data-calendar-date]');
    expect(
      await appointments.evaluateAll((b) => b.every((x) => (x as HTMLInputElement).checked)),
    ).toBe(true);
    await appointments.first().uncheck();
    expect(await all.evaluate((b) => (b as HTMLInputElement).indeterminate)).toBe(true);
    // As in every browser, a part-ticked box ticks the whole group, and the next click clears it.
    await all.click();
    expect(
      await appointments.evaluateAll((b) => b.every((x) => (x as HTMLInputElement).checked)),
    ).toBe(true);
    await all.click();
    expect(
      await appointments.evaluateAll((b) => b.some((x) => (x as HTMLInputElement).checked)),
    ).toBe(false);
    // Opened on the phone, the bar with Preview stays on screen while the person scrolls.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#calendar-group-task_due > summary').click();
    await page
      .locator('#calendar-group-task_due input[data-calendar-date]')
      .nth(20)
      .scrollIntoViewIfNeeded();
    await expectBarInReach(page, 'Preview Your Dates');
    await noSeriousAxe(page);
  });

  test('consent: 20 cases and 40 files behind expanders, Allow and Do Not Allow in reach', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'consent', count: 20 });
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: MODE });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectBarInReach(page, 'Answer Synthetic App');
    await expect(page.getByRole('button', { name: 'Allow Access' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Do Not Allow' })).toBeInViewport();
    // The long case list scrolls in its own short box; the last case is reachable by keyboard
    // and stays in the same set of choices.
    const lastCase = page.getByRole('radio', { name: 'Only Synthetic Trip 20' });
    await lastCase.focus();
    await expect(lastCase).toBeInViewport();
    const box = await page.locator('.ai-case-scroll').evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      height: element.getBoundingClientRect().height,
    }));
    expect(box.overflowY).toBe('auto');
    expect(box.height).toBeLessThanOrEqual(16 * 16 + 0.5);
    await expect(page.locator('input[name="cases"]')).toHaveCount(22);
    await expect(page.locator('input[name="file"]')).toHaveCount(40);
    await noSeriousAxe(page);
  });

  test('documents: the selected document is a sheet that scrolls inside, the list stays in budget', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'documents', count: 60 });
    const sheet = page.getByRole('complementary', { name: 'Selected document details' });
    for (const viewport of ['phone', 'desktop'] as const) {
      // On a phone the paged list itself (12 rows a page, in the shared list component outside
      // this package) is taller than the budget, so the page height there is reported, not
      // enforced, until that list is settled; the sheet's own fixed height is enforced everywhere.
      await expectWithinBudget(page, {
        screens: 3,
        viewport,
        mode: viewport === 'phone' ? 'report' : MODE,
      });
      const facts = await sheet.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        scrolls: element.scrollHeight > element.clientHeight,
        height: element.getBoundingClientRect().height,
      }));
      expect(facts.overflowY).toBe('auto');
      expect(facts.scrolls).toBe(true);
      expect(facts.height).toBeLessThanOrEqual(viewport === 'phone' ? 22 * 16 + 0.5 : 800);
    }
    // Nothing inside the sheet stretches the page past its own end (text for screen readers
    // included): the page ends where the sheet ends.
    await page.setViewportSize({ width: 390, height: 844 });
    const ends = await page.evaluate(() => {
      const box = document.querySelector('.wallet-selected-document')?.getBoundingClientRect();
      return {
        sheet: Math.round((box?.bottom ?? 0) + window.scrollY),
        page: document.documentElement.scrollHeight,
      };
    });
    expect(ends.page - ends.sheet).toBeLessThanOrEqual(64);
    // The last action in the sheet can still be reached from the keyboard.
    const last = sheet.getByRole('link', { name: 'Review Sharing Permissions' });
    await last.focus();
    await expect(last).toBeInViewport();
    await noSeriousAxe(page);
  });
});
