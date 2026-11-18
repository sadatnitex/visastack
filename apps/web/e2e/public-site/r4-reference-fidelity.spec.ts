import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * R4: the public Countries page against the owner-approved reference (the "public site, one
 * continuous story" mock, Countries page). Four chapters in order: a dark hero "Every Country. /
 * With Its Sources." with a search that types "Singapore" by itself and a ribbon of flags; the real
 * country list; a light "Rules, Not Guesses." chapter beside the checklist panel; a closing band
 * "Pick a Country. See the Gap." with the passport. Each chapter is checked, then photographed at a
 * computer size and a phone size so it can be set beside the reference. Set R4_SHOTS_DIR to keep the
 * pictures (default: the test output folder); set R4_REFERENCE_HTML to a saved copy of the reference
 * to also photograph its Countries page next to ours.
 */

const SIZES = [
  { tag: 'd', width: 1440, height: 900 },
  { tag: 'm', width: 390, height: 844 },
] as const;

const env = (name: string): string | undefined => process.env[name];

const hero = (page: Page) => page.locator('section.r4-hero');
const ribbon = (page: Page) => page.locator('.r4-ribbon');
const list = (page: Page) => page.locator('section.r4-list-chapter');
const rules = (page: Page) => page.locator('section:has(h2#countries-rules-title)');
const closing = (page: Page) =>
  page.locator('section.pub-chapter-dark:has(h2:has-text("Pick a Country."))');

async function shot(locator: Locator, name: string, tag: string): Promise<void> {
  const dir = env('R4_SHOTS_DIR');
  await locator.scrollIntoViewIfNeeded();
  const path = dir ? `${dir}/${name}-${tag}.png` : test.info().outputPath(`${name}-${tag}.png`);
  await locator.screenshot({ path });
}

async function topOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
}

