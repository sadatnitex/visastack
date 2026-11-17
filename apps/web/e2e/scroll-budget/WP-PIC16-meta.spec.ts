import { expect, test } from '@playwright/test';
import { renderFixture } from './support';

/**
 * WP-PIC16: Read This Aloud sits on the case status line. It must never push the line onto an
 * extra row, shift the line when the page wakes up, or overlap the tap targets below it. The real
 * header line is measured at 320 and 375 px, with the browser able to speak and unable to.
 */
const WIDTHS = [320, 375] as const;
const GAP_PX = 8;

const SPEECH_STUB = () => {
  class Utterance {}
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: Utterance,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak: () => undefined, cancel: () => undefined },
  });
};

async function measure(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  return page.evaluate(() => {
    const meta = document.querySelector('.page-meta') as HTMLElement;
    const next = document.querySelector('#next-row') as HTMLElement;
    const control = document.querySelector('.read-aloud-button') as HTMLElement | null;
    const slot = document.querySelector('.read-aloud-slot') as HTMLElement;
    const metaBox = meta.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    const rows = new Set(
      Array.from(meta.children).map((child) => Math.round(child.getBoundingClientRect().top)),
    );
    const root = document.documentElement;
    return {
      metaHeight: Math.round(metaBox.height),
      rows: rows.size,
      hasControl: control !== null,
      controlHeight: Math.round(control?.getBoundingClientRect().height ?? 0),
      gapBelow: Math.round(next.getBoundingClientRect().top - slotBox.bottom),
      sideways: root.scrollWidth - root.clientWidth,
    };
  });
}

test.describe('WP-PIC16 read aloud on the case status line', () => {
  for (const width of WIDTHS) {
    test(`the line keeps its rows, its height and an 8 px gap at ${width} px`, async ({ page }) => {
      // Without speech support: the slot alone.
      await page.addInitScript(() => {
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
      });
      await renderFixture(page, 'WP-PIC16-meta');
      const without = await measure(page, width);
      expect(without.hasControl).toBe(false);

      // With speech support: the control appears after the page wakes up.
      const speaking = await page.context().newPage();
      await speaking.addInitScript(SPEECH_STUB);
      await renderFixture(speaking, 'WP-PIC16-meta');
      const withControl = await measure(speaking, width);
      expect(withControl.hasControl).toBe(true);

      // Nothing shifts when the control appears, and it adds no row.
      expect(withControl.metaHeight).toBe(without.metaHeight);
      expect(withControl.rows).toBe(without.rows);
      // It is a full 44 px touch target that stays clear of the row below.
      expect(withControl.controlHeight).toBeGreaterThanOrEqual(44);
      expect(withControl.gapBelow).toBeGreaterThanOrEqual(GAP_PX);
      expect(withControl.sideways).toBeLessThanOrEqual(0);
      await speaking.close();
    });
  }
});
