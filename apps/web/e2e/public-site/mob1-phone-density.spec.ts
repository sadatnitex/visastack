import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * WP-MOB1 (owner, 19 Nov 2026): the Home page on a phone says the same story in about four screens.
 * Below 760 px: one main button and a text link, the passport alone, steps in one row and two
 * fields, four papers with See All 8, two share rows, rules in one swipe row, one line for
 * agencies, one Example tag per chapter, "Completeness only" once, and one bottom action that shows
 * after the first screen and leaves for the closing call. A computer (1280 and 1440 wide) draws what
 * it drew before: every rule here sits inside a max-width 759px query.
 */

const PHONES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
] as const;

const COMPUTERS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

/** Reads a setting by name (the bracket form both the compiler and the linter accept). */
function env(name: string): string | undefined {
  return process.env[name];
}

/** Waits for the page to start in the browser: the See All button only appears after that. */
async function openHome(page: Page, hydrated = true): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#hs-hero-title')).toBeVisible();
  if (hydrated) await page.locator('.hs-more').first().waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle');
}

/** Walks the page once so scroll-driven parts reach their finished state, then returns to the top. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight / 2));
    const end = document.documentElement.scrollHeight;
    for (let y = 0; y <= end; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(600);
}

async function scrollToId(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => {
    document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, id);
}

/** Visible means drawn: not display none, not hidden, not see-through. */
async function visibleCount(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll(sel)).filter((el) =>
        el.checkVisibility({ checkVisibilityCSS: true }),
      ).length,
    selector,
  );
}

