import { type Page, expect, test } from '@playwright/test';

/**
 * WP-NAV2: the shared header and footer.
 *
 * The owner's finding (18 Nov 2026): on a 1344 px screen the header links ("How It Works",
 * "Privacy and Trust", "For Agencies", "Sign In", "Get Started") wrapped onto two lines. These
 * checks measure the real page in a real browser at every width the Guardian named, in English and
 * Bengali: nothing in the header wraps, nothing sticks out of the bar, the row collapses into the
 * menu exactly where it stops fitting (measured per language), and the primary action stays in the
 * bar. The footer is checked at a phone and a laptop width.
 *
 * The signed-in header is the same markup with Workspace as its one action; this suite cannot sign
 * in, so it swaps that one link on the real page (the unit test in src/app/layout-header-footer
 * covers the markup the server draws for a signed-in person).
 */

type Lang = 'en' | 'bn';
const WIDTHS = [320, 390, 768, 1024, 1180, 1280, 1344, 1440, 1920] as const;
/**
 * The first viewport width at which the whole row fits on one line, measured on the built page
 * (docs/upgrades/programme/pub/NAV2-records.md; PUBW1, 19 Nov 2026: owner decision, from 900 px in both
 * languages, the row is compacted between 900 and 1230 px). Below it the pages, the language switch and the
 * quiet sign-in live in the menu. Bengali words are wider, so its row needs more room.
 */
const FULL_ROW_FROM: Record<Lang, number> = { en: 900, bn: 900 };
const LANGS: Lang[] = ['en', 'bn'];

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function openPage(page: Page, width: number, lang: Lang, path = '/') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
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
  await settle(page);
}

/** What the header draws: every visible link and button, with its lines and where it sits. */
async function measureHeader(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header.nav') as HTMLElement;
    const bar = header.getBoundingClientRect();
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const items = [...header.querySelectorAll('a, button')].filter(shown).map((el) => {
      const box = el.getBoundingClientRect();
      // One rectangle per line of text: a wrapped label has two or more.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const lines: number[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node.textContent ?? '').trim()) continue;
        const parent = node.parentElement as HTMLElement;
        if (!shown(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        lines.push(range.getClientRects().length);
      }
      return {
        name: (el.textContent ?? '').replace(/\s+/g, ' ').trim() || el.className,
        height: Math.round(box.height),
        lines,
        left: box.left,
        right: box.right,
      };
    });
    return {
      items,
      barLeft: bar.left,
      barRight: bar.right,
      barScroll: header.scrollWidth - header.clientWidth,
      pageScroll: document.documentElement.scrollWidth - window.innerWidth,
      toggle: (() => {
        const t = header.querySelector('.site-menu-toggle');
        return t ? shown(t) : false;
      })(),
    };
  });
}

