import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { type Page, type TestInfo, expect } from '@playwright/test';

export { WIDTHS } from '../../journey-screens/support';

/**
 * Keeps a piece of evidence in the run's output folder and attaches it by path. Playwright copies
 * only attachments that have a path, and the workflow uploads that folder; a `body` attachment
 * lives in the report alone, which the workflow deletes. Never pass a sign-in page or anything
 * that holds a credential, a cookie or a person's real details.
 */
export async function keepEvidence(
  info: TestInfo,
  name: string,
  body: string | Buffer,
  contentType: string,
): Promise<void> {
  const path = info.outputPath(name);
  await writeFile(path, body);
  await info.attach(name, { path, contentType });
}

/** A full-page picture of a signed-in page of a synthetic account, kept as evidence. */
export async function keepScreenshot(page: Page, info: TestInfo, name: string): Promise<void> {
  await keepEvidence(info, name, await page.screenshot({ fullPage: true }), 'image/png');
}

/** Words that would turn a readiness figure into a promise. A disclaimer sentence is removed first. */
const PROBABILITY =
  /(approval|success|acceptance)\s+(probability|chance|odds|rate|score)|chance of (approval|success)|likely to be (approved|accepted)|%\s*(likely|chance)/i;

/** The words a case page may use to say it does NOT promise an outcome. */
const DISCLAIMER = /[^.]*\bnot (an? )?(approval|visa)[^.]*\./gi;

/** Fails when the text promises or scores an outcome. */
export function expectNoApprovalPromise(text: string): void {
  const stripped = text.replace(DISCLAIMER, ' ');
  expect(stripped, 'page text promises or scores an approval').not.toMatch(PROBABILITY);
}

/** The page text with the sign-in and shell chrome left in (a check on what a person can read). */
export async function pageText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

/**
 * WCAG 2.2 AA for the actual page. Critical and serious findings fail; anything lighter is
 * attached to the test as evidence rather than failing a staging run on a moving design.
 */
export async function checkAccessibility(page: Page, info: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  const lighter = results.violations.filter((v) => !blocking.includes(v));
  if (lighter.length > 0) {
    await keepEvidence(
      info,
      `axe-lighter-findings-${info.attachments.length + 1}.json`,
      JSON.stringify(
        lighter.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        null,
        2,
      ),
      'application/json',
    );
  }
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, 'sideways scroll in pixels').toBeLessThanOrEqual(0);
}

/**
 * Presses Tab through the page and checks that focus always lands on something visible with a
 * visible mark, never leaves the document, and that the page has one main region.
 */
export async function checkKeyboard(page: Page, stops = 12): Promise<void> {
  await expect(page.locator('main')).toHaveCount(1);
  const problems = await (async () => {
    const found: string[] = [];
    for (let n = 0; n < stops; n += 1) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { name: '(body)', visible: false, marked: false };
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const inView =
          box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
        return {
          name: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40),
          visible: box.width > 0 && box.height > 0 && inView,
          marked:
            (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
            style.boxShadow !== 'none',
        };
      });
      // The first stop after the last control may wrap to the browser's own bar: ignore the body.
      if (state.name === '(body)') continue;
      if (!state.visible) found.push(`stop ${n + 1} "${state.name}" is not on screen`);
      if (!state.marked) found.push(`stop ${n + 1} "${state.name}" has no focus mark`);
    }
    return found;
  })();
  expect(problems).toEqual([]);
}
