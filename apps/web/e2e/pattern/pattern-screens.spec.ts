import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { VIEWPORTS, renderFixture } from '../scroll-budget/support';

/**
 * The one list pattern in a browser (case page plan, section 10), at a phone (390) and a desktop
 * (1440): rows of equal height, every action a full target, nothing scrolls sideways, a row opens
 * its panel, Esc and Back close it and focus returns to the row, a link that names an item opens
 * it, and the page passes the serious accessibility rules. These are fixture renders of the real
 * kit and stylesheet, not live signed-in acceptance. With PATTERN_SHOTS=1 the screens are also saved
 * under docs/uiux/evidence/pattern as review artifacts.
 */

const FIXTURE = 'pattern-list';
const WIDTHS = { phone: 390, desktop: 1440 } as const;
const SHOTS = resolve(__dirname, '../../../../docs/uiux/evidence/pattern');

async function open(page: Page, view: 'phone' | 'desktop', props: Record<string, unknown> = {}) {
  await page.setViewportSize({
    width: WIDTHS[view],
    height: view === 'phone' ? VIEWPORTS.phone.height : VIEWPORTS.desktop.height,
  });
  // The page allows scripts only for the fixture bundle; the kit's own click handling runs in it.
  await renderFixture(page, FIXTURE, props);
  // The folders start folded; open them so every row is on screen to measure.
  await page.evaluate(() => {
    for (const fold of document.querySelectorAll<HTMLDetailsElement>('details')) fold.open = true;
  });
}

/** A variable-keyed read keeps the strict index-signature rules happy. */
const readEnv = (name: string): string | undefined => process.env[name];

async function shot(page: Page, name: string) {
  if (readEnv('PATTERN_SHOTS') !== '1') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: false });
}

for (const view of ['phone', 'desktop'] as const) {
  test.describe(`the list pattern at a ${view}`, () => {
    test('every row is one height, at least 56px, with full targets and no sideways scroll', async ({
      page,
    }) => {
      await open(page, view);
      const measured = await page.evaluate(() => {
        const rows = [
          ...document.querySelectorAll<HTMLElement>('[data-pattern="list-row"]'),
        ].filter((row) => row.getClientRects().length > 0);
        const heights = rows.map((row) => Math.round(row.getBoundingClientRect().height));
        const actions = [...document.querySelectorAll<HTMLElement>('.lift-check-action')]
          .filter((a) => a.getClientRects().length > 0)
          .map((a) => Math.round(a.getBoundingClientRect().height));
        const names = [...document.querySelectorAll<HTMLElement>('.lp-row-open')]
          .filter((a) => a.getClientRects().length > 0)
          .map((a) => Math.round(a.getBoundingClientRect().height));
        const root = document.documentElement;
        return { heights, actions, names, sideways: root.scrollWidth - root.clientWidth };
      });
      expect(measured.heights.length).toBeGreaterThan(10);
      expect(Math.min(...measured.heights)).toBeGreaterThanOrEqual(56);
      // Rows with the same parts are the same height: the long name is cut, never wrapped.
      const withoutAction = measured.heights.slice(-5);
      expect(Math.max(...withoutAction) - Math.min(...withoutAction)).toBeLessThanOrEqual(2);
      expect(Math.min(...measured.actions)).toBeGreaterThanOrEqual(44);
      expect(Math.min(...measured.names)).toBeGreaterThanOrEqual(44);
      expect(measured.sideways).toBe(0);
      await shot(page, `case-${view}`);
    });

    test('a row opens its panel; Esc closes it and focus returns to the row', async ({ page }) => {
      await open(page, view);
      const link = page.locator('a[data-pane-open="item-2"]');
      await link.click();
      const pane = page.locator('#lp-pane-item-2');
      await expect(pane).toBeVisible();
      await expect(pane.locator('h3')).toHaveText('Document number 2');
      expect(new URL(page.url()).searchParams.get('item')).toBe('item-2');
      await expect(link).toHaveAttribute('aria-current', 'true');
      if (view === 'phone') {
        // A full screen of its own with one way back.
        await expect(page.locator('.lp-pane')).toHaveAttribute('role', 'dialog');
        const box = await page.locator('.lp-pane').boundingBox();
        expect(box?.width).toBe(WIDTHS.phone);
        expect(box?.height).toBe(VIEWPORTS.phone.height);
      } else {
        // The rest of the side column steps aside while the panel is open.
        await expect(page.locator('.split-rail')).toBeHidden();
      }
      await shot(page, `case-item-${view}`);
      await page.keyboard.press('Escape');
      await expect(pane).toBeHidden();
      expect(new URL(page.url()).searchParams.get('item')).toBeNull();
      await expect(link).toBeFocused();
      if (view === 'desktop') await expect(page.locator('.split-rail')).toBeVisible();
    });

    test("the browser's Back closes the panel, and the Back button does too", async ({ page }) => {
      await open(page, view);
      await page.locator('a[data-pane-open="item-3"]').click();
      await expect(page.locator('#lp-pane-item-3')).toBeVisible();
      await page.goBack();
      await expect(page.locator('#lp-pane-item-3')).toBeHidden();
      await page.locator('a[data-pane-open="item-3"]').click();
      await expect(page.locator('#lp-pane-item-3')).toBeVisible();
      await page.getByRole('link', { name: 'Back to the Checklist' }).click();
      await expect(page.locator('#lp-pane-item-3')).toBeHidden();
    });

    test('a link that names an item opens its panel at once', async ({ page }) => {
      await open(page, view, { initial: 'item-5' });
      await expect(page.locator('#lp-pane-item-5')).toBeVisible();
      await expect(page.locator('#lp-pane-item-4')).toBeHidden();
    });

    test('passes the serious accessibility rules, closed and open', async ({ page }) => {
      await open(page, view);
      const check = async () => {
        const results = await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        const blocking = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious',
        );
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      };
      await check();
      await page.locator('a[data-pane-open="item-1"]').click();
      await check();
    });
  });
}
