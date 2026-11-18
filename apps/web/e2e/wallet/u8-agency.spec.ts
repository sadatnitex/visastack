import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import { runLayoutGuards } from '../support/layout-guards';

/**
 * U8 (owner request 18 Nov 2026): the agency screens on the Wallet foundation, on the real
 * stylesheet. The open case's Add Task, Schedule and Add Note forms are folded behind one
 * action each, the Time Zone list keeps the height of every other control (it used to render
 * about 240 px tall), and team and limit rows are compact with a picture. Names are made up.
 */

const FIXTURE = 'u8-agency';
const STAND_INS = { standInServerActions: true } as const;

const open = (page: Page, props: { part?: 'case' | 'rows' | 'traveller' } = {}) =>
  renderFixture(page, FIXTURE, props, STAND_INS);
const fold = (page: Page, title: string) =>
  page.locator('.u8-fold').filter({ has: page.getByRole('heading', { name: title }) });

test.describe('U8 layout guards', () => {
  for (const folds of [false, true]) {
    test(`case forms ${folds ? 'open' : 'folded'}: no sideways scroll, nothing covers a control`, async ({
      page,
    }) => {
      await runLayoutGuards(page, async () => {
        await open(page);
        if (folds) {
          for (const title of ['Add Task', 'Schedule', 'Add Note']) {
            await fold(page, title).locator('summary').click();
          }
        }
      });
    });
  }
  test('team and limit rows: no sideways scroll, nothing covers a control', async ({ page }) => {
    await runLayoutGuards(page, async () => {
      await open(page, { part: 'rows' });
    });
  });
});

test.describe('U8 open case', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
  });

  test('the Task, Appointment and Note forms start folded behind Add Task, Schedule and Add Note', async ({
    page,
  }) => {
    for (const title of ['Add Task', 'Schedule', 'Add Note']) {
      const one = fold(page, title);
      await expect(one).toHaveCount(1);
      await expect(one.locator('details')).not.toHaveAttribute('open', '');
      await expect(one.locator('form')).toBeHidden();
    }
    await expect(page.getByLabel('Task Description')).toBeHidden();
    await fold(page, 'Schedule').locator('summary').click();
    await expect(page.getByLabel('Appointment Title')).toBeVisible();
    await expect(fold(page, 'Add Task').locator('form')).toBeHidden();
  });

  test('opening a fold by its row moves focus to its first field', async ({ page }) => {
    for (const [title, field] of [
      ['Add Task', 'description'],
      ['Schedule', 'title'],
      ['Add Note', 'body'],
    ] as const) {
      await fold(page, title).locator('summary').click();
      await expect(fold(page, title).locator(`[name="${field}"]`)).toBeFocused();
    }
  });

  test('the Time Zone list is as tall as the Time box beside it, never a 240 px empty box', async ({
    page,
  }) => {
    await fold(page, 'Schedule').locator('summary').click();
    const zone = page.locator('select[name="timezone"]');
    const time = page.locator('input[name="localTime"]');
    await expect(zone).toBeVisible();
    const zoneBox = await zone.boundingBox();
    const timeBox = await time.boundingBox();
    expect(zoneBox?.height ?? 999).toBeLessThanOrEqual(64);
    expect(Math.abs((zoneBox?.height ?? 0) - (timeBox?.height ?? 0))).toBeLessThanOrEqual(4);
  });

  test('a folded form has no accessibility violation open or closed', async ({ page }) => {
    await fold(page, 'Add Note').locator('summary').click();
    const result = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('U8 Time Zone on the traveller case page', () => {
  test('the list is as tall as the Time box beside it there too', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, { part: 'traveller' });
    const zone = page.locator('select[name="timezone"]');
    await expect(zone).toBeVisible();
    const box = await zone.boundingBox();
    expect(box?.height ?? 999).toBeLessThanOrEqual(64);
  });
});

test.describe('U8 rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, { part: 'rows' });
  });

  test('a team row is a picture, the name, one role chip and its line; details sit in the body', async ({
    page,
  }) => {
    const row = page.locator('#team-members .u8-row').first();
    await expect(row.locator('.u8-initials')).toHaveText('OE');
    await expect(row.locator('.lift-pill')).toHaveText('Case Manager');
    await expect(row.locator('details')).not.toHaveAttribute('open', '');
    const box = await row.boundingBox();
    expect(box?.height ?? 999).toBeLessThanOrEqual(96);
  });

  test('a limit with no ceiling shows its count and the shared words (unlimited), with no bar or arc', async ({
    page,
  }) => {
    const rows = page.locator('#plan-limits .u8-limit');
    await expect(rows.nth(1)).toContainText('1 used (unlimited)');
    await expect(rows.nth(1).locator('.u8-ring-arc')).toHaveCount(0);
    await expect(rows.nth(1).locator('.lift-meter, .meter')).toHaveCount(0);
    await expect(rows.nth(0)).toContainText('4 of 5 used');
    await expect(rows.nth(0).locator('.u8-ring-arc')).toHaveCount(1);
  });
});
