import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * WP-PUB3: How It Works and Privacy and Trust. Both pages keep the public frame (no sideways
 * scroll, 44 px targets, nothing from another site), open on a short first screen, read complete
 * with reduced motion and without script, and keep the trust list's search and Show More working
 * from the address alone.
 */

const PAGES = ['/how-it-works', '/trust'] as const;
const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640 },
  { name: '400x860', width: 400, height: 860 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
] as const;
const FIRST_SCREEN_WORDS = 30;

/** Words a visitor reads in the first screen of the page's own content (the pilot notice and the
 *  shared header are the same on every page and are counted by their own checks). */
async function firstScreenWords(page: Page): Promise<number> {
  return page.evaluate(() => {
    const limit = innerHeight;
    const words: string[] = [];
    const walker = document.createTreeWalker(
      document.querySelector('main') ?? document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.top >= limit || box.bottom <= 0) continue;
      words.push(...(node.textContent ?? '').split(/\s+/).filter(Boolean));
    }
    return words.length;
  });
}

for (const { name, width, height } of VIEWPORTS) {
  for (const route of PAGES) {
    test.describe(`${route} at ${name}`, () => {
      test.use({ viewport: { width, height } });

      test('scrolls only down, has 44 px targets and a short first screen', async ({ page }) => {
        const response = await page.goto(route);
        expect(response?.status()).toBe(200);
        await expect(page.locator('main h1')).toHaveCount(1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        ).toBe(false);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main a, main button, main input')]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && box.height < 44 - 0.5;
            })
            .map((el) => `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}`),
        );
        expect(small).toEqual([]);
        if (width === 360)
          expect(await firstScreenWords(page)).toBeLessThanOrEqual(FIRST_SCREEN_WORDS);
      });

      test('has no serious or critical accessibility problem', async ({ page }) => {
        await page.goto(route);
        const result = await new AxeBuilder({ page }).analyze();
        expect(
          result.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => v.id),
        ).toEqual([]);
      });
    });
  }
}

for (const route of PAGES) {
  test(`${route} pins each scene to one screen at 760 x 600 and every step fits`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 600 });
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-scenes', 'live');
    const stages = page.locator('.pub-scene-stage');
    const count = await stages.count();
    expect(count).toBeGreaterThan(0);
    for (let at = 0; at < count; at++) {
      const fits = await stages.nth(at).evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
      expect(fits, `stage ${at}`).toBe(true);
    }
  });

  test(`${route} with reduced motion shows every scene finished and still`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route);
    await expect(page.locator('html')).not.toHaveAttribute('data-scenes', 'live');
    const unfinished = await page.evaluate(() =>
      [...document.querySelectorAll('[data-scene]')]
        .filter(
          (el) =>
            Number(el.getAttribute('data-step')) !== Number(el.getAttribute('data-steps')) - 1,
        )
        .map((el) => el.getAttribute('data-scene')),
    );
    expect(unfinished).toEqual([]);
  });

  test(`${route} below 900 px is stills: nothing is pinned`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.locator('html')).not.toHaveAttribute('data-scenes', 'live');
    const pinned = await page.evaluate(
      () =>
        [...document.querySelectorAll('.pub-scene-stage')].filter(
          (el) => getComputedStyle(el).position === 'sticky',
        ).length,
    );
    expect(pinned).toBe(0);
  });

  test(`${route} loads nothing from another site and breaks no page rule`, async ({
    page,
    baseURL,
  }) => {
    const own = new URL(baseURL ?? 'http://localhost:3100').origin;
    const foreign: string[] = [];
    const refused: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== own) foreign.push(request.url().slice(0, 80));
    });
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to (load|execute)/i.test(message.text()))
        refused.push(message.text().slice(0, 120));
    });
    await page.goto(route);
    const images = await page.evaluate(() =>
      [...document.images].map((img) => img.currentSrc || img.src),
    );
    expect(images.filter((src) => /^(data|blob):/.test(src))).toEqual([]);
    expect(foreign).toEqual([]);
    expect(refused).toEqual([]);
  });
}

test.describe('the trust list without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('how it works reads complete and the trust list still searches and shows more', async ({
    page,
  }) => {
    await page.goto('/how-it-works');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeAttached();
    await page.goto('/trust');
    await expect(page.locator('#trust-story-title')).toBeVisible();
    await expect(page.getByText('Access Ended').first()).toBeAttached();
    // The route list needs the database. With one, search and Show More are a plain form and plain
    // links that work from the address alone; without one (the CI build) the page says so plainly.
    // The no-database build cannot show a list, so the list's own behaviour is held by the page's
    // unit tests (src/app/trust/page.test.tsx) and this check only proves the story and the notice.
    const search = page.locator('form.trust-search');
    if ((await search.count()) === 0) {
      await expect(page.getByText('Route Information Is Not Available Right Now')).toBeVisible();
      return;
    }
    await search.getByRole('searchbox').fill('zzzz-no-such-route');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\?q=zzzz-no-such-route/);
    await expect(page.getByText('No routes match your search.')).toBeVisible();
    await page.goto('/trust');
    const more = page.locator('#trust-routes-more a');
    if (await more.count()) {
      await more.first().click();
      await expect(page).toHaveURL(/show=24/);
    }
  });
});
