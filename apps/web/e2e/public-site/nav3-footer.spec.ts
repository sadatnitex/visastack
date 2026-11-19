import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * WP-NAV3: the footer spreads across the full width for everyone, and the signed-out header has no
 * account control. (The signed-in header needs a session; it is covered by the unit tests in
 * src/app/layout-nav3.test.tsx and by the signed-in browser run recorded in NAV3-records.md.)
 */

type Lang = 'en' | 'bn';
const PHONES = [360, 390, 412] as const;
const WIDER = [768, 1024, 1440] as const;

async function openPage(page: Page, width: number, lang: Lang) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
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

/** Boxes of the footer's parts, to test spread and overlap. */
async function measureFooter(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
    };
    const footer = document.querySelector('footer.site-footer') as HTMLElement;
    const inner = footer.querySelector('.site-footer-inner') as HTMLElement;
    const style = getComputedStyle(inner);
    const content = {
      left: inner.getBoundingClientRect().left + Number.parseFloat(style.paddingLeft),
      right: inner.getBoundingClientRect().right - Number.parseFloat(style.paddingRight),
    };
    // The phone footer lets neighbouring 44 px rows share a few pixels of empty padding (the page
    // height budget), so what must never overlap is the words themselves.
    const words = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const links = [...footer.querySelectorAll('.site-footer-group a, .footer-signout')].map(
      (el) => ({
        text: (el.textContent ?? '').trim(),
        ...(box(el) as NonNullable<ReturnType<typeof box>>),
        word: words(el),
      }),
    );
    return {
      content,
      brand: box(footer.querySelector('.site-footer-brand')),
      about: box(footer.querySelector('.site-footer-about')),
      nav: box(footer.querySelector('.site-footer-nav')),
      groups: [...footer.querySelectorAll('.site-footer-group')].map((el) => box(el)),
      base: box(footer.querySelector('.site-footer-base')),
      beta: box(footer.querySelector('.site-footer-beta')),
      links,
      viewport: window.innerWidth,
      pageScroll: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

const overlaps = (
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

for (const lang of ['en', 'bn'] as Lang[]) {
  test.describe(`footer in ${lang === 'en' ? 'English' : 'Bengali'}`, () => {
    for (const width of [...PHONES, ...WIDER]) {
      test(`${width}px: no overlap, no sideways scroll, all links 44px`, async ({ page }) => {
        await openPage(page, width, lang);
        const m = await measureFooter(page);
        expect(m.pageScroll).toBeLessThanOrEqual(0);
        for (const link of m.links) {
          expect(link.left, `${link.text} inside the screen`).toBeGreaterThanOrEqual(-0.5);
          expect(link.right, `${link.text} inside the screen`).toBeLessThanOrEqual(
            m.viewport + 0.5,
          );
          expect(link.right - link.left, `${link.text} is 44px wide`).toBeGreaterThanOrEqual(43.5);
        }
        for (let i = 0; i < m.links.length; i += 1)
          for (let j = i + 1; j < m.links.length; j += 1) {
            const a = m.links[i];
            const b = m.links[j];
            if (a && b)
              expect(overlaps(a.word, b.word), `${a.text} and ${b.text} overlap`).toBe(false);
          }
      });
    }

    for (const width of WIDER) {
      test(`${width}px: spread edge to edge, not leaning left`, async ({ page }) => {
        await openPage(page, width, lang);
        const m = await measureFooter(page);
        const groups = m.groups.filter((g): g is NonNullable<typeof g> => g !== null);
        expect(groups.length).toBe(3);
        // The last group ends at the content's right edge; the first starts at (or, with the brand
        // beside it, right of) the left edge. The row spans the whole width.
        const last = groups[groups.length - 1];
        expect(last?.right ?? 0).toBeGreaterThanOrEqual(m.content.right - 2);
        if (width <= 1024) {
          expect(groups[0]?.left ?? 99).toBeLessThanOrEqual(m.content.left + 2);
        } else {
          expect(m.brand?.left ?? 99).toBeLessThanOrEqual(m.content.left + 2);
        }
        // Even: the two gaps between the three groups match.
        const gapA = (groups[1]?.left ?? 0) - (groups[0]?.right ?? 0);
        const gapB = (groups[2]?.left ?? 0) - (groups[1]?.right ?? 0);
        expect(Math.abs(gapA - gapB)).toBeLessThanOrEqual(2);
      });
    }

    for (const width of PHONES) {
      test(`${width}px: links spread evenly in each row, brand and beta line centred`, async ({
        page,
      }) => {
        await openPage(page, width, lang);
        const m = await measureFooter(page);
        const middle = m.viewport / 2;
        const about = m.about as NonNullable<typeof m.about>;
        expect(Math.abs((about.left + about.right) / 2 - middle)).toBeLessThanOrEqual(3);
        if (m.beta) {
          expect(Math.abs((m.beta.left + m.beta.right) / 2 - middle)).toBeLessThanOrEqual(3);
        }
        const nav = m.nav as NonNullable<typeof m.nav>;
        const content = m.content;
        expect(nav.left).toBeLessThanOrEqual(content.left + 1);
        expect(nav.right).toBeGreaterThanOrEqual(content.right - 1);
        // Each row of links sits evenly across the width: equal room to its left and right.
        const rows = new Map<number, typeof m.links>();
        for (const link of m.links) {
          const key = Math.round(link.top / 12);
          rows.set(key, [...(rows.get(key) ?? []), link]);
        }
        for (const row of rows.values()) {
          const first = Math.min(...row.map((l) => l.left));
          const last = Math.max(...row.map((l) => l.right));
          expect(
            Math.abs(first - content.left - (content.right - last)),
            'a row of links is centred, not leaning left',
          ).toBeLessThanOrEqual(3);
        }
      });
    }

    test('has no serious accessibility problems', async ({ page }) => {
      await openPage(page, 390, lang);
      const result = await new AxeBuilder({ page }).include('footer').analyze();
      expect(
        result.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => v.id),
      ).toEqual([]);
    });
  });
}

test('the signed-out header has no account control', async ({ page }) => {
  await openPage(page, 1440, 'en');
  await expect(page.locator('header .record-account-public')).toHaveCount(0);
  await expect(page.locator('header .nav-account')).toHaveCount(0);
  await expect(page.locator('header .menu-account')).toHaveCount(0);
  await expect(page.locator('header').getByText('Sign Out')).toHaveCount(0);
  await expect(page.locator('header a[href="/app"]').first()).toBeVisible();
  await expect(page.locator('footer').getByText('Sign Out')).toHaveCount(0);
});

test('public pages are never cached for anyone else (a signed-in page is built the same way)', async ({
  request,
}) => {
  const response = await request.get('/');
  const control = response.headers()['cache-control'] ?? '';
  expect(control).toContain('private');
  expect(control).toContain('no-store');
});