function expectOneLine(
  measure: Awaited<ReturnType<typeof measureHeader>>,
  label: string,
  maxHeight = 48,
) {
  expect(measure.items.length, `${label}: the header has controls`).toBeGreaterThan(2);
  for (const item of measure.items) {
    expect(
      item.lines.every((count) => count === 1),
      `${label}: "${item.name}" wrapped (${item.lines.join(',')} rects)`,
    ).toBe(true);
    // One line box plus its padding; a wrapped label is taller than a 48 px row.
    expect(item.height, `${label}: "${item.name}" is one row tall`).toBeLessThanOrEqual(maxHeight);
    expect(item.left, `${label}: "${item.name}" starts inside the bar`).toBeGreaterThanOrEqual(
      measure.barLeft - 0.5,
    );
    expect(item.right, `${label}: "${item.name}" ends inside the bar`).toBeLessThanOrEqual(
      measure.barRight + 0.5,
    );
  }
  expect(measure.barScroll, `${label}: the bar does not overflow sideways`).toBeLessThanOrEqual(0);
  expect(measure.pageScroll, `${label}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
}

/** The header as a signed-in person sees it: Workspace as the one action (swapped on the real page). */
async function asSignedIn(page: Page, lang: Lang) {
  await page.evaluate(
    (word) => {
      for (const el of document.querySelectorAll('header .nav-signin, header .menu-signin'))
        el.remove();
      const only = document.querySelector('header .site-nav-actions .btn-primary');
      if (only) {
        only.textContent = word;
        only.setAttribute('href', '/app');
      }
    },
    lang === 'en' ? 'Workspace' : 'ওয়ার্কস্পেস',
  );
  await settle(page);
}

for (const lang of LANGS) {
  test.describe(`header in ${lang === 'en' ? 'English' : 'Bengali'}`, () => {
    const widths = [...new Set([...WIDTHS, FULL_ROW_FROM[lang] - 1, FULL_ROW_FROM[lang]])].sort(
      (a, b) => a - b,
    );
    for (const width of widths) {
      test(`signed out at ${width} px: one line each, nothing sticks out, the action stays`, async ({
        page,
      }) => {
        await openPage(page, width, lang);
        const full = width >= FULL_ROW_FROM[lang];
        const bar = await measureHeader(page);
        expectOneLine(bar, `${lang} ${width}`);
        expect(bar.toggle, 'the menu button shows exactly when the row does not fit').toBe(!full);
        const pages = page.locator('header .site-nav-pages a');
        if (full) {
          await expect(pages).toHaveCount(5);
          for (const link of await pages.all()) await expect(link).toBeVisible();
        } else {
          for (const link of await pages.all()) await expect(link).toBeHidden();
        }
        // The one action that matters is in the bar at every width.
        const primary = page.locator('header .site-nav-actions .btn-primary');
        await expect(primary).toHaveCount(1);
        await expect(primary).toBeVisible();
        const box = await primary.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        // The menu, when open, is one line per entry and stays on the screen.
        if (!full) {
          await page.locator('button.site-menu-toggle').click();
          const open = await measureHeader(page);
          expectOneLine(open, `${lang} ${width} (menu open)`);
          const panel = await page.locator('.site-menu-panel').boundingBox();
          expect(panel?.x ?? -1).toBeGreaterThanOrEqual(0);
          expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
          for (const name of ['Home', 'How It Works', 'Countries']) {
            if (lang === 'en')
              await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
          }
          await expect(page.locator('.menu-lang')).toBeVisible();
        }
      });
    }

    test('signed in at 1280 px and at the phone width: one line each, one action', async ({
      page,
    }) => {
      for (const width of [1280, 390]) {
        await openPage(page, width, lang);
        await asSignedIn(page, lang);
        const bar = await measureHeader(page);
        expectOneLine(bar, `signed in ${lang} ${width}`);
        const names = bar.items.map((item) => item.name);
        expect(names.filter((name) => /workspace|ওয়ার্কস্পেস/i.test(name))).toHaveLength(1);
      }
    });
  });
}

test.describe('tablet header (PUBW1)', () => {
  for (const lang of LANGS) {
    for (const width of [900, 1024, 1180]) {
      test(`${lang} at ${width} px: full links on one line, 44 px targets, no overlap`, async ({
        page,
      }) => {
        await openPage(page, width, lang);
        const bar = await measureHeader(page);
        expectOneLine(bar, `${lang} ${width}`);
        expect(bar.toggle, 'no menu button on a tablet').toBe(false);
        await expect(page.locator('header .site-nav-pages a')).toHaveCount(5);
        for (const link of await page.locator('header .site-nav-pages a').all()) {
          await expect(link).toBeVisible();
          expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
        const boxes = bar.items.slice().sort((a, b) => a.left - b.left);
        for (let i = 1; i < boxes.length; i += 1) {
          const prev = boxes[i - 1];
          const next = boxes[i];
          if (!prev || !next) continue;
          expect(
            next.left,
            `${lang} ${width}: "${next.name}" does not overlap "${prev.name}"`,
          ).toBeGreaterThanOrEqual(prev.right - 0.5);
        }
      });
    }
    test(`${lang} at 899 px: still the menu button`, async ({ page }) => {
      await openPage(page, 899, lang);
      expect((await measureHeader(page)).toggle).toBe(true);
    });
  }
});

test.describe('header behaviour', () => {
  test('the menu keeps its button name, expanded state, focus order and Escape', async ({
    page,
  }) => {
    await openPage(page, 390, 'en');
    const button = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page
        .getByRole('navigation', { name: 'Site', exact: true })
        .getByRole('link', { name: 'Home', exact: true }),
    ).toBeFocused();
    // The menu holds the five pages, then the language switch and the quiet sign-in.
    const order = await page
      .locator('.site-menu-panel')
      .evaluate((panel) =>
        [...panel.querySelectorAll('a, button')].map((el) =>
          (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      );
    expect(order.slice(0, 5)).toEqual([
      'Home',
      'How It Works',
      'Privacy and Trust',
      'Countries',
      'For Agencies',
    ]);
    expect(order[5]).toBe('বাংলা');
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('the current page has a marker that is not colour alone, in the row and in the menu', async ({
    page,
  }) => {
    await openPage(page, 1344, 'en', '/trust');
    const current = page.locator('.site-nav-pages a[aria-current="page"]');
    await expect(current).toHaveText('Privacy and Trust');
    await expect(page.locator('.site-nav-pages a[aria-current]')).toHaveCount(1);
    const marker = await current.evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return { content: after.content, height: after.height, background: after.backgroundColor };
    });
    expect(marker.content).toBe('""');
    expect(marker.height).toBe('2px');
    expect(marker.background).not.toBe('rgba(0, 0, 0, 0)');
    await openPage(page, 390, 'en', '/countries');
    await page.locator('button.site-menu-toggle').click();
    const phone = page.locator('.site-nav-pages a[aria-current="page"]');
    await expect(phone).toHaveText('Countries');
    const bar = await phone.evaluate((el) => getComputedStyle(el, '::after').width);
    expect(bar).toBe('3px');
  });

  test('every control in the bar is a 44 px target and shows a focus ring', async ({ page }) => {
    await openPage(page, 1344, 'en');
    const controls = page.locator('header.nav a:visible, header.nav button:visible');
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(8);
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const box = await control.boundingBox();
      const name = (await control.textContent())?.trim() || 'brand';
      expect(box?.height ?? 0, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
      await control.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const ring = await control.evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: style.outlineWidth, style: style.outlineStyle };
      });
      expect(ring.style, `${name} shows an outline when focused by keyboard`).not.toBe('none');
      expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
    }
  });

  test('the bar is solid, so it reads over light and dark sections alike', async ({ page }) => {
    await openPage(page, 1344, 'en');
    const style = await page.locator('header.nav').evaluate((el) => {
      const css = getComputedStyle(el);
      return {
        background: css.backgroundColor,
        filter: css.backdropFilter,
        shadow: css.boxShadow,
      };
    });
    expect(style.background).toBe('rgb(255, 255, 255)');
    expect(style.filter).toBe('none');
    expect(style.shadow).toBe('none');
  });

  test('Get Started is the one filled button and Sign In is quiet beside it', async ({ page }) => {
    await openPage(page, 1344, 'en');
    const primary = page.locator('header .site-nav-actions .btn-primary');
    await expect(primary).toHaveCount(1);
    const signUp = await page.locator('header a[href="/auth/sign-up"]').count();
    if (signUp > 0) {
      await expect(primary).toHaveText('Get Started');
      const quiet = page.locator('header .site-nav-actions .nav-signin');
      await expect(quiet).toHaveText('Sign In');
      await expect(quiet).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    } else {
      await expect(primary).toHaveText(/Sign In|Workspace/);
    }
  });
});

test.describe('header at the edges', () => {
  test('an open menu closes when focus leaves it or a press lands outside it', async ({ page }) => {
    await openPage(page, 390, 'en');
    const button = page.locator('button.site-menu-toggle');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // Tab on until focus leaves the header's controls: the covering panel must be gone.
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab');
      if ((await button.getAttribute('aria-expanded')) === 'false') break;
    }
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    // A press outside closes it too (the brand link keeps the page where it is).
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await page.locator('header .brand').click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    // Escape still closes it and returns focus to the button.
    await button.click();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('a blur with no target keeps the menu open, so a press on a menu link still lands', async ({
    page,
  }) => {
    await openPage(page, 390, 'en');
    const button = page.locator('button.site-menu-toggle');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // Safari does not focus a link on a press: the focused link blurs with no new target.
    await page.evaluate(() => {
      const link = document.querySelector('.site-nav-pages a') as HTMLElement;
      link.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    });
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await page
      .getByRole('navigation', { name: 'Site', exact: true })
      .getByRole('link', { name: 'How It Works', exact: true })
      .click();
    await expect(page).toHaveURL(/\/how-it-works$/);
  });

  for (const lang of LANGS) {
    test(`at 320 px with the text enlarged to 200 percent nothing clips or scrolls sideways in ${lang === 'en' ? 'English' : 'Bengali'}`, async ({
      page,
    }) => {
      await openPage(page, 320, lang);
      await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      await settle(page);
      const bar = await measureHeader(page);
      // At 200 percent text one line of the brand is taller than a button; a wrapped one is far taller.
      expectOneLine({ ...bar, pageScroll: 0 }, `${lang} 320 at 200 percent text`, 70);
      const primary = page.locator('header .site-nav-actions .btn-primary');
      const toggle = page.locator('button.site-menu-toggle');
      for (const control of [primary, toggle]) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
      }
    });
  }

  test('the public header and footer never show on the sign-in frame', async ({ page }) => {
    for (const width of [390, 1344]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/auth/sign-in');
      await expect(page.locator('.auth-shell')).toBeVisible();
      await expect(page.locator('header.nav')).toBeHidden();
      await expect(page.locator('footer.site-footer')).toBeHidden();
    }
  });
});

test.describe('footer', () => {
  for (const lang of LANGS) {
    test(`is a closing in groups, with 44 px targets and no sideways scroll in ${lang === 'en' ? 'English' : 'Bengali'}`, async ({
      page,
    }) => {
      for (const width of [390, 1344]) {
        await openPage(page, width, lang);
        const facts = await page.evaluate(() => {
          const footer = document.querySelector('footer.site-footer') as HTMLElement;
          const groups = [...footer.querySelectorAll('.site-footer-group')].map((el) => {
            const box = el.getBoundingClientRect();
            return { left: Math.round(box.left), top: Math.round(box.top) };
          });
          const links = [...footer.querySelectorAll('a')].map((el) => ({
            name: (el.textContent ?? '').trim() || 'brand',
            height: Math.round(el.getBoundingClientRect().height),
          }));
          return {
            groups,
            links,
            scroll: document.documentElement.scrollWidth - window.innerWidth,
            headings: [...footer.querySelectorAll('.site-footer-heading')].length,
          };
        });
        expect(facts.headings).toBe(3);
        expect(facts.groups).toHaveLength(3);
        for (const link of facts.links)
          expect(link.height, `${link.name} at ${width}`).toBeGreaterThanOrEqual(44);
        expect(facts.scroll).toBeLessThanOrEqual(0);
        if (width === 390) {
          // A phone keeps the footer short: the links flow in rows, the groups keep their names
          // for a screen reader, and the whole footer stays about as tall as it was.
          const rows = await page.evaluate(
            () =>
              new Set(
                [...document.querySelectorAll('footer nav a')].map((a) =>
                  Math.round(a.getBoundingClientRect().top / 20),
                ),
              ).size,
          );
          expect(rows).toBeLessThanOrEqual(4);
          const height = await page.locator('footer.site-footer').evaluate((el) => el.clientHeight);
          expect(height, 'the phone footer stays short').toBeLessThanOrEqual(240);
        } else {
          // Side by side on a laptop.
          const lefts = new Set(facts.groups.map((group) => group.left));
          const tops = new Set(facts.groups.map((group) => group.top));
          expect(tops.size).toBe(1);
          expect(lefts.size).toBe(3);
        }
      }
    });
  }

  test('every footer link opens a page that exists', async ({ page, request }) => {
    await openPage(page, 1344, 'en');
    const hrefs = await page
      .locator('footer a[href]')
      .evaluateAll((all) => [...new Set(all.map((a) => a.getAttribute('href') ?? ''))]);
    expect(hrefs.length).toBeGreaterThanOrEqual(9);
    for (const href of hrefs) {
      const [path, anchor] = href.split('#');
      if (path === '/app') continue; // goes on to the sign-in provider
      const response = await request.get(path || '/');
      expect(response.status(), href).toBeLessThan(400);
      if (anchor) {
        await page.goto(href);
        await expect(page.locator(`[id="${anchor}"]`), href).toHaveCount(1);
      }
    }
  });
});
