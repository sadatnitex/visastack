import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';

/**
 * R5: the public For Agencies page matches the owner-approved reference, chapter by chapter, at a
 * computer (1440x900) and a phone (390x844). The reference chapters were captured once from the
 * approved artifact into docs/upgrades/programme/pub/r5-shots/ref-<chapter>-<d|m>.png; this spec
 * checks the page against what those pictures and the reference text show, and
 * writes the page's own chapter pictures into the test output folder (new-<chapter>-<d|m>.png); the
 * small copies kept in the records were made from them.
 */

const SHOTS = join(__dirname, '../../../../docs/upgrades/programme/pub/r5-shots');
const SCREENS = [
  { key: 'd', width: 1440, height: 900 },
  { key: 'm', width: 390, height: 844 },
] as const;
const CHAPTERS = [
  { n: 1, name: 'hero', label: 'agencies-title', tone: 'dark' },
  { n: 2, name: 'desk', label: 'agencies-desk-title', tone: 'light' },
  { n: 3, name: 'plans', label: 'agencies-plans-title', tone: 'light' },
  { n: 4, name: 'closing', label: 'closing-band-title', tone: 'dark' },
] as const;

function chapter(page: Page, label: string) {
  return page.locator(`section.pub-chapter[aria-labelledby="${label}"]`);
}

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('the reference chapter pictures are on record', () => {
  for (const s of SCREENS)
    for (const c of CHAPTERS)
      expect(existsSync(join(SHOTS, `ref-${c.n}-${s.key}.png`)), `ref-${c.n}-${s.key}`).toBe(true);
});

for (const screen of SCREENS) {
  test.describe(`${screen.width}x${screen.height}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    test('four chapters in the reference order and tone', async ({ page }) => {
      await page.goto('/for-agencies');
      const tones = await page
        .locator('main section.pub-chapter')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-tone')));
      expect(tones).toEqual(CHAPTERS.map((c) => c.tone));
      for (const c of CHAPTERS) await expect(chapter(page, c.label)).toHaveCount(1);
    });

    test('chapter 1: the headline beside a case list of three Example rows', async ({ page }) => {
      await page.goto('/for-agencies');
      const hero = chapter(page, 'agencies-title');
      await expect(hero.locator('h1')).toHaveText(/Clients Arrive\s+Prepared\./);
      const rows = hero.locator('figure.kit-cases li.kit-case');
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) {
        const flag = row.locator('img.kit-flag');
        await expect(flag).toHaveCount(1);
        expect(
          await flag.evaluate((img) => [
            (img as HTMLElement).offsetWidth,
            (img as HTMLElement).offsetHeight,
          ]),
        ).toEqual([28, 19]);
        await expect(row.locator('svg text.kit-ring-num')).toHaveText(/^\d\/8$/);
        await expect(row.locator('.kit-case-state')).toContainText(/missing|complete/i);
      }
      await expect(hero.locator('.pub-example')).toHaveCount(1);
      await expect(hero.getByText('Completeness only. Not an approval.')).toBeVisible();
      // The ring's centre is readable on its card (contrast at least 4.5:1).
      const pair = await hero
        .locator('svg text.kit-ring-num')
        .first()
        .evaluate((el) => {
          const bg = getComputedStyle(el.closest('figure.kit-cases') as Element).backgroundColor;
          return { fg: getComputedStyle(el).fill, bg };
        });
      expect(pair.fg).toMatch(/^rgb\(/);
      expect(pair.bg).toMatch(/^rgb\(/);
      const [a, b] = [luminance(pair.fg), luminance(pair.bg)].sort((x, y) => y - x) as [
        number,
        number,
      ];
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
      // Today's buttons stay.
      await expect(hero.getByRole('link', { name: 'See What Works Today' })).toBeVisible();
    });

    test('chapter 2: three desk cards, each with a drawing', async ({ page }) => {
      await page.goto('/for-agencies');
      const desk = chapter(page, 'agencies-desk-title');
      await expect(desk.locator('h2')).toHaveText(/What Changes\s+at Your Desk\./);
      const cards = desk.locator('article');
      await expect(cards).toHaveCount(3);
      await expect(cards.locator('h3')).toHaveText([
        'One List of Cases',
        'Only What Is Shared',
        'Completeness, Not Approval',
      ]);
      for (const card of await cards.all()) {
        const box = await card
          .locator('.r5-card-picture svg, .r5-card-picture img')
          .first()
          .boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(30);
      }
    });

    test('chapter 3: Plans states only what is true today', async ({ page }) => {
      await page.goto('/for-agencies');
      const plans = chapter(page, 'agencies-plans-title');
      await expect(plans.locator('h2')).toHaveText('Plans.');
      await expect(plans).toContainText('Pricing is shown here when selling opens.');
      await expect(plans).not.toContainText(/[$£€]\s?\d|per month|starter|enterprise/i);
    });

    test("chapter 4: the closing band with the passport and today's buttons", async ({ page }) => {
      await page.goto('/for-agencies');
      const band = chapter(page, 'closing-band-title');
      await expect(band.locator('h2')).toHaveText(/Bring Your Clients\.\s+Skip the Chasing\./);
      await expect(band.getByRole('link', { name: 'See What Works Today' })).toBeVisible();
      const src = await band.locator('img').first().getAttribute('src');
      expect(src ?? '').toMatch(/passport-bd/);
    });

    test('none of the old sections come back, and no off-brand colour is used', async ({
      page,
    }) => {
      await page.goto('/for-agencies');
      const text = await page.locator('main').innerText();
      for (const old of [
        'Stop Chasing',
        'What an Agency Gets',
        'One Case, One Clear Line',
        'You See Only What Is Shared',
        'One Traveller Profile',
      ])
        expect(text).not.toContain(old);
      const css = await page.evaluate(async () => {
        const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (l) => (l as HTMLLinkElement).href,
        );
        return (await Promise.all(hrefs.map((h) => fetch(h).then((r) => r.text())))).join('\n');
      });
      const block = css.match(/\.r5-[^{]*\{[^}]*\}/g)?.join('\n') ?? '';
      expect(block.length).toBeGreaterThan(200);
      expect(block).not.toMatch(/#5ad1ff|#8ef0c9|#3c7bf0|gradient|box-shadow/i);
    });

    test('chapter pictures for the side by side', async ({ page }, testInfo) => {
      await page.goto('/for-agencies');
      for (const c of CHAPTERS) {
        const el = chapter(page, c.label);
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({ path: testInfo.outputPath(`new-${c.n}-${screen.key}.png`) });
      }
    });
  });
}
