import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';
import type { JourneyScreensProps } from '../fixtures/journey-screens.fixture';
import { renderFixture } from '../scroll-budget/support';

/** The five widths every journey screen is checked at (a phone, a tablet, then three desktops). */
export const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'small laptop', width: 1024, height: 768 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'wide desktop', width: 1440, height: 900 },
] as const;

/** Mounts one of the four journey screens with its server work replaced by stand-ins. */
export async function openScreen(page: Page, view: JourneyScreensProps['view']): Promise<void> {
  await renderFixture(page, 'journey-screens', { view }, { standInServerActions: true });
}

/** WCAG 2.2 AA (and the A and 2.1 rules it builds on) for the screen's main region. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** The page never scrolls sideways (WCAG 1.4.10 reflow at 320 CSS pixels and above). */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, 'sideways scroll in pixels').toBeLessThanOrEqual(0);
}

export interface TabStop {
  /** What a screen reader would call the control: its label, else its words. */
  readonly name: string;
  /** Whether the browser drew a visible focus mark on it. */
  readonly marked: boolean;
}

/**
 * Presses Tab `count` times from the top of the page and reports each stop. A positive tabindex
 * would reorder this list away from the reading order, which is what the callers compare against.
 */
export async function tabStops(page: Page, count: number): Promise<TabStop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: TabStop[] = [];
  for (let n = 0; n < count; n += 1) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { name: '(none)', marked: false };
        const labelled = el.getAttribute('aria-label');
        const viaLabel = (el as HTMLInputElement).labels?.[0]?.textContent;
        const name = (labelled ?? viaLabel ?? el.textContent ?? el.tagName)
          .trim()
          .replace(/\s+/g, ' ');
        const style = getComputedStyle(el);
        const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
        const ring = style.boxShadow !== 'none';
        return { name, marked: outline || ring };
      }),
    );
  }
  return stops;
}

/** Every visible button and field is at least 44 CSS pixels tall (the product's touch target). */
export async function expectTouchTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() => {
    const seen: string[] = [];
    const targets = document.querySelectorAll<HTMLElement>(
      'main button, main select, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main a.btn',
    );
    for (const el of targets) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.height < 43.5) {
        seen.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? el.id).trim()}" ${Math.round(box.height)}px`,
        );
      }
    }
    return seen;
  });
  expect(small, 'controls shorter than 44px').toEqual([]);
}
