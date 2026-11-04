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

  test('documents: the list stays in budget, and the chosen document is a full screen on a phone and a side sheet that scrolls inside on a desktop', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'documents', count: 60 });
    // Not found by its landmark role: on a phone it becomes a dialog while it is open.
    const sheet = page.locator('#wallet-selected-document');
    // A phone that arrives on a named document (a reminder's link, which is what this page
    // passes) opens it straight away as a full screen that scrolls inside, with one way back.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(sheet).toBeVisible();
    const open = await sheet.evaluate((element) => ({
      position: getComputedStyle(element).position,
      overflowY: getComputedStyle(element).overflowY,
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    }));
    expect(open).toEqual({ position: 'fixed', overflowY: 'auto', width: 390, height: 844 });
    // The last action in the screen can still be reached from the keyboard.
    const last = sheet.getByRole('link', { name: 'Review Sharing Permissions' });
    await last.focus();
    await expect(last).toBeInViewport();
    await noSeriousAxe(page);
    await sheet.getByRole('button', { name: 'Back to Documents' }).click();
    await expect(sheet).toBeHidden();
    for (const viewport of ['phone', 'desktop'] as const) {
      // Enforced on both screens since lane Z of the resource lifecycle programme: the shared
      // list shows 6 rows a page on a phone and 12 on a desktop (WALLET_PAGE_SIZE in
      // components/document-wallet-browser.tsx), with every document still reached through the
      // pages. On a phone the chosen document is not on the page at all until a row is tapped
      // (UX17), so the list is all the page holds.
      await expectWithinBudget(page, { screens: 3, viewport, mode: MODE });
    }
    // A desktop keeps the chosen document in a side sheet that scrolls inside (it is open on a
    // larger screen whatever the address says).
    const facts = await sheet.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrolls: element.scrollHeight > element.clientHeight,
      height: element.getBoundingClientRect().height,
    }));
    expect(facts.overflowY).toBe('auto');
    expect(facts.scrolls).toBe(true);
    expect(facts.height).toBeLessThanOrEqual(800);
    // A tap on a row opens it again on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(sheet).toBeHidden();
    await page.locator('.wallet-document-select').first().click();
    await expect(sheet).toBeVisible();
  });
});
