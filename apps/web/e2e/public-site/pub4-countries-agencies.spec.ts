import { type Page, expect, test } from '@playwright/test';

/**
 * WP-PUB4: the public Countries and For Agencies pages. One h1, first heading in main, fully inside
 * the first screen (below the banner and header, not covered) at a computer and a phone size; at most
 * 30 words of prose on the first phone screen; 44 px targets; nothing scrolls sideways; the pilot
 * notice stays; the pages work without script; reduced motion shows the finished step and stays still.
 */

const PAGES = ['/countries', '/for-agencies'] as const;
const SCREENS = [
  { name: 'computer', width: 1440, height: 900 },
  { name: 'phone', width: 360, height: 640 },
] as const;

for (const route of PAGES) {
  for (const screen of SCREENS) {
    test(`${route}: the h1 is the first heading and sits whole in the first ${screen.name} screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.goto(route);
      await expect(page.locator('main h1')).toHaveCount(1);
      const first = await page.evaluate(
        () => document.querySelector('main h1, main h2, main h3, main h4')?.tagName,
      );
      expect(first).toBe('H1');
      const result = await page.evaluate(() => {
        const h1 = document.querySelector('main h1') as HTMLElement;
        const box = h1.getBoundingClientRect();
        const header = document.querySelector('header');
        const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        const banner = document.querySelector('.pilot-banner');
        const bannerBottom = banner ? banner.getBoundingClientRect().bottom : 0;
        const probe = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          top: box.top,
          bottom: box.bottom,
          below: Math.max(headerBottom, bannerBottom),
          covered: !(probe && h1.contains(probe)),
          viewport: innerHeight,
        };
      });
      expect(result.covered, 'something covers the h1').toBe(false);
      expect(result.top).toBeGreaterThanOrEqual(result.below - 1);
      expect(result.bottom).toBeLessThanOrEqual(result.viewport);
    });
  }

  test(`${route}: at most 30 words of prose in the first phone screen`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(route);
    const words = await page.evaluate(() => {
      let count = 0;
      for (const el of document.querySelectorAll('main p, main li, main output, main figcaption')) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || box.top >= innerHeight || box.bottom <= 0)
          continue;
        if (el.closest('li') && el !== el.closest('li') && el.tagName === 'LI') continue;
        // List rows are data (names and sources), not explanatory prose.
        if (el.closest('[data-country-row], ul[aria-label]')) continue;
        count += (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
      }
      return count;
    });
    expect(words).toBeLessThanOrEqual(30);
  });

  test(`${route}: the pilot notice stays and every target is 44 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(route);
    await expect(page.locator('.pilot-banner')).toContainText(
      /VisaStack (Private Pilot|Public Beta)/,
    );
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('main a, main button')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.height < 43.5 || box.width < 43.5);
        })
        .map((el) => `${el.tagName} ${el.textContent?.trim().slice(0, 30)}`),
    );
    expect(small).toEqual([]);
  });

  for (const width of [320, 360, 400, 1280, 1440]) {
    test(`${route}: nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await page.goto(route === '/countries' ? '/countries?show=48' : route);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(wide).toBe(false);
    });
  }

  test(`${route}: loads nothing from another site and breaks no page rule`, async ({
    page,
    baseURL,
  }) => {
    const own = new URL(baseURL ?? 'http://localhost:3100').origin;
    const foreign: string[] = [];
    const refused: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:')
        foreign.push(request.url().slice(0, 40));
      else if (url.origin !== own) foreign.push(request.url().slice(0, 80));
    });
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text()))
        refused.push(message.text().slice(0, 120));
    });
    await page.goto(route);
    expect(foreign).toEqual([]);
    expect(refused).toEqual([]);
  });

  test(`${route}: reduced motion shows the finished step and the engine stays off`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await expect(page.locator('html')).not.toHaveAttribute('data-scenes', 'live');
    const scenes = page.locator('[data-scene]');
    for (let i = 0; i < (await scenes.count()); i++) {
      const scene = scenes.nth(i);
      const steps = Number(await scene.getAttribute('data-steps'));
      await expect(scene).toHaveAttribute('data-step', String(steps - 1));
    }
  });
}

test.describe('without script', () => {
  test.use({ javaScriptEnabled: false });

  test('/countries shows 12 rows and Show More adds 12 through a plain link', async ({ page }) => {
    await page.goto('/countries');
    await expect(page.locator('[data-country-row]')).toHaveCount(12);
    await expect(page.locator('#countries-more')).toContainText(/Showing 12 of \d+ countries\./);
    await page.getByRole('link', { name: /Show More/ }).click();
    await expect(page).toHaveURL(/\/countries\?show=24/);
    await expect(page.locator('[data-country-row]')).toHaveCount(24);
  });

  test('/countries holds up against hand-edited show values', async ({ page }) => {
    for (const show of ['abc', '-1', '1e9', '999999999999']) {
      const response = await page.goto(`/countries?show=${show}`);
      expect(response?.status(), show).toBe(200);
      const rows = await page.locator('[data-country-row]').count();
      expect(rows, show).toBeGreaterThanOrEqual(12);
    }
  });

  test('/countries marks a country with no stated facts and gives it no date', async ({ page }) => {
    await page.goto('/countries?show=1000');
    const unresearched = page.locator('[data-country-row]', { hasText: 'Not Researched Yet' });
    expect(await unresearched.count()).toBeGreaterThan(0);
    await expect(unresearched.first()).not.toContainText('Checked On');
  });

  test("/for-agencies reads whole and offers today's buttons", async ({ page }) => {
    await page.goto('/for-agencies');
    await expect(page.getByRole('link', { name: 'See What Works Today' }).first()).toBeVisible();
    await expect(page.getByText('Completeness only. Not an approval.')).toBeVisible();
    await expect(page.getByText('Example', { exact: true }).first()).toBeVisible();
  });
});

test('both pages are public: a visitor with no session gets the page, not a sign-in screen', async ({
  request,
}) => {
  for (const route of PAGES) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(200);
  }
});

async function titleOf(page: Page, route: string): Promise<string> {
  await page.goto(route);
  return page.title();
}

test('page titles are Countries and For Agencies', async ({ page }) => {
  expect(await titleOf(page, '/countries')).toMatch(/^Countries\b/);
  expect(await titleOf(page, '/for-agencies')).toMatch(/^For Agencies\b/);
});
