import { expect, test } from '@playwright/test';
import { renderFixture } from './scroll-budget/support';

/**
 * One type scale for the signed-in workspace (Owner, 5 Nov 2026: font, text and asset sizes were
 * inconsistent between the sidebar, the toolbar and the pages). The real sidebar, toolbar and case
 * workspace are drawn with made-up data, and every piece of visible text must use one of the sizes
 * of the scale: 12 labels, 14 controls and navigation, 16 body, 18 card titles, 24 the next step,
 * 28 or 32 the page title. The brand name is a logotype, drawn at 23.
 */

const SCALE = new Set([12, 14, 16, 18, 24, 28, 32]);
const LOGOTYPE = 23;

interface Seen {
  readonly size: number;
  readonly text: string;
  readonly area: 'sidebar' | 'toolbar' | 'page';
  readonly cls: string;
}

async function seen(page: import('@playwright/test').Page): Promise<Seen[]> {
  return page.evaluate(() => {
    const found: Seen[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (text && el && el.getClientRects().length > 0 && !el.closest('.sr-only')) {
        const area = el.closest('.app-shell-nav')
          ? 'sidebar'
          : el.closest('.workspace-toolbar')
            ? 'toolbar'
            : 'page';
        found.push({
          size: Number.parseFloat(getComputedStyle(el).fontSize),
          text: text.slice(0, 30),
          area,
          cls: String(el.className).split(' ')[0] ?? '',
        });
      }
      node = walker.nextNode();
    }
    return found;
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const) {
  test.describe(`type scale on ${viewport.name}`, () => {
    test('every size is on the scale', async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await renderFixture(page, 'type-audit', {}, { standInServerActions: true });
      const all = await seen(page);
      expect(all.length).toBeGreaterThan(40);
      const off = all.filter((s) => !SCALE.has(s.size) && s.size !== LOGOTYPE);
      expect(
        off.map((s) => `${s.size}px ${s.area} .${s.cls} "${s.text}"`),
        'text drawn off the scale',
      ).toEqual([]);
    });
  });
}

test('on a wide screen the sidebar, the toolbar and the page speak at the same size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await renderFixture(page, 'type-audit', {}, { standInServerActions: true });
  const all = await seen(page);
  const navLabels = all.filter((s) => s.cls === 'app-link-label');
  expect(navLabels.length).toBeGreaterThan(5);
  const buttons = all.filter((s) => s.cls === 'btn' && s.area === 'page');
  expect(buttons.length).toBeGreaterThan(2);
  // Navigation and buttons are the same kind of thing: both read at 14.
  expect(new Set(navLabels.map((s) => s.size))).toEqual(new Set([14]));
  expect(new Set(buttons.map((s) => s.size))).toEqual(new Set([14]));
  // A card's title is larger than the rows under it, and rows are larger than their notes.
  const title = all.find((s) => s.cls === 'lift-card-title');
  const row = all.find((s) => s.cls === 'row-key');
  const note = all.find((s) => s.cls === 'muted' && s.text.startsWith('Add this'));
  expect(title?.size).toBe(18);
  expect(row?.size).toBe(16);
  expect(note?.size).toBe(14);
  // Icons follow their text: 18 beside the 14 px navigation.
  const iconSizes = await page.evaluate(() =>
    [...document.querySelectorAll('.app-shell-links a .icon')]
      .map((i) => Math.round(i.getBoundingClientRect().width))
      .filter((width) => width > 0),
  );
  expect(iconSizes.length).toBeGreaterThan(5);
  expect(new Set(iconSizes)).toEqual(new Set([18]));
});
