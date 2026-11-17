import { expect, test } from '@playwright/test';

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
