import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { isPublicStaticUrl } from '../src/lib/pwa/constants';

/**
 * Installable VisaStack (Lane D PWA) in a real browser, against a production build: the manifest
 * and icons, the service worker under the site's security policy, the cache law (only public
 * static files are ever stored on the device), the offline screen and recovery, and deep links.
 * Runs without secrets; signed-in pages are covered by their redirect to sign-in, which is what
 * an installed app shows before a session exists.
 */

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

/** Loads a page and waits until the service worker controls it. */
async function openControlled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    }
  });
}

test.describe('install details', () => {
  test('the manifest describes an installable standalone app with working icons', async ({
    request,
  }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      id: '/',
      name: 'VisaStack',
      short_name: 'VisaStack',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
    });
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(
      true,
    );
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const image = await request.get(icon.src);
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()['content-type']).toBe('image/png');
      const bytes = await image.body();
      // PNG width and height sit at bytes 16 to 23 of the header.
      const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  test('every page links the manifest and carries the home-screen details', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f7f9fe');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'VisaStack',
    );
    await expect(page.locator('meta[name="format-detection"]')).toHaveAttribute(
      'content',
      /telephone=no/,
    );
    await expect(page.locator('link[rel="apple-touch-icon"]').first()).toHaveAttribute(
      'href',
      /apple-icon/,
    );
  });

  test('the worker script is served fresh, from this site', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
    expect(response.headers()['cache-control']).toContain('no-cache');
    const body = await response.text();
    expect(body).toContain('Public static files only');
    expect(body).not.toContain('const VERSION = "unknown"');
  });
});

test.describe('service worker and the cache law', () => {
  test('registers under the security policy with no violation', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) violations.push(message.text());
    });
    await openControlled(page, '/');
    const scope = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.scope,
    );
    expect(scope).toBe(new URL('/', page.url()).toString());
    expect(violations).toEqual([]);
  });

  test('stores only public static files, whatever pages and data are visited', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? page.url()).origin;
    await openControlled(page, '/');
    for (const path of ['/status', '/trust', '/auth/sign-in', '/app', '/privacy']) {
      await page.goto(path);
    }
    await page.evaluate(async () => {
      await fetch('/api/health/ready');
      await fetch('/app?_rsc=probe', { headers: { RSC: '1' } });
    });
    await page.reload();

    const urls = await cachedUrls(page);
    expect(urls.some((url) => url.includes('/_next/static/'))).toBe(true);
    expect(urls.filter((url) => !isPublicStaticUrl(new URL(url), origin))).toEqual([]);
  });

  test('pages still come from the network once the worker controls them', async ({ page }) => {
    await openControlled(page, '/status');
    const response = await page.reload();
    expect(response?.status()).toBe(200);
    // A page answered from a device cache would not carry a fresh per-request policy nonce.
    const first = response?.headers()['content-security-policy'];
    const second = (await page.reload())?.headers()['content-security-policy'];
    expect(first).toMatch(/'nonce-[^']+'/);
    expect(second).not.toBe(first);
  });
});

test.describe('offline and recovery', () => {
  test('a page opened offline shows the honest offline screen, then recovers', async ({
    page,
    context,
  }) => {
    await openControlled(page, '/');
    await context.setOffline(true);
    await page.goto('/trust').catch(() => undefined);
    await expect(page.getByRole('heading', { level: 1, name: 'You Are Offline' })).toBeVisible();
    await expect(page.getByText('not stored on this device')).toBeVisible();
    await expect(page.getByText('may not have been sent')).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);

    await page.setViewportSize({ width: 320, height: 640 });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Try Again while still offline reloads and lands on the same honest screen.
    const reloaded = page.waitForEvent('framenavigated');
    await page.getByRole('button', { name: 'Try Again' }).click();
    await reloaded;
    await expect(page.getByRole('heading', { level: 1, name: 'You Are Offline' })).toBeVisible();

    // Reconnecting reloads by itself and brings back the real page.
    await context.setOffline(false);
    await expect(page.getByRole('heading', { level: 1, name: 'You Are Offline' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/trust$/);
    await expect(page.locator('main#main')).toBeVisible();
  });

  test('an open page says when the connection drops and returns', async ({ page, context }) => {
    await openControlled(page, '/status');
    await context.setOffline(true);
    const status = page.locator('[data-pwa-runtime] output');
    await expect(status).toContainText('You are offline.');
    await context.setOffline(false);
    await expect(status).toContainText('You are back online.');
  });
});

test.describe('deep links', () => {
  const ID = '0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

  for (const path of [
    `/app/mission/${ID}`,
    `/app/applicant/${ID}/documents`,
    '/app/notifications',
  ]) {
    test(`${path} asks for sign-in and returns to the same place`, async ({ page }) => {
      await openControlled(page, '/');
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/sign-in\?next=/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(path);
    });
  }
});
