import { type Page, expect, test } from '@playwright/test';

/**
 * MOT1 (owner decisions, 18 Nov 2026, ADR 0029 amendment): phones, short windows and zoomed windows
 * get light "reveal" motion instead of still pictures. The Home page was the only page with scroll
 * scenes; the approved homepage (LAND1, 26 Nov 2026) is a still page, so the checks that played its
 * five scenes (phone reveal, gentle reduced motion, data saver, resize) were retired with them. What
 * stays are the checks that belong to other public pages: the plain tiles on How It Works and the
 * Privacy and Trust page's layout stability while its hero plays.
 */

const html = (page: Page) => page.locator('html');

/** Waits for the page to paint two frames, so the observers have seen the new scroll position. */
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

/** Scrolls 0.7 of a screen at a time to the bottom, one painted frame after each jump. */
async function scrollThrough(page: Page): Promise<void> {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => window.innerHeight * 0.7);
  for (let y = 0; y < total; y += step) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await frames(page);
  }
}

test.describe('phone, 390 x 844, motion welcome', () => {
  test('plain meaning tiles on How It Works stay plain finished content, nothing to press', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/how-it-works');
    await expect(html(page)).toHaveAttribute('data-scenes', 'reveal');
    await expect(page.locator('.hk-flip-grid button')).toHaveCount(0);
    const tiles = page.locator('.hk-flip-static');
    expect(await tiles.count()).toBeGreaterThan(0);
    await expect(tiles.first()).toBeVisible();
  });
});

for (const [width, height] of [
  [390, 844],
  [1280, 800],
] as const)
  test(`the Privacy and Trust page shifts nothing while its hero plays (CLS under 0.05) at ${width} x ${height}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{
          value: number;
          hadRecentInput: boolean;
        }>)
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.setViewportSize({ width, height });
    await page.goto('/trust');
    // The Pause button is in the markup from the start, idle; it becomes usable once the page is alive.
    const pause = page.getByRole('button', { name: 'Pause the Animation' });
    await expect(pause).toBeVisible();
    // The loop moves on by itself (a step change, never a fixed time).
    await expect(page.locator('.tr-share-live .kit-sheet')).not.toHaveAttribute(
      'data-kit-step',
      '0',
      {
        timeout: 6000,
      },
    );
    await scrollThrough(page);
    await frames(page);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.05);
  });
