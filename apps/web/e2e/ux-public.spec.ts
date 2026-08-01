import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * UX/accessibility verification for public (no-secret) surfaces (master
 * directive §7 "PR 7" — UX verification). Runs in ordinary CI alongside
 * no-secret-auth.spec.ts. Authenticated-workspace UX (dashboard, applicant
 * pages, forms) is covered separately in authenticated-workspace.spec.ts,
 * gated behind WorkOS staging credentials like the rest of that file —
 * implemented, not yet verified against real staging credentials, same
 * caveat as the existing authenticated journey tests.
 */

test.describe('accessibility (axe) — public pages', () => {
  for (const path of ['/', '/status']) {
    test(`${path} has no critical/serious automated accessibility violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});

test.describe('responsive layout', () => {
  const viewports = {
    mobile: { width: 390, height: 844 },
    tablet: { width: 820, height: 1180 },
    desktop: { width: 1440, height: 900 },
  } as const;

  for (const [name, viewport] of Object.entries(viewports)) {
    test(`landing page has no horizontal overflow at ${name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

test.describe('keyboard navigation', () => {
  test('skip link is the first focus stop and jumps to main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeInViewport();
  });
});

test.describe('language switching', () => {
  test('switching to Bangla changes the html lang attribute and persists across navigation', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: 'বাংলা' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await page.goto('/status');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  });
});

test.describe('error and not-found states', () => {
  test('an unknown route renders the styled not-found page, not a bare 404', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /workspace|home/i }).first()).toBeVisible();
  });
});
