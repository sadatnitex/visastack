import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from './support';

/**
 * WAL0: on a phone nothing paints over the open document sheet, and the case page's pill strip
 * never needs a sideways scroll. The sheet is the real document browser inside the real signed-in
 * shell (bottom bar, Add button); the strip is the case page's own markup and classes.
 */

const FIXTURE = 'WAL0';
const SIZES = [
  { name: '390x844', width: 390, height: 844 },
  { name: '400x860', width: 400, height: 860 },
  { name: '360x640', width: 360, height: 640 },
  { name: '1280x800', width: 1280, height: 800 },
] as const;
const MOTION = ['reduce', 'no-preference'] as const;

/** Controls that are not hit by their own centre or corners, after scrolling each into view. */
async function coveredControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sheet = document.querySelector('aside.wallet-selected-document');
    if (!sheet) return ['no sheet'];
    const covered: string[] = [];
    const scroller = sheet as HTMLElement;
    const controls = [
      ...sheet.querySelectorAll<HTMLElement>('button, a[href], input, select, summary'),
    ];
    const last = controls.filter((c) => c.getBoundingClientRect().height > 0).at(-1);
    for (const el of controls) {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // Inside a closed fold the control is not drawn at all.
      const fold = el.closest('details:not([open])');
      if (fold && !el.closest('summary')) continue;
      // The last control must be reachable too: after scrolling the sheet to its end it has to
      // clear the bottom bar. Every other control is brought to the middle of the screen.
      if (el === last) {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        el.scrollIntoView({ block: 'center' });
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const points: [number, number][] = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + r.width * 0.2, r.top + r.height * 0.3],
        [r.right - r.width * 0.2, r.top + r.height * 0.3],
        [r.left + r.width * 0.2, r.bottom - r.height * 0.3],
        [r.right - r.width * 0.2, r.bottom - r.height * 0.3],
      ];
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit))) {
          const label = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim();
          covered.push(
            `${label.slice(0, 40)} at ${Math.round(x)},${Math.round(y)} hit ${hit?.className || hit?.tagName}`,
          );
          break;
        }
      }
    }
    return covered;
  });
}

for (const motion of MOTION) {
  for (const size of SIZES) {
    test.describe(`WAL0 sheet ${size.name} motion ${motion}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ reducedMotion: motion });
        await page.setViewportSize({ width: size.width, height: size.height });
        await renderFixture(page, FIXTURE, { view: 'sheet' }, { standInServerActions: true });
        if (size.width <= 760) {
          await page.locator('aside.wallet-selected-document[role="dialog"]').waitFor();
        }
        // The Safe Copy section is a fold: open it, as the person does, so its buttons are drawn.
        await page.locator('summary.safe-copy-title').click();
        await page.locator('.safe-copy-actions .btn').first().waitFor();
      });

      test('every control in the open sheet is the topmost thing at its centre and inner corners', async ({
        page,
      }) => {
        expect(await coveredControls(page)).toEqual([]);
      });

      test('the Add button is hidden while the document sheet is open, and back when it closes', async ({
        page,
      }) => {
        await expect(page.locator('.docs-add-fab')).toBeHidden();
        if (size.width <= 760) {
          await page.getByRole('button', { name: 'Back to Documents' }).click();
          await expect(page.locator('.docs-add-fab')).toBeVisible();
        }
      });
    });
  }
}

const STRIP_WIDTHS = [320, 360, 390, 400, 641, 650, 700, 760, 761, 768, 1280] as const;

for (const width of STRIP_WIDTHS) {
  for (const depth of ['glance', 'browse', 'everything'] as const) {
    test(`WAL0 case page ${width} ${depth}: section links, page and More menu stay inside the screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await renderFixture(page, FIXTURE, { view: 'strip', depth }, { standInServerActions: true });
      const phone = width <= 760;
      const m = await page.evaluate(() => {
        const nav = document.querySelector('nav.jump-nav') as HTMLElement;
        const segs = document.querySelector('fieldset.depth-segs') as HTMLElement | null;
        const drawn = (el: Element) => el.getBoundingClientRect().height > 0;
        const wrapped = [...nav.querySelectorAll<HTMLElement>('.jump-links a')].filter(drawn);
        const summary = nav.querySelector('summary');
        return {
          navHeight: nav.getBoundingClientRect().height,
          navScroll: nav.scrollWidth - nav.clientWidth,
          page: document.documentElement.scrollWidth,
          inner: innerWidth,
          wrappedCount: wrapped.length,
          wrappedMin: Math.min(...wrapped.map((a) => a.getBoundingClientRect().height)),
          rows: new Set(wrapped.map((a) => Math.round(a.getBoundingClientRect().top))).size,
          summaryDrawn: summary ? drawn(summary) : false,
          summaryHeight: summary ? summary.getBoundingClientRect().height : 0,
          segsOver: segs ? segs.scrollWidth - segs.clientWidth : 0,
        };
      });
      process.stdout.write(`[wal0] case ${width} ${depth} ${JSON.stringify(m)}\n`);
      expect(m.navScroll).toBeLessThanOrEqual(1);
      expect(m.page).toBeLessThanOrEqual(m.inner);
      expect(m.segsOver).toBeLessThanOrEqual(1);
      if (depth !== 'glance') {
        if (phone) {
          // One closed 44 px row, no pills drawn; opened, every link is a full-width 44 px row.
          expect(m.summaryDrawn).toBe(true);
          expect(m.summaryHeight).toBeGreaterThanOrEqual(44);
          expect(m.navHeight).toBeLessThanOrEqual(60);
          expect(m.wrappedCount).toBe(0);
          await page.locator('.jump-select > summary').click();
          const rows = await page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('.jump-select-list a')]
              .filter((a) => a.getBoundingClientRect().height > 0)
              .map((a) => {
                const r = a.getBoundingClientRect();
                return {
                  h: r.height,
                  w: r.width,
                  pos: getComputedStyle(a.parentElement as Element).position,
                };
              }),
          );
          expect(rows.length).toBeGreaterThan(1);
          for (const row of rows) {
            expect(row.h).toBeGreaterThanOrEqual(44);
            expect(row.pos).not.toBe('absolute');
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
        } else {
          // Wide: the pills wrap, nothing scrolls, the disclosure is not drawn.
          expect(m.summaryDrawn).toBe(false);
          expect(m.wrappedCount).toBeGreaterThan(1);
          expect(m.wrappedMin).toBeGreaterThanOrEqual(44);
        }
      }

      // The More menu opens fully inside the screen.
      await page.locator('.case-more-menu > summary').click();
      const box = await page.locator('.case-more-panel').boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
}
