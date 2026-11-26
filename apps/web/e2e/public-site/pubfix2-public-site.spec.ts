import { type Page, expect, test } from '@playwright/test';

/**
 * PUBFIX2 (pass 2 of the public-site check, 18 Nov 2026): the measured defects of
 * docs/upgrades/programme/pub/PUB5-verification.md section 9.5, each as a check on the real page.
 * P2-1 Countries Pause, P2-2 Home first screen, P2-3 Privacy and Trust first phone screen, P2-4
 * menu button, P2-5 How It Works length, P2-6 Privacy and Trust steadiness, P2-7 Home journey
 * resting step, P2-9 footer targets.
 */

type Lang = 'en' | 'bn';
const LANGS: Lang[] = ['en', 'bn'];

async function open(
  page: Page,
  _baseURL: string | undefined,
  path: string,
  size: { width: number; height: number },
  lang: Lang = 'en',
): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(path);
  // Bengali is chosen the way a visitor does it: the language switch in the bar or in the menu.
  if (lang === 'bn' && (await page.locator('html').getAttribute('data-locale')) !== 'bn') {
    const bar = page.locator('.lang-switch');
    if (await bar.isVisible()) {
      await bar.click();
    } else {
      await page.locator('button.site-menu-toggle').click();
      await page.locator('.menu-lang').click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-locale', 'bn');
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

// P2-2 (the Home first screen's pictures) and P2-7 (the Home journey) were retired with the scroll
// story they checked; the approved homepage (LAND1) has its own checks in land1-homepage.spec.ts.

// P2-3: the first phone screen of Privacy and Trust holds at most 30 words of the page itself.
test('P2-3 Privacy and Trust first screen 360x640 holds 30 visible words or fewer (English and Bengali)', async ({
  browser,
  baseURL,
}) => {
  for (const lang of LANGS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page, baseURL, '/trust', { width: 360, height: 640 }, lang);
    const words = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let count = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const parent = node.parentElement;
        if (!text || !parent) continue;
        const style = getComputedStyle(parent);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (box.width === 0 || box.top >= innerHeight || box.bottom <= 0) continue;
        count += text.split(/\s+/).length;
      }
      return count;
    });
    expect(words, lang).toBeLessThanOrEqual(30);
    // Nothing is removed: the line under the headline still shows, below the picture.
    await expect(page.locator('.tr-hero .kit-sub'), lang).toBeVisible();
    await context.close();
  }
});

// P2-4: the Menu button is 44 px tall wherever it shows.
for (const [lang, width] of [
  ['en', 768],
  ['en', 899],
  ['bn', 768],
  ['bn', 899],
] as const) {
  test(`P2-4 Menu button is 44 px tall at ${width} px (${lang})`, async ({ page, baseURL }) => {
    await open(page, baseURL, '/', { width, height: 900 }, lang);
    const toggle = page.locator('.site-navigation .site-menu-toggle');
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  });
}

// P2-5: How It Works within 6 screens on a computer.
for (const lang of LANGS) {
  test(`P2-5 How It Works is 6 screens or fewer at 1280x800 (${lang})`, async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL, '/how-it-works', { width: 1280, height: 800 }, lang);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThanOrEqual(6 * 800);
  });
}

// P2-6: Privacy and Trust keeps its height and shifts nothing while the share picture plays and the page is read.
for (const size of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`P2-6 Privacy and Trust holds its height and shifts under 0.01 at ${size.width}x${size.height}`, async ({
    page,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      const holder = window as unknown as { __cls: number };
      holder.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{
          value: number;
          hadRecentInput: boolean;
        }>) {
          if (!entry.hadRecentInput) holder.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await open(page, baseURL, '/trust', size);
    const heights = new Set<number>();
    // The five steps of the picture change every 2.2 s: watch a full loop.
    for (let i = 0; i < 28; i += 1) {
      heights.add(await page.evaluate(() => document.documentElement.scrollHeight));
      await page.waitForTimeout(400);
    }
    // Then read the whole page.
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += size.height * 0.5) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(150);
      heights.add(await page.evaluate(() => document.documentElement.scrollHeight));
    }
    await page.waitForTimeout(600);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
    const shift = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(shift).toBeLessThan(0.01);
  });
}

test('P2-6 the Where We Are Today heading never passes over its paragraph while it rises', async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL, '/trust', { width: 390, height: 844 });
  const gaps: number[] = [];
  await page.evaluate(() =>
    document.querySelector('#today')?.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  for (let i = 0; i < 12; i += 1) {
    gaps.push(
      await page.evaluate(() => {
        const heading = document.querySelector('#trust-today-title')?.getBoundingClientRect();
        const text = document.querySelector('.tr-today-text')?.getBoundingClientRect();
        return heading && text ? text.top - heading.bottom : -999;
      }),
    );
    await page.waitForTimeout(80);
  }
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(0);
});

// P2-9: the footer's Terms, Status and pilot notice are at least 44 x 44.
for (const size of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`P2-9 footer targets are 44 x 44 at ${size.width} px`, async ({ page, baseURL }) => {
    await open(page, baseURL, '/', size);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.site-footer-group a, .site-footer-beta')].map(
        (el) => {
          const box = el.getBoundingClientRect();
          return { name: el.textContent?.trim().slice(0, 30) ?? '', w: box.width, h: box.height };
        },
      ),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(9);
    for (const box of boxes) {
      expect(box.w, `${box.name} width`).toBeGreaterThanOrEqual(44);
      expect(box.h, `${box.name} height`).toBeGreaterThanOrEqual(44);
    }
  });
}

// P2-1: the flag ribbon can be stopped from the keyboard and by touch, on the screen where it is, and never moves with reduced motion.
test('P2-1 the Countries ribbon has a Pause button in reach of the ribbon that stops it', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    ...(baseURL ? { baseURL } : {}),
  });
  const page = await context.newPage();
  await page.goto('/countries');
  const running = () =>
    page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  const pause = page.getByRole('button', { name: 'Pause Motion' });
  await expect(pause).toBeVisible();
  expect(await running()).toBeGreaterThan(0);
  // Both the button and the ribbon fit in one screen height.
  const near = await page.evaluate(() => {
    const button = document.querySelector('.r4-motion-toggle')?.getBoundingClientRect();
    const ribbon = document.querySelector('.r4-ribbon')?.getBoundingClientRect();
    if (!button || !ribbon) return Number.POSITIVE_INFINITY;
    return Math.max(button.bottom, ribbon.bottom) - Math.min(button.top, ribbon.top);
  });
  expect(near).toBeLessThanOrEqual(844);
  await pause.focus();
  await page.keyboard.press('Enter');
  await expect(pause).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play Motion' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.mouse.move(0, 0);
  await expect.poll(running).toBe(0);
  await context.close();

  const still = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    ...(baseURL ? { baseURL } : {}),
  });
  const quiet = await still.newPage();
  await quiet.goto('/countries');
  await quiet.waitForTimeout(800);
  expect(
    await quiet.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    ),
  ).toBe(0);
  await expect(quiet.getByRole('button', { name: 'Pause Motion' })).toHaveCount(0);
  await still.close();
});
