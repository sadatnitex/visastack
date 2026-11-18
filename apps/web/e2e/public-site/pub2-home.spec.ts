import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * WP-PUB2: the Home page's scroll story. Scenes pin only on a screen 900 px wide or more; below that
 * (and with reduced motion, data saver or no JavaScript) every scene shows finished and still.
 * Page heights: at most 12 screens on a computer, 6 on a phone.
 */

const SIZES = [
  { name: 'small phone', width: 360, height: 640 },
  { name: 'phone', width: 400, height: 860 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const SCENES = ['intake', 'ready', 'closing'] as const;

async function wait(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#land-hero-title')).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`Home at ${size.name} ${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('never scrolls sideways', async ({ page }) => {
      await wait(page);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBeLessThanOrEqual(0);
    });

    test('has no serious or critical accessibility problem', async ({ page }) => {
      await wait(page);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });

    test('keeps every scene control at 44 px or more', async ({ page }) => {
      await wait(page);
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-scene] a, [data-scene] button, .pub-button',
          ),
        ]
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && (box.height < 44 || box.width < 44))
          .map(({ el }) => el.textContent?.trim().slice(0, 30) ?? ''),
      );
      expect(small).toEqual([]);
    });

    test('sends no picture from another origin and no refused policy', async ({
      page,
      baseURL,
    }) => {
      const own = new URL(baseURL ?? 'http://localhost:3100').origin;
      const foreign: string[] = [];
      const refused: string[] = [];
      page.on('request', (request) => {
        if (request.resourceType() !== 'image') return;
        const url = new URL(request.url());
        if (url.origin !== own) foreign.push(request.url().slice(0, 80));
      });
      page.on('console', (message) => {
        if (/Content Security Policy|Refused to/i.test(message.text()))
          refused.push(message.text().slice(0, 120));
      });
      await wait(page);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += innerHeight) window.scrollTo(0, y);
        window.scrollTo(0, 0);
      });
      expect(foreign).toEqual([]);
      expect(refused).toEqual([]);
    });
  });
}

test('the first screen at 360x640 holds 30 words or fewer of the page itself', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await wait(page);
  const words = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let count = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (parent.closest('[aria-hidden="true"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width === 0 || box.top >= innerHeight || box.bottom <= 0) continue;
      count += text.split(/\s+/).length;
    }
    return count;
  });
  expect(words).toBeLessThanOrEqual(30);
});

for (const size of SIZES.filter((s) => s.width >= 900)) {
  test(`pins every scene on a ${size.width}px screen, one screen high`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await wait(page);
    await expect(page.locator('html')).toHaveAttribute('data-scenes', 'live');
    for (const name of SCENES) {
      const stage = page.locator(`[data-scene="${name}"] .pub-scene-stage`);
      await expect(stage).toHaveCSS('position', 'sticky');
    }
  });
}

test('pins nothing below 900 px, so a scene is a still picture', async ({ page }) => {
  // 820 is above the engine's own floor (760), so this proves the page's own rule, not the engine's.
  for (const width of [360, 400, 820]) {
    await page.setViewportSize({ width, height: 860 });
    await wait(page);
    for (const name of SCENES) {
      const stage = page.locator(`[data-scene="${name}"] .pub-scene-stage`);
      await expect(stage, `${name} at ${width}`).not.toHaveCSS('position', 'sticky');
      const box = await page.locator(`[data-scene="${name}"]`).boundingBox();
      expect(box?.height ?? 0, `${name} at ${width}`).toBeLessThan(860 * 1.6);
    }
  }
});

test.describe('reduced motion', () => {
  test('shows every scene finished and still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await wait(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-scenes', /.*/);
    const final: Record<string, string | null> = {
      intake: '3',
      ready: '1',
      closing: '0',
    };
    for (const name of SCENES) {
      const scene = page.locator(`[data-scene="${name}"]`);
      await expect(scene).toHaveAttribute('data-step', final[name] ?? '0');
      await expect(scene.locator('.pub-scene-stage')).not.toHaveCSS('position', 'sticky');
    }
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Completeness only. Not an approval.')).toBeVisible();
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('shows every scene, finished', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    for (const name of SCENES) await expect(page.locator(`[data-scene="${name}"]`)).toBeVisible();
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Completeness only. Not an approval.')).toBeVisible();
    await expect(page.locator('.pub-passport-tilt img')).toBeVisible();
  });
});

test('the page stays within its height budgets: 12 screens on a computer, 6 on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(page);
  const desktop = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(desktop).toBeLessThanOrEqual(800 * 12);
  await page.setViewportSize({ width: 390, height: 844 });
  await wait(page);
  const phone = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(phone).toBeLessThanOrEqual(844 * 6);
});

test('the scenes move while scrolling on a computer: the step changes, the page stays put', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(page);
  const scene = page.locator('[data-scene="intake"]');
  await scene.scrollIntoViewIfNeeded();
  const top = await scene.evaluate((el) => el.getBoundingClientRect().top + scrollY);
  const steps = new Set<string>();
  for (let y = top; y < top + 800 * 3; y += 200) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(60);
    steps.add((await scene.getAttribute('data-step')) ?? '');
  }
  expect(steps.size).toBeGreaterThanOrEqual(3);
});

test('no pinned scene clips its words on a short computer screen (1024x600)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await wait(page);
  await expect(page.locator('html')).toHaveAttribute('data-scenes', 'live');
  const clipped = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-scene="intake"] .pub-scene-stage, [data-scene="ready"] .pub-scene-stage',
      ),
    ]
      .filter((stage) => stage.scrollHeight > stage.clientHeight + 1)
      .map((stage) => stage.closest('[data-scene]')?.getAttribute('data-scene')),
  );
  expect(clipped).toEqual([]);
});
