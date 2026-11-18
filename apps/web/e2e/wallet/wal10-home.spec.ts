import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import { runLayoutGuards } from '../support/layout-guards';

/**
 * WAL10: Home's People photo and Needs Attention rows, the real components on the real
 * stylesheet. Layout guards at 390, 400 and 1280, 44 px targets, the photo and its fallback,
 * reduced motion, accessibility, and the rows with script switched off (the details element is
 * the browser's own).
 */

const FIXTURE = 'wal10-home';
const open = (page: Page, photo: 'good' | 'broken' | 'none' = 'good') =>
  renderFixture(page, FIXTURE, { photo });
const rows = (page: Page) => page.locator('.home-attention-row');

test.describe('WAL10 layout guards', () => {
  test('no sideways scroll and nothing covers a control, closed and with every row open', async ({
    page,
  }) => {
    await runLayoutGuards(page, async () => {
      await open(page);
    });
    await runLayoutGuards(page, async () => {
      await open(page);
      for (const summary of await rows(page).locator('summary').all()) await summary.click();
    });
  });
});

test.describe('WAL10 People photo', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the own card shows the photo as a decorative picture, the other keeps initials', async ({
    page,
  }) => {
    await open(page);
    const cards = page.locator('.home-person');
    const img = cards.nth(0).locator('img');
    await expect(img).toHaveAttribute('alt', '');
    await expect(cards.nth(1).locator('img')).toHaveCount(0);
    await expect(cards.nth(1).locator('.home-avatar')).toHaveText('SR');
    const box = await cards.nth(0).locator('.home-avatar').boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(56);
    expect(Math.round(box?.height ?? 0)).toBe(56);
  });

  test('a photo that cannot load falls back to the initials', async ({ page }) => {
    await open(page, 'broken');
    await expect(page.locator('.home-person').nth(0).locator('.home-avatar')).toHaveText('NS');
    await expect(page.locator('.home-person').nth(0).locator('img')).toHaveCount(0);
  });

  test('without a photo the initials show', async ({ page }) => {
    await open(page, 'none');
    await expect(page.locator('.home-person').nth(0).locator('.home-avatar')).toHaveText('NS');
  });
});

test.describe('WAL10 Needs Attention rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
  });

  test('every item is one row with a picture, title, urgency word and one action', async ({
    page,
  }) => {
    await expect(rows(page)).toHaveCount(6);
    for (const row of await rows(page).all()) {
      await expect(row.locator('.expandable-section-picture')).toBeVisible();
      await expect(row.locator('h3')).toBeVisible();
      await expect(row.locator('.do-next-tier')).toBeVisible();
      await expect(row.locator('a.do-next-link')).toHaveCount(1);
      const box = await row.locator('a.do-next-link').boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(rows(page).nth(1).locator('a.do-next-link')).toContainText('Send a Replacement');
  });

  test('the long sentence is inside the row and opens with a tap', async ({ page }) => {
    const row = rows(page).nth(4);
    const why = row.locator('.home-attention-why');
    await expect(why).toBeHidden();
    await row.locator('summary').click();
    await expect(why).toContainText('Nothing is added to the profile until you approve it.');
  });

  test('the rows are plain details elements, closed, present without script', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    // renderFixture needs script, so read the rendered markup from a scripted page first.
    const scripted = await browser.newPage();
    await open(scripted);
    const html = await scripted.locator('#wal10-root').evaluate((el) => el.outerHTML);
    await scripted.close();
    await page.setContent(`<div>${html}</div>`);
    await expect(page.locator('.home-attention-row')).toHaveCount(6);
    await expect(page.locator('.home-attention-row details').first()).toHaveJSProperty(
      'open',
      false,
    );
    await context.close();
  });

  test('the keyboard opens a row: Enter on its summary shows the sentence', async ({ page }) => {
    const row = rows(page).nth(4);
    await row.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(row.locator('.home-attention-why')).toBeVisible();
  });

  test('the due date shows without opening a row', async ({ page }) => {
    await expect(rows(page).nth(0).locator('.home-attention-when')).toBeVisible();
  });

  test('reduced motion: the row chevron does not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await rows(page)
      .first()
      .locator('.expandable-section-chevron')
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(['0s', '']).toContain(duration);
  });

  test('has no accessibility violations', async ({ page }) => {
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });
});
