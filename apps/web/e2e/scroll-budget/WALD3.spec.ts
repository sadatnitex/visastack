import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from './support';

/**
 * WALD3 the case status panel at every depth: a journey line a person can read at Glance (the
 * stage named, the Now line, the step bar), the full track at Browse and Everything, and no part
 * of the panel spilling its card or the page sideways from 320 to 1280 wide, even with a 120
 * character case title that has no spaces.
 */

const WIDTHS = [320, 360, 390, 768, 1024, 1280] as const;
const DEPTHS = ['glance', 'browse', 'everything'] as const;
const KINDS = ['traveller', 'agency'] as const;

async function open(
  page: Page,
  managed: (typeof KINDS)[number],
  depth: (typeof DEPTHS)[number],
  width: number,
  longTitle = false,
): Promise<void> {
  await renderFixture(page, 'WALD3', { managed, depth, longTitle }, { standInServerActions: true });
  await page.locator('.lift-status').waitFor();
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Every visible part of the panel that sticks out of the card, with how far. */
async function spills(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const card = document.querySelector('.lift-status');
    if (!card) return ['no status panel'];
    const box = card.getBoundingClientRect();
    const out: string[] = [];
    for (const el of card.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.clipPath !== 'none' || style.position === 'absolute') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const over = Math.max(r.right - box.right, box.left - r.left);
      if (over > 0.5) {
        out.push(
          `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} +${Math.round(over)}px`,
        );
      }
    }
    return out;
  });
}

test.describe('WALD3 journey line at Glance', () => {
  const now = '.lift-status .lift-steps-now:visible';
  for (const managed of KINDS) {
    test(`${managed}-managed case names its stage at Glance`, async ({ page }) => {
      await open(page, managed, 'glance', 390);
      await expect(page.locator(now)).toHaveCount(1);
      await expect(page.locator(now)).toHaveText('Now: In Review');
      await expect(page.locator('.lift-status .lift-strip-part-current:visible')).toHaveCount(1);
      // Glance keeps the compact line only: the picture track with every stage is Browse and up.
      await expect(page.locator('.lift-status .journey-track')).toBeHidden();
    });

    for (const depth of ['browse', 'everything'] as const) {
      // A traveller-managed case keeps its full track at Everything (an existing rule), so at
      // Browse it shows the compact line; an agency-managed case shows the full track from Browse.
      const full = managed === 'agency' || depth === 'everything';
      test(`${managed}-managed case at ${depth}: ${full ? 'full track' : 'compact line'}`, async ({
        page,
      }) => {
        await open(page, managed, depth, 1024);
        await expect(page.locator(now)).toHaveCount(1);
        if (full) {
          await expect(page.locator('.lift-status .journey-track')).toBeVisible();
          await expect(page.locator('.lift-status .journey-stage')).toHaveCount(7);
        } else {
          await expect(page.locator('.lift-status .journey-track')).toBeHidden();
        }
      });
    }
  }
});

test.describe('WALD3 compact line parts never overlap', () => {
  for (const managed of KINDS) {
    for (const width of [320, 390, 400, 768, 1280] as const) {
      test(`${managed} at ${width}: Now, position and strip each have their own place`, async ({
        page,
      }) => {
        // Traveller-managed shows the compact line at Browse as well; Glance shows it for both.
        await open(page, managed, 'glance', width);
        const boxes = await page.evaluate(() =>
          [...document.querySelectorAll('.lift-status-glance:not([hidden]) > *')]
            .filter((el) => getComputedStyle(el).display !== 'none')
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                name: el.className.split(' ')[0],
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
              };
            }),
        );
        expect(boxes.map((b) => b.name)).toEqual([
          'lift-steps-now',
          'lift-steps-position',
          'lift-steps-strip',
        ]);
        for (const [i, a] of boxes.entries()) {
          for (const b of boxes.slice(i + 1)) {
            const apart =
              a.right <= b.left + 0.5 ||
              b.right <= a.left + 0.5 ||
              a.bottom <= b.top + 0.5 ||
              b.bottom <= a.top + 0.5;
            expect(apart, `${a.name} and ${b.name} overlap`).toBe(true);
          }
        }
        const [now, , strip] = boxes;
        expect(now?.bottom ?? 0).toBeLessThanOrEqual((strip?.top ?? 0) + 0.5);
        // Every part sits inside the card: no implicit extra column pushes one out.
        const card = await page.locator('.lift-status').boundingBox();
        for (const b of boxes)
          expect(b.right).toBeLessThanOrEqual((card?.x ?? 0) + (card?.width ?? 0) + 0.5);
      });
    }
  }
});

test.describe('WALD3 nothing spills', () => {
  for (const managed of KINDS) {
    for (const depth of DEPTHS) {
      for (const width of WIDTHS) {
        test(`${managed} ${depth} at ${width}`, async ({ page }) => {
          await open(page, managed, depth, width, true);
          expect(await spills(page)).toEqual([]);
          const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(sideways).toBeLessThanOrEqual(0);
          // The long case title wraps in the Next Step; it is never cut off.
          const title = page.locator('.lift-next-title');
          const clipped = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
          expect(clipped).toBeLessThanOrEqual(0);
        });
      }
    }
  }
});

test.describe('WALD3 stage list opened', () => {
  for (const managed of KINDS) {
    for (const width of [320, 768, 1024, 1280] as const) {
      test(`${managed} About Stages open at ${width}`, async ({ page }) => {
        await open(page, managed, 'everything', width, true);
        await page.locator('.lift-status-stages .lift-help > summary').click();
        await expect(page.locator('.lift-status-stages .lift-step').first()).toBeVisible();
        expect(await spills(page)).toEqual([]);
      });
    }
  }
});

test.describe('WALD3 touch targets and wording', () => {
  test('buttons and links in the panel are at least 44px tall at a phone width', async ({
    page,
  }) => {
    await open(page, 'agency', 'everything', 390);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.lift-status a.btn, .lift-status summary')]
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => ({
          t: (el.textContent ?? '').trim().slice(0, 30),
          h: el.getBoundingClientRect().height,
        }))
        .filter((x) => x.h > 0 && x.h < 43.5),
    );
    expect(small).toEqual([]);
  });
});
