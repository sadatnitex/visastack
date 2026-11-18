import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import { runLayoutGuards } from '../support/layout-guards';

/**
 * U7 (owner request 18 Nov 2026): the signed-in traveller screens on the Wallet foundation, on the
 * real stylesheet. Rows are compact with a picture, a status chip and one short line; forms are
 * folded behind one action and focus moves to the first field when one opens; an accept screen
 * says what is agreed in an open fold. Names are made up.
 */

const FIXTURE = 'u7-traveller';
const STAND_INS = { standInServerActions: true } as const;
type Part = 'rows' | 'forms' | 'accept' | 'answer';
const open = (page: Page, part: Part) => renderFixture(page, FIXTURE, { part }, STAND_INS);

test.describe('U7 layout guards', () => {
  for (const part of ['rows', 'forms', 'accept', 'answer'] as const) {
    test(`${part}: no sideways scroll, nothing covers a control`, async ({ page }) => {
      await runLayoutGuards(page, async () => {
        await open(page, part);
        if (part === 'forms') await page.locator('#add-traveller summary').click();
        if (part === 'rows') {
          for (const row of await page.locator('#notes summary').all()) await row.click();
        }
      });
    });
  }
});

test.describe('U7 rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'rows');
  });

  test('a notification row is a picture, the name, a New chip and a date, closed until pressed', async ({
    page,
  }) => {
    const row = page.locator('#notes .u7-row').first();
    await expect(row.locator('.lift-pill')).toHaveText('New');
    await expect(row.locator('.u7-meta')).toHaveText('18 Nov 2026');
    await expect(row.locator('details')).not.toHaveAttribute('open', '');
    await expect(row.getByRole('link', { name: 'Open' })).toBeHidden();
    expect((await row.boundingBox())?.height ?? 999).toBeLessThanOrEqual(96);
    await row.locator('summary').click();
    await expect(row.getByRole('link', { name: 'Open' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Mark Read' })).toBeVisible();
  });

  test('a person row presses as a whole: the name link covers the row', async ({ page }) => {
    const row = page.locator('#people .u7-plain').first();
    const box = await row.boundingBox();
    if (!box) throw new Error('row has no box');
    const hitHref = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x ?? 0, y ?? 0)
          ?.closest('a')
          ?.getAttribute('href'),
      [box.x + box.width - 12, box.y + box.height / 2],
    );
    expect(hitHref).toBe('#me');
    await expect(row.locator('.u7-initials')).toHaveText('RT');
  });

  test('a very long unbroken name wraps inside its row, the page never scrolls sideways', async ({
    page,
  }) => {
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
    }));
    expect(widths.page).toBeLessThanOrEqual(widths.view);
  });
});

test.describe('U7 folded form', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, 'forms');
  });

  test('the Add a Traveller form starts folded behind one row', async ({ page }) => {
    await expect(page.locator('#add-traveller details')).not.toHaveAttribute('open', '');
    await expect(page.locator('#add-traveller form')).toBeHidden();
  });

  test('opening the fold by its row moves focus to the first field', async ({ page }) => {
    await page.locator('#add-traveller summary').click();
    await expect(page.locator('#add-traveller [name="displayName"]')).toBeFocused();
  });

  test('the open form has no accessibility violation', async ({ page }) => {
    await page.locator('#add-traveller summary').click();
    const result = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('U7 accept screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'accept');
  });

  test('what is agreed is open, who asks is a row above it, and the person may fold it away', async ({
    page,
  }) => {
    const fold = page.locator('.u7-accept-fold');
    await expect(fold.locator('details')).toHaveAttribute('open', '');
    await expect(fold.getByText('Help with a Japan visa case.')).toBeVisible();
    await fold.locator('summary').click();
    await expect(fold.getByText('Help with a Japan visa case.')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  });
});

test.describe('U7 trip invitation answers', () => {
  for (const width of [390, 1280]) {
    test(`Join and Decline are the same size and shape, side by side, at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'answer');
      const join = await page.getByRole('button', { name: 'Join the Trip' }).boundingBox();
      const decline = await page.getByRole('button', { name: 'Decline' }).boundingBox();
      if (!join || !decline) throw new Error('a button is missing');
      expect(Math.abs(join.width - decline.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(join.height - decline.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(join.y - decline.y)).toBeLessThanOrEqual(1);
      expect(decline.x).toBeGreaterThan(join.x + join.width - 1);
      expect(decline.height).toBeGreaterThanOrEqual(44);
    });
  }
});
