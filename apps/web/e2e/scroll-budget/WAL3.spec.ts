import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { GUARD_SIZES, runLayoutGuards } from '../support/layout-guards';
import { renderFixture } from './support';

/**
 * WAL3 Trip Package as a journey line with gaps: the stones, the gap rows, the four Outside
 * VisaStack pictures and the Trip Date Checks section, at the three guard sizes, with a long list
 * that must scroll inside its own card and never move the page.
 */

type Depth = 'glance' | 'browse' | 'everything';

async function open(page: Page, stones: number, depth: Depth = 'browse'): Promise<void> {
  await renderFixture(page, 'WAL3', { stones, depth }, { standInServerActions: true });
  await page.locator('.trip-journey').waitFor();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

test.describe('WAL3 journey line', () => {
  test('layout guards hold at 390, 400 and 1280 with a short and a long line', async ({ page }) => {
    for (const stones of [4, 8]) {
      await runLayoutGuards(page, () => open(page, stones));
    }
  });

  test('at most five stones are in view on a phone and the rest scroll inside the card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 8);
    const m = await page.evaluate(() => {
      const list = document.querySelector('.trip-journey-list') as HTMLElement;
      const card = document.querySelector('.trip-journey') as HTMLElement;
      const box = list.getBoundingClientRect();
      const inView = [...list.children].filter((li) => {
        const r = li.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1;
      }).length;
      return {
        inView,
        scrolls: list.scrollWidth > list.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        insideCard: list.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5,
      };
    });
    expect(m.inView).toBeLessThanOrEqual(5);
    expect(m.scrolls).toBe(true);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    expect(m.insideCard).toBe(true);
  });

  test('stones differ by ring style and icon as well as colour', async ({ page }) => {
    await open(page, 4);
    const rings = await page.$$eval('.trip-stone', (els) =>
      els.map((el) => ({
        kind: el.getAttribute('data-stone'),
        border: getComputedStyle(el.querySelector('.trip-stone-ring') as Element).borderTopStyle,
        icon: el.querySelectorAll('.trip-stone-ring svg').length,
      })),
    );
    expect(rings.find((r) => r.kind === 'ready')?.border).toBe('solid');
    expect(rings.find((r) => r.kind === 'gap')?.border).toBe('dashed');
    expect(rings.every((r) => r.icon === 1)).toBe(true);
  });

  test('the line shows at Glance, Browse and Everything', async ({ page }) => {
    for (const depth of ['glance', 'browse', 'everything'] as const) {
      await open(page, 4, depth);
      await expect(page.locator('.trip-journey')).toBeVisible();
    }
  });

  test('each gap has one line and one 44 px button, and many gaps scroll inside the card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 8);
    const area = await page.evaluate(() => {
      const list = document.querySelector('.trip-gaps') as HTMLElement;
      return {
        scrolls: list.scrollHeight > list.clientHeight,
        height: list.clientHeight,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(area.scrolls).toBe(true);
    expect(area.height).toBeLessThanOrEqual(130);
    expect(area.pageOverflow).toBeLessThanOrEqual(0);
    await open(page, 4);
    const gaps = page.locator('.trip-gap');
    await expect(gaps).toHaveCount(3);
    for (const gap of await gaps.all()) {
      const buttons = gap.locator('a');
      await expect(buttons).toHaveCount(1);
      const box = await buttons.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('an Outside VisaStack picture opens its sentence on focus and Escape closes it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 4);
    const tiles = page.locator('.trip-outside-tile');
    await expect(tiles).toHaveCount(4);
    const sizes = await tiles.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    expect(new Set(sizes).size).toBe(1);
    const trigger = tiles.first().locator('button');
    await trigger.focus();
    const popup = tiles.first().locator('[role="tooltip"]');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Fill in and send the official application form yourself.');
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
  });

  test('Trip Date Checks is a section: open here because a check needs a look, one row on a phone and the card on a wide screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 4);
    const row = page.locator('.rail-section .expandable-section-details > summary');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Trip Date Checks');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(row).toBeHidden();
    await expect(page.locator('#trip-checks .lift-card')).toBeVisible();
  });

  test('reduced motion leaves nothing moving', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 4);
    const moving = await page.$$eval(
      '.trip-journey *, .trip-outside *',
      (els) => els.filter((el) => getComputedStyle(el).animationName !== 'none').length,
    );
    expect(moving).toBe(0);
  });

  test('passes the automated accessibility rules', async ({ page }) => {
    for (const size of GUARD_SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page, 8);
      const results = await new AxeBuilder({ page })
        .include('.container')
        .disableRules(['region'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    }
  });
});
