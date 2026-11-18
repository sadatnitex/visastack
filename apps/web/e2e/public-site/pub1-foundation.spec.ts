import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';

/**
 * WP-PUB1: the frame every public page shares. The header lists the five public pages, none of its
 * links leads nowhere, the pilot notice stays on every public page, and nothing scrolls sideways
 * or loads from another site.
 */

const PUBLIC_ROUTES = ['/', '/trust', '/privacy', '/terms', '/status', '/auth/sign-in'];
const NAV = ['Home', 'How It Works', 'Privacy and Trust', 'Countries', 'For Agencies'];

test('the header lists the five public pages, in order, and each one opens', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const links = page
    .getByRole('navigation', { name: 'Site', exact: true })
    .locator('.site-nav-pages a');
  await expect(links).toHaveText(NAV);
  for (const href of await links.evaluateAll((all) =>
    all.map((a) => a.getAttribute('href') ?? ''),
  )) {
    const [path, anchor] = href.split('#');
    const response = await page.request.get(path || '/');
    expect(response.status(), href).toBeLessThan(400);
    if (anchor) {
      await page.goto(href);
      await expect(page.locator(`[id="${anchor}"]`), href).toHaveCount(1);
    }
  }
});

test('the phone menu offers the same five pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Site', exact: true });
  for (const name of NAV) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
});

for (const width of [320, 400, 1280]) {
  test(`public pages keep the pilot notice and never scroll sideways at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await expect(page.locator('.pilot-banner'), route).toContainText(
        /VisaStack (Private Pilot|Public Beta)/,
      );
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(wide, route).toBe(false);
    }
  });
}

test('public pages load nothing from another site', async ({ page, baseURL }) => {
  const own = new URL(baseURL ?? 'http://localhost:3100').origin;
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin === own) return;
    foreign.push(request.url().slice(0, 80));
  });
  for (const route of PUBLIC_ROUTES) await page.goto(route);
  expect(foreign).toEqual([]);
});

/**
 * The flat check in ux-public.spec.ts skips only an element that carries data-pub-depth itself
 * (ADR 0029). This runs the same test on a dark chapter that holds a shadowed chip: the chip is
 * caught, the chapter's own glow is not.
 */
test('the flat check catches a shadow on a chip inside a dark chapter', async ({ page }) => {
  const spec = readFileSync(join(__dirname, '..', 'ux-public.spec.ts'), 'utf8');
  expect(spec).toContain("if (element.hasAttribute('data-pub-depth')) return false;");
  await page.setContent(
    '<section class="pub-chapter-dark" data-pub-depth style="background-image: radial-gradient(#1d4c98, #0b1a30)"><h2>Chapter</h2><span class="pub-chip" style="box-shadow: 0 1px 2px #000">Saved</span></section>',
  );
  const flagged = await page.locator('body').evaluate((body) =>
    [...body.querySelectorAll('*')]
      .filter((element) => {
        if (element.hasAttribute('data-pub-depth')) return false;
        const css = getComputedStyle(element);
        return (
          css.boxShadow !== 'none' ||
          css.textShadow !== 'none' ||
          css.backdropFilter !== 'none' ||
          /(?:linear|radial)-gradient|blur\(|drop-shadow\(/.test(css.backgroundImage + css.filter)
        );
      })
      .map((element) => element.className),
  );
  expect(flagged).toEqual(['pub-chip']);
});

/**
 * The scenes mark is set by the early script in the page head, before React starts, so a scene
 * has its scroll length from the first paint. React's own scripts are blocked here, so only the
 * early script can have set it. No page holds a scene until PUB2, so a layout-shift measurement
 * on a real scene lands with PUB2's page; this proves the mark that prevents the shift.
 */
test.describe('the early scenes mark', () => {
  const blockReact = (page: Page) =>
    page.route('**/_next/static/chunks/**', (route) => route.abort());

  test('is set before React starts on a big screen with motion welcome', async ({ page }) => {
    const refused: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to (load|execute)/i.test(message.text()))
        refused.push(message.text().slice(0, 120));
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await blockReact(page);
    await page.goto('/');
    // The page's own policy (nonce, strict-dynamic) lets the nonce'd same-site file run.
    await expect(page.locator('html')).toHaveAttribute('data-scenes', 'live');
    await expect(page.locator('head script[src="/scenes-boot.js"][nonce]')).toHaveCount(1);
    expect(refused.filter((line) => line.includes('scenes-boot'))).toEqual([]);
  });

  test('is a small same-site file, served as JavaScript', async ({ request }) => {
    const response = await request.get('/scenes-boot.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/javascript/);
    // Next serves files from public/ with revalidation (public, max-age=0), so a change ships at once.
    expect(response.headers()['cache-control']).toMatch(/public/);
    expect((await response.body()).byteLength).toBeLessThan(1024);
  });

  // Owner, 18 Nov 2026: reduced motion gets the gentle mode (fades), on every screen.
  for (const [width, height] of [
    [1280, 900],
    [390, 844],
  ] as const)
    test(`marks gentle with reduced motion at ${width} x ${height}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height });
      await blockReact(page);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-scenes', 'gentle');
      await expect(page.locator('html')).toHaveAttribute('data-scene-mode', 'gentle');
    });

  test('keeps motion on with data saver: the same mode as without it', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await blockReact(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-scenes', 'live');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-scenes', 'reveal');
  });

  // MOT1 (owner, 18 Nov 2026): a phone, a short or a zoomed window reveals instead of staying still.
  for (const [name, width, height] of [
    ['a phone screen', 390, 844],
    ['a short screen', 1280, 560],
  ] as const)
    test(`marks reveal, not pinned, on ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await blockReact(page);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-scenes', 'reveal');
      await expect(page.locator('html')).toHaveAttribute('data-scene-mode', 'reveal');
    });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('pages never mark scenes live', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-scenes', /.*/);
  });
});