for (const size of SIZES) {
  test.describe(`R4 Countries at ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('chapter order, removed parts and no sideways scroll', async ({ page }) => {
      await page.goto('/countries');
      const tops = [
        await topOf(hero(page)),
        await topOf(ribbon(page)),
        await topOf(list(page)),
        await topOf(rules(page)),
        await topOf(closing(page)),
      ];
      expect([...tops].sort((a, b) => a - b)).toEqual(tops);
      await expect(page.getByText('How to Read These Facts')).toHaveCount(0);
      await expect(page.locator('.pub-flag-ring')).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('chapter 1: dark hero, headline, real search, ribbon', async ({ page }) => {
      await page.goto('/countries');
      await expect(hero(page)).toHaveAttribute('data-tone', 'dark');
      await expect(page.locator('main h1')).toHaveText(/Every Country\.\s*With Its Sources\./);
      await expect(page.getByRole('searchbox', { name: 'Search Countries' })).toBeVisible();
      await expect(ribbon(page).locator('.r4-ribbon-view')).toHaveAttribute('aria-hidden', 'true');
      await expect(ribbon(page).getByRole('link', { name: 'All Countries' })).toBeVisible();
      await shot(hero(page), 'ch1-hero', size.tag);
      await shot(ribbon(page), 'ch1-ribbon', size.tag);
    });

    test('chapter 1: the search types Singapore by itself, then a person can type', async ({
      page,
    }) => {
      await page.goto('/countries');
      const input = page.getByRole('searchbox', { name: 'Search Countries' });
      // The demo starts after the page is live: the field fills letter by letter.
      await expect(input).toHaveValue(/^S[a-z]*$/, { timeout: 5000 });
      await expect(input).toHaveValue('Singapore', { timeout: 8000 });
      await expect(page.locator('.r4-results')).toContainText('Singapore');
      // A real person takes over at the first focus: the demo stops and never fights their typing.
      await input.click();
      await expect(input).toHaveValue('');
      await input.pressSequentially('Germa');
      await page.waitForTimeout(900);
      await expect(input).toHaveValue('Germa');
      await expect(page.locator('.r4-results')).toContainText('Germany');
      await expect(page.locator('.r4-search output')).toHaveText('1 country found.');
    });

    test('chapter 1: reduced motion shows the search filled and still, the ribbon still', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/countries');
      const input = page.getByRole('searchbox', { name: 'Search Countries' });
      await expect(input).toHaveValue('Singapore');
      await page.waitForTimeout(700);
      await expect(input).toHaveValue('Singapore');
      await expect(page.locator('.r4-results')).toContainText('Singapore');
      const name = await page
        .locator('.r4-ribbon-track')
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toBe('none');
    });

    test('chapter 1: the ribbon moves, and stops under a pointer', async ({ page }) => {
      await page.goto('/countries');
      const track = page.locator('.r4-ribbon-track');
      if (size.tag === 'm') {
        // On a phone the band shows a short row; it still drifts and still pauses.
        await expect(track).toBeAttached();
      }
      const state = () => track.evaluate((el) => getComputedStyle(el).animationPlayState);
      expect(await state()).toBe('running');
      await ribbon(page).hover();
      expect(await state()).toBe('paused');
    });

    test('chapter 2: the real list keeps 12 rows, Show More, sources and warnings', async ({
      page,
    }) => {
      await page.goto('/countries');
      await expect(list(page)).toHaveAttribute('data-tone', 'light');
      await expect(page.locator('[data-country-row]')).toHaveCount(12);
      await expect(page.locator('#countries-more')).toContainText(/Showing 12 of \d+ countries\./);
      await expect(page.getByText('Needs checking before you rely on it.').first()).toBeVisible();
      await expect(page.getByText(/Checked On \d/).first()).toBeVisible();
      await expect(page.getByText(/^Source: /).first()).toBeVisible();
      const list2 = list(page);
      await list2.scrollIntoViewIfNeeded();
      const box = await list2.boundingBox();
      const dir = env('R4_SHOTS_DIR');
      const path = dir
        ? `${dir}/ch2-list-${size.tag}.png`
        : test.info().outputPath(`ch2-list-${size.tag}.png`);
      if (box) {
        await page.screenshot({
          path,
          fullPage: true,
          clip: {
            x: 0,
            y: box.y + (await page.evaluate(() => window.scrollY)),
            width: size.width,
            height: Math.min(box.height, 1400),
          },
        });
      }
    });

    test('chapter 3: Rules, Not Guesses beside the checklist panel', async ({ page }) => {
      await page.goto('/countries');
      await expect(rules(page)).toHaveAttribute('data-tone', 'light');
      await expect(rules(page).locator('h2')).toHaveText(/Rules,\s*Not Guesses\./);
      await expect(rules(page).getByText('Reused').first()).toBeVisible();
      await expect(rules(page).getByText('To add').first()).toBeVisible();
      await expect(rules(page)).toContainText('5 of 8 Ready');
      await expect(rules(page)).toContainText('Example');
      await expect(rules(page)).toContainText('Completeness only. Not an approval.');
      await shot(rules(page), 'ch3-rules', size.tag);
    });

    test('chapter 4: closing band with the passport and the buttons', async ({ page }) => {
      await page.goto('/countries');
      await expect(closing(page)).toHaveAttribute('data-tone', 'dark');
      await expect(closing(page).locator('h2')).toHaveText(/Pick a Country\.\s*See the Gap\./);
      await expect(closing(page).locator('img').first()).toBeVisible();
      await expect(closing(page).getByRole('link', { name: 'For Agencies' })).toBeVisible();
      for (const link of await closing(page).locator('a.pub-button').all()) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await shot(closing(page), 'ch4-closing', size.tag);
    });
  });
}

test('no script: the search still works as a plain form', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/countries?q=germ');
  await expect(page.getByRole('searchbox', { name: 'Search Countries' })).toHaveValue('germ');
  await expect(page.locator('.r4-results')).toContainText('Germany');
  await context.close();
});

test('reference: photograph its Countries page when a saved copy is given', async ({ browser }) => {
  const reference = env('R4_REFERENCE_HTML');
  test.skip(!reference, 'no saved copy of the reference given');
  const dir = env('R4_SHOTS_DIR');
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(`file://${reference}`);
    await page.evaluate(() => {
      (document.querySelector('[data-go="countries"]') as HTMLElement | null)?.click();
      // Let the frame grow to its content, so one picture holds the whole page.
      const frame = document.getElementById('zf');
      if (frame) frame.setAttribute('style', 'height:auto;max-height:none;overflow:visible');
    });
    await page.waitForTimeout(600);
    const path = dir
      ? `${dir}/reference-${size.tag}.png`
      : test.info().outputPath(`reference-${size.tag}.png`);
    await page.locator('#zf').screenshot({ path });
    await context.close();
  }
});
