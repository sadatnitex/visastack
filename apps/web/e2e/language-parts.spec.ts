import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Language of parts (WCAG 3.1.2) in a real browser, for the home page and the sign-in page. The
 * visitor asks for Bengali with the language cookie. The server only honours it when it runs with
 * LOCALE_PREVIEW=1 and DEPLOYMENT_MODE=development (a local check, never CI), so in the ordinary
 * no-secret run both pages are English and the same accessibility checks run on them. Under the
 * preview they also prove that every `lang` in the page is valid and that Bengali and English
 * text are each marked.
 */

test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ['/', '/auth/sign-in']) {
  test(`${path} with the Bengali cookie has no serious accessibility violations and valid languages`, async ({
    page,
    baseURL,
  }) => {
    await page
      .context()
      .addCookies([
        { name: 'visastack_locale', value: 'bn', url: baseURL ?? 'http://localhost:3100' },
      ]);
    await page.goto(path);
    const htmlLang = await page.locator('html').getAttribute('lang');
    const bengali = (await page.locator('html').getAttribute('data-locale')) === 'bn';
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious' || v.id.startsWith('valid-lang'),
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    if (!bengali) return;
    // Every marked part names a language that is not the page's own.
    const marked = await page
      .locator('[lang]:not(html)')
      .evaluateAll((els) => els.map((el) => el.getAttribute('lang')));
    expect(marked.length).toBeGreaterThan(0);
    for (const lang of marked) {
      expect(['en', 'bn']).toContain(lang);
      expect(lang).not.toBe(htmlLang);
    }
  });
}