for (const size of PHONES) {
  test.describe(`Home on a phone, ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('hero: one main button, one text link, the passport alone, no pill, no ring, no fan', async ({
      page,
    }) => {
      await openHome(page);
      const hero = page.locator('#hs-hero');
      await expect(hero.locator('a.pub-button-primary')).toBeVisible();
      await expect(hero.locator('a.pub-button-secondary')).toBeVisible();
      expect(await visibleCount(page, '#hs-hero a.pub-button')).toBe(2);
      await expect(hero.locator('.hs-phone-passport')).toBeVisible();
      await expect(hero.locator('.kit-deck')).toBeHidden();
      await expect(hero.locator('.hs-hero-cap')).toBeHidden();
      await expect(hero.locator('.hs-nudge')).toBeHidden();
      // The second button reads as a text link: no frame of its own.
      const border = await hero
        .locator('a.pub-button-secondary')
        .evaluate((el) => getComputedStyle(el).borderTopColor);
      expect(border).toBe('rgba(0, 0, 0, 0)');
      expect(await visibleCount(page, '#hs-hero .pub-example')).toBe(1);
    });

    test('add it once: three steps in one row and two fields', async ({ page }) => {
      await openHome(page);
      const tops = await page
        .locator('.hs-step-num')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(tops).toHaveLength(3);
      expect(new Set(tops).size).toBe(1);
      expect(await visibleCount(page, '#how-it-works .kit-field')).toBe(2);
      const text = await page.locator('#how-it-works .kit-phone-note').innerText();
      expect(text.replace(/\s+/g, ' ').trim().toLowerCase()).toBe('example');
    });

    test('ready: four papers, See All 8 opens the rest in place, See All is a real toggle', async ({
      page,
    }) => {
      await openHome(page);
      const rows = '#capabilities .kit-row';
      const button = page.locator('#capabilities .hs-more-button');
      await expect(button).toBeVisible();
      await expect(button).toHaveText('See All 8');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(await visibleCount(page, rows)).toBe(4);
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(await visibleCount(page, rows)).toBe(8);
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(await visibleCount(page, rows)).toBe(4);
    });

    test('the journey starts on Getting Started', async ({ page }) => {
      await openHome(page);
      const scene = page.locator('.pub-scene[data-scene="journey"]');
      await expect(scene).toHaveAttribute('data-rest', '0');
      await expect(scene).toHaveAttribute('data-play-to', '6');
    });

    test('share: two rows, Passport and Photo', async ({ page }) => {
      await openHome(page);
      expect(await visibleCount(page, '.kit-share-row')).toBe(2);
      const names = await page
        .locator('.kit-share-row')
        .evaluateAll((els) =>
          els
            .filter((el) => el.checkVisibility())
            .map((el) => el.querySelector('b')?.textContent ?? ''),
        );
      expect(names).toEqual(['Passport', 'Photo']);
    });

    test('rules: three cards in one swipe row, the next card peeking, no page scroll sideways', async ({
      page,
    }) => {
      await openHome(page);
      await scrollToId(page, 'sources');
      const row = page.locator('.hs-swipe');
      const m = await row.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        overflowX: getComputedStyle(el).overflowX,
        tabindex: el.getAttribute('tabindex'),
        role: el.getAttribute('role'),
      }));
      expect(m.overflowX).toBe('auto');
      expect(m.scroll).toBeGreaterThan(m.client);
      // Keyboard reachable: it takes focus because it really scrolls.
      expect(m.tabindex).toBe('0');
      expect(m.role).toBe('group');
      const cards = await page
        .locator('.hs-card')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
      expect(cards).toHaveLength(3);
      const first = cards[0];
      const second = cards[1];
      const third = cards[2];
      expect(first && second && third).toBeTruthy();
      if (!first || !second || !third) return;
      expect(first.left).toBeGreaterThanOrEqual(0);
      expect(first.right).toBeLessThan(size.width);
      // The next card shows at least 40 px and not all of it.
      expect(second.left).toBeLessThan(size.width - 40);
      expect(second.right).toBeGreaterThan(size.width);
      expect(third.left).toBeGreaterThanOrEqual(size.width);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBeLessThanOrEqual(0);
      // The arrow keys reach the other cards.
      await row.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    });

    test('agencies: one line and the button, no cases list', async ({ page }) => {
      await openHome(page);
      const copy = (await page.locator('#for-agencies .kit-sub').innerText()).trim();
      expect(copy).toBe('Clients keep their own record.');
      await expect(page.locator('#for-agencies .hs-cases')).toBeHidden();
      await expect(page.locator('#for-agencies a.pub-button')).toBeVisible();
    });

    test('one Example tag per chapter and Completeness only once', async ({ page }) => {
      await openHome(page);
      const perChapter = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.hs .pub-chapter')).map((chapter) => ({
          id: chapter.id || chapter.querySelector('h1, h2')?.textContent?.slice(0, 18) || '?',
          tags: Array.from(chapter.querySelectorAll('.pub-example')).filter((el) =>
            el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          ).length,
        })),
      );
      for (const chapter of perChapter) {
        expect(chapter.tags, JSON.stringify(perChapter)).toBeLessThanOrEqual(1);
      }
      // The agencies chapter shows no example at all on a phone (the cases list is not shown).
      expect(perChapter.filter((c) => c.tags === 1)).toHaveLength(perChapter.length - 1);
      const mentions = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('.hs *')).filter(
            (el) =>
              el.children.length === 0 &&
              (el.textContent ?? '').includes('Completeness only') &&
              el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          ).length,
      );
      expect(mentions).toBe(1);
    });

    test('measures: about four screens and about 250 words', async ({ page }, info) => {
      await openHome(page);
      const m = await page.evaluate(() => {
        const hs = document.querySelector('.hs') as HTMLElement;
        const top = hs.getBoundingClientRect().top + window.scrollY;
        const words = hs.innerText.split(/\s+/).filter(Boolean).length;
        return { height: hs.scrollHeight, top, words };
      });
      const screens = m.height / size.height;
      info.annotations.push({
        type: 'measure',
        description: `${size.width}x${size.height}: ${m.words} words, ${screens.toFixed(2)} screens (${m.height}px)`,
      });
      expect(m.words).toBeLessThanOrEqual(300);
      expect(screens).toBeLessThanOrEqual(size.width === 360 ? 5 : 4.6);
    });
  });
}

test.describe('Home on a phone: the bottom action', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows after the first screen, stays through agencies, leaves for the closing call and footer', async ({
    page,
  }) => {
    await openHome(page);
    const bar = page.locator('.hs-bar');
    await expect(bar).toBeHidden();
    await scrollToId(page, 'how-it-works');
    await expect(bar).toHaveAttribute('data-shown', 'true');
    await expect(bar).toBeVisible();
    const link = bar.locator('a.pub-button-primary');
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await link.getAttribute('href')).toBe(
      await page.locator('#hs-hero a.pub-button-primary').getAttribute('href'),
    );
    await scrollToId(page, 'capabilities');
    await expect(bar, 'capabilities').toHaveAttribute('data-shown', 'true');
    // The rules chapter with the closing call still below the screen.
    await page.evaluate(() => {
      const rules = document.getElementById('sources');
      if (!rules) return;
      const top = rules.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - window.innerHeight * 0.5, behavior: 'instant' });
    });
    await expect(bar, 'sources').toHaveAttribute('data-shown', 'true');
    // The agencies chapter is 190 px tall: with it fully on screen above the closing call, the bar
    // is still there; one more scroll and the closing call arrives and the bar leaves.
    await page.evaluate(() => {
      const agencies = document.getElementById('for-agencies');
      if (!agencies) return;
      const top = agencies.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - (window.innerHeight - 260), behavior: 'instant' });
    });
    await expect(bar, 'agencies').toHaveAttribute('data-shown', 'true');
    await scrollToId(page, 'start');
    await expect(bar).toHaveAttribute('data-shown', 'false');
    await expect(bar).toBeHidden();
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }));
    await expect(bar).toHaveAttribute('data-shown', 'false');
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expect(bar).toHaveAttribute('data-shown', 'false');
  });

  test('keeps the safe area below the button and never covers a focused control', async ({
    page,
  }) => {
    await openHome(page);
    const padding = await page
      .locator('.hs-bar')
      .evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(Number.parseFloat(padding)).toBeGreaterThanOrEqual(8);
    const covered: string[] = [];
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(120);
      const hit = await page.evaluate(() => {
        const bar = document.querySelector('.hs-bar');
        const active = document.activeElement;
        if (!bar || !active || active === document.body || bar.contains(active)) return null;
        if (bar.getAttribute('data-shown') !== 'true') return null;
        const b = bar.getBoundingClientRect();
        const a = active.getBoundingClientRect();
        const overlap =
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 &&
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1;
        return overlap
          ? `${active.tagName}.${active.className} ${active.textContent?.slice(0, 20)}`
          : null;
      });
      if (hit) covered.push(hit);
    }
    expect(covered).toEqual([]);
  });

  test('with reduced motion the bar only fades', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await openHome(page);
    const bar = page.locator('.hs-bar');
    const hidden = await bar.evaluate((el) => {
      const s = getComputedStyle(el);
      return { transform: s.transform, property: s.transitionProperty };
    });
    expect(hidden.transform).toBe('none');
    expect(hidden.property).not.toContain('transform');
    await scrollToId(page, 'how-it-works');
    await expect(bar).toHaveAttribute('data-shown', 'true');
    const shown = await bar.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(shown).not.toContain('transform');
    await context.close();
  });

  test('with live motion the hidden bar waits below the edge', async ({ page }) => {
    await openHome(page);
    const transform = await page
      .locator('.hs-bar')
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform).not.toBe('none');
  });
});

/** Words must never overlap, be cut off or push the page sideways (extends HOT1 to 412 and the bar). */
async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const boxes: { el: Element; text: string; r: DOMRect }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!text || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      if (
        !el.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        })
      )
        continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      // Words read aloud but not drawn (clipped to nothing) are not on screen.
      let drawn = true;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        // Fixed and sticky parts (the header, the bottom action) lie over the page by design.
        if (['fixed', 'sticky'].includes(style.position)) {
          drawn = false;
          break;
        }
        if (style.clipPath.startsWith('inset(50%') || style.clip === 'rect(0px, 0px, 0px, 0px)') {
          drawn = false;
          break;
        }
      }
      if (!drawn) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 1 || r.height < 1) continue;
        boxes.push({ el, text, r });
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b || a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 1 && h > 1) problems.push(`"${a.text.slice(0, 24)}" over "${b.text.slice(0, 24)}"`);
      }
    }
    for (const { el, text, r } of boxes) {
      for (
        let node = el.parentElement;
        node && node !== document.documentElement;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        if (['auto', 'scroll'].includes(style.overflowX)) break;
        if (!['hidden', 'clip'].includes(style.overflowX)) continue;
        const c = node.getBoundingClientRect();
        if (r.left < c.left - 1 || r.right > c.right + 1) {
          problems.push(`"${text.slice(0, 24)}" cut off by ${node.className}`);
          break;
        }
      }
    }
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollWidth > window.innerWidth) problems.push(`sideways ${root.scrollWidth}`);
    return problems;
  });
}

for (const size of PHONES) {
  for (const motion of ['no-preference', 'reduce'] as const) {
    test.describe(`Home overlaps on a phone, ${size.width}x${size.height}, motion ${motion}`, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        contextOptions: { reducedMotion: motion },
      });

      test('no words overlap, none are cut off, nothing scrolls sideways, also with the papers opened', async ({
        page,
      }) => {
        await openHome(page);
        await settle(page);
        expect(await overlaps(page), 'collapsed').toEqual([]);
        await page.locator('#capabilities .hs-more-button').click();
        expect(await overlaps(page), 'opened').toEqual([]);
      });
    });
  }
}

for (const size of [PHONES[0], PHONES[1]]) {
  test.describe(`Home accessibility on a phone, ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('no serious or critical problem, in English and (where the preview runs) Bengali', async ({
      page,
    }) => {
      for (const lang of ['en', 'bn'] as const) {
        if (lang === 'bn') {
          // Ask for Bengali the way a visitor does: the language form (on a phone it sits in the closed
          // menu, so it is submitted directly). The server honours it only in a local preview, so in
          // the ordinary run this repeats the English check.
          await page.goto('/');
          await page.evaluate(() => {
            const form = document.querySelector('form:has(input[name="locale"][value="bn"])');
            if (form instanceof HTMLFormElement) form.requestSubmit();
          });
          await page.waitForLoadState('networkidle');
        }
        await openHome(page);
        // With the bar showing, and the opened papers, so every state is checked.
        await page.locator('#capabilities .hs-more-button').click();
        // The rules chapter in the middle of the screen: the bar shows and the closing call is below.
        await page.evaluate(() => {
          const rules = document.getElementById('sources');
          if (!rules) return;
          const top = rules.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({ top: top - window.innerHeight * 0.5, behavior: 'instant' });
        });
        await expect(page.locator('.hs-bar')).toHaveAttribute('data-shown', 'true');
        // Let the fades and rises come to rest: the contrast check reads the colours as drawn.
        await page.waitForTimeout(1500);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        const blocking = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious' || v.id.startsWith('valid-lang'),
        );
        expect(blocking, `${lang}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
        if (lang === 'bn') {
          const bengali = (await page.locator('html').getAttribute('data-locale')) === 'bn';
          if (bengali) {
            await expect(page.locator('#capabilities .hs-more-button')).toContainText(/দেখুন|দেখান/);
            // Bengali is longer than English: still no overlap at this width.
            expect(await overlaps(page), 'bn').toEqual([]);
          }
        }
      }
    });

    test('every control on the page is 44 px or more, the bar and See All included', async ({
      page,
    }) => {
      await openHome(page);
      await scrollToId(page, 'sources');
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.hs a, .hs button, .hs-bar a'))
          .filter((el) => el.checkVisibility({ checkVisibilityCSS: true }))
          .map((el) => ({
            name: (el.textContent ?? '').trim().slice(0, 24),
            h: el.getBoundingClientRect().height,
          }))
          .filter((x) => x.h < 43.5),
      );
      expect(small).toEqual([]);
    });
  });
}

for (const size of COMPUTERS) {
  test.describe(`Home on a computer is unchanged, ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('nothing made for phones shows, nothing the computer had is trimmed', async ({ page }) => {
      await openHome(page);
      for (const sel of ['.hs-bar', '.hs-phone-passport', '.hs .hs-more-button']) {
        expect(await visibleCount(page, sel), sel).toBe(0);
      }
      expect(await visibleCount(page, '.kit-deck')).toBe(1);
      expect(await visibleCount(page, '.hs-hero-cap')).toBeGreaterThanOrEqual(1);
      expect(await visibleCount(page, '.kit-share-row')).toBe(3);
      expect(await visibleCount(page, '#capabilities .kit-row')).toBe(8);
      expect(await visibleCount(page, '.hs-cases')).toBe(1);
      expect(await visibleCount(page, '.hs-wide-only')).toBe(2);
      expect(await visibleCount(page, '.hs-nudge')).toBe(1);
      expect(await visibleCount(page, '#how-it-works .kit-field')).toBe(3);
      const swipe = await page.locator('.hs-swipe').evaluate((el) => ({
        display: getComputedStyle(el).display,
        tabindex: el.getAttribute('tabindex'),
      }));
      expect(swipe).toEqual({ display: 'contents', tabindex: null });
      const columns = await page
        .locator('.hs-cards')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(3);
      const agencies = (await page.locator('#for-agencies .kit-sub').innerText()).trim();
      expect(agencies).toBe(
        'Clients keep their own record. You see only what they share, and who is missing what.',
      );
    });

    // Byte-exact proof against a build of main. Run once with MOB1_BASELINE_MODE=write against main
    // and once with MOB1_BASELINE_MODE=compare against this branch (MOB1_BASELINE_DIR holds the files).
    test('pixels are identical to main (when a baseline is given)', async ({ page }) => {
      const mode = env('MOB1_BASELINE_MODE');
      const dir = env('MOB1_BASELINE_DIR');
      test.skip(!mode || !dir, 'needs MOB1_BASELINE_MODE and MOB1_BASELINE_DIR');
      if (!mode || !dir) return;
      mkdirSync(dir, { recursive: true });
      await openHome(page, false);
      await page.evaluate(async () => {
        const end = document.documentElement.scrollHeight;
        for (let y = 0; y <= end; y += 300) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const stops = Math.ceil(total / size.height);
      const different: string[] = [];
      for (let i = 0; i < stops; i++) {
        await page.evaluate(
          (y) => window.scrollTo({ top: y, behavior: 'instant' }),
          i * size.height,
        );
        await page.waitForTimeout(400);
        const shot = await page.screenshot({ animations: 'disabled' });
        const file = join(dir, `${size.width}x${size.height}-${String(i).padStart(2, '0')}.png`);
        if (mode === 'write') writeFileSync(file, shot);
        else if (!existsSync(file) || !readFileSync(file).equals(shot)) different.push(file);
      }
      expect(different).toEqual([]);
    });
  });
}
