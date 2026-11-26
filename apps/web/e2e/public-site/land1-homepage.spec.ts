import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * LAND1: the approved homepage (Harbor Blue folio, owner 26 Nov 2026), measured on the built page.
 * It replaces the checks of the retired scroll story and its eight chapters (pub2-home, R1
 * fidelity, MOB1 phone density), keeping their route, responsive, accessibility, privacy and
 * performance assertions: nothing scrolls sideways, no serious accessibility problem, every control
 * is a sensible target, nothing loads from another site or breaks the page policy, and the first
 * screen is the hero with its planner.
 */

const SIZES = [
  { name: 'small phone', width: 360, height: 740 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const html = (page: Page) => page.locator('html');

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function openHome(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.locator('#lp-title')).toBeVisible();
  await settle(page);
}

for (const size of SIZES) {
  test.describe(`Home at ${size.name} ${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => openHome(page, size.width, size.height));

    test('never scrolls sideways and has one top heading in one main landmark', async ({
      page,
    }) => {
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBeLessThanOrEqual(0);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('main')).toHaveCount(1);
    });

    test('has no serious or critical accessibility problem', async ({ page }) => {
      const results = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });

    test('keeps buttons and fields at 44 px, and every other link at 24 px or more', async ({
      page,
    }) => {
      const small = await page.evaluate(() => {
        const found: string[] = [];
        for (const el of document.querySelectorAll(
          'main a, main button, main select, main summary',
        )) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          // A link inside a sentence is exempt from the target size (WCAG 2.5.8, inline exception).
          if (el.matches('a') && el.closest('.lp-faq p')) continue;
          const kind = el.matches('.lp-button, button, select, summary') ? 44 : 24;
          if (Math.round(box.height) < kind)
            found.push(
              `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.height)}px`,
            );
        }
        return found;
      });
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
        if (new URL(request.url()).origin !== own) foreign.push(request.url());
      });
      page.on('console', (message) => {
        if (/Content Security Policy|hydrat/i.test(message.text())) refused.push(message.text());
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) =>
          console.error(`Content Security Policy refused ${event.violatedDirective}`),
        );
      });
      await page.goto('/');
      await settle(page);
      expect(foreign).toEqual([]);
      expect(refused).toEqual([]);
    });
  });
}

test.describe('the first screen', () => {
  test('is the hero: Bangladesh promise, headline, the labelled planner, the folio and its caption', async ({
    page,
  }) => {
    await openHome(page, 1440, 900);
    await expect(page.getByText('For travellers applying from Bangladesh')).toBeVisible();
    await expect(page.locator('#lp-title')).toContainText('Your visa paperwork, in order.');
    await expect(page.getByLabel('Where are you going?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'See My First Steps' })).toBeInViewport({
      ratio: 1,
    });
    await expect(page.locator('.lp-photo-caption')).toHaveText(
      'One record for this trip and the next.',
    );
  });

  test('keeps the planner in view on a phone and on short laptop windows', async ({ page }) => {
    for (const [width, height] of [
      [390, 844],
      [360, 740],
      [1280, 720],
      [1024, 700],
    ] as const) {
      await openHome(page, width, height);
      await expect(
        page.getByRole('button', { name: 'See My First Steps' }),
        `${width}x${height}`,
      ).toBeInViewport({ ratio: 1 });
    }
  });

  test('draws the folio from this site, sized, decorative and first in line, with no layout shift', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{
          value: number;
          hadRecentInput: boolean;
        }>)
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    for (const [width, height] of [
      [390, 844],
      [1440, 900],
    ] as const) {
      await openHome(page, width, height);
      const picture = page.locator('.lp-photo img');
      await expect(picture).toHaveAttribute('alt', '');
      await expect(picture).toHaveAttribute('fetchpriority', 'high');
      await expect(picture).toHaveAttribute('width', '1100');
      await expect(picture).toHaveAttribute('height', '1375');
      const facts = await picture.evaluate((img: HTMLImageElement) => ({
        loaded: img.complete && img.naturalWidth > 0,
        src: img.currentSrc,
      }));
      expect(facts.loaded, 'the folio is loaded').toBe(true);
      expect(new URL(facts.src).pathname).toBe('/_next/image');
      // The one preload in the head is the folio's.
      await expect(page.locator('link[rel="preload"][as="image"]')).toHaveCount(1);
      // It fills its frame without being squashed.
      const fit = await picture.evaluate((img) => getComputedStyle(img).objectFit);
      expect(fit).toBe('cover');
    }
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.05);
  });
});

test.describe('the destination planner', () => {
  test('opens a general plan for the chosen destination, with Myself and My Family', async ({
    page,
  }) => {
    await openHome(page);
    const plan = page.locator('section.lp-start');
    await expect(plan).toBeHidden();
    await page.getByLabel('Where are you going?').selectOption('Japan');
    await page.getByRole('button', { name: 'See My First Steps' }).click();
    await expect(plan).toBeVisible();
    const heading = page.getByRole('heading', { name: 'Getting ready for Japan' });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(plan.getByRole('link', { name: 'Find Japan in Country Guides' })).toHaveAttribute(
      'href',
      '/countries?q=Japan',
    );
    const mine = plan.getByRole('button', { name: 'Myself' });
    const family = plan.getByRole('button', { name: 'My Family' });
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await expect(plan.getByText('Check your saved copies')).toBeVisible();
    await family.click();
    await expect(family).toHaveAttribute('aria-pressed', 'true');
    await expect(mine).toHaveAttribute('aria-pressed', 'false');
    await expect(plan.getByText('Check each traveller’s copies')).toBeVisible();
    await expect(plan.getByText('Check your saved copies')).toHaveCount(0);
    await expect(plan.getByRole('status')).toHaveText('Family preparation steps shown.');
    await mine.click();
    await expect(plan.getByRole('status')).toHaveText('Individual preparation steps shown.');
  });

  test('works from the keyboard alone', async ({ page }) => {
    await openHome(page);
    await page.getByLabel('Where are you going?').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'See My First Steps' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 2, name: /^Getting ready for / }),
    ).toBeFocused();
  });

  test('carries a country with a space in its name to the guides, and the guides search finds it', async ({
    page,
  }) => {
    await openHome(page);
    await page.getByLabel('Where are you going?').selectOption('United Kingdom');
    await page.getByRole('button', { name: 'See My First Steps' }).click();
    const guide = page.getByRole('link', { name: 'Find United Kingdom in Country Guides' });
    await expect(guide).toHaveAttribute('href', '/countries?q=United%20Kingdom');
    await guide.click();
    await expect(page).toHaveURL(/\/countries\?q=United(%20|\+)Kingdom$/);
    await expect(page.locator('input[name="q"]')).toHaveValue('United Kingdom');
    // The browser's own Back returns to Home.
    await page.goBack();
    await expect(page.locator('#lp-title')).toBeVisible();
  });

  test('refuses an empty choice and opens nothing', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'See My First Steps' }).click();
    await expect(page.locator('section.lp-start')).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

  test('stays calm with reduced motion: the plan appears without a smooth scroll', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('Where are you going?').selectOption('Singapore');
    await page.getByRole('button', { name: 'See My First Steps' }).click();
    await expect(page.getByRole('heading', { name: 'Getting ready for Singapore' })).toBeFocused();
    const moving = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    );
    expect(moving).toBe(0);
    await context.close();
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('is a plain form to the country guides, and the whole page reads', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#lp-title')).toBeVisible();
      await expect(page.locator('section.lp-start')).toBeHidden();
      await page.getByLabel('Where are you going?').selectOption('United Kingdom');
      await page.getByRole('button', { name: 'See My First Steps' }).click();
      await expect(page).toHaveURL(/\/countries\?q=United(%20|\+)Kingdom$/);
      await expect(page.locator('input[name="q"]')).toHaveValue('United Kingdom');
    });

    test('keeps its accordions working (they are plain disclosures)', async ({ page }) => {
      await page.goto('/');
      const first = page.locator('.lp-faq-items details').first();
      await first.locator('summary').click();
      await expect(first).toHaveAttribute('open', '');
    });
  });
});

test.describe('menus and anchors', () => {
  test('the How It Works menu opens from its button, closes on Escape with focus back, and on a press outside', async ({
    page,
  }) => {
    await openHome(page);
    const toggle = page.getByRole('button', { name: 'How It Works', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.locator('header').getByRole('link', { name: /^Prepare a Case/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.locator('#lp-title').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('choosing an entry closes the menu and lands on that part of the page', async ({ page }) => {
    await openHome(page);
    const toggle = page.getByRole('button', { name: 'How It Works', exact: true });
    await toggle.click();
    await page
      .locator('header')
      .getByRole('link', { name: /^Your Reusable Record/ })
      .click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page).toHaveURL(/#your-record$/);
    await expect(page.locator('#your-record')).toBeInViewport({ ratio: 0.3 });
    // The sticky bar does not cover the heading it landed on.
    const heading = await page.locator('#lp-record-title').boundingBox();
    const bar = await page.locator('header.nav').boundingBox();
    expect(heading?.y ?? 0).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0) - 1);
  });

  test('every inbound anchor lands on its section', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const id of [
      'prepare',
      'your-record',
      'for-agencies',
      'questions',
      'how-it-works',
      'capabilities',
      'sources',
      'start',
      'planner',
    ]) {
      await page.goto('about:blank');
      await page.goto(`/#${id}`);
      await expect(page.locator(`#${id}`), id).toBeInViewport({ ratio: 0.1 });
    }
  });

  test('the phone menu opens the same places', async ({ page }) => {
    await openHome(page, 390, 844);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .locator('header')
      .getByRole('link', { name: 'Common Questions', exact: true })
      .click();
    await expect(page).toHaveURL(/#questions$/);
    await expect(page.locator('#questions')).toBeInViewport({ ratio: 0.2 });
  });

  test('the closing action returns to the planner', async ({ page }) => {
    await openHome(page);
    await page.getByRole('link', { name: 'Choose a Destination' }).click();
    await expect(page).toHaveURL(/#planner$/);
    await expect(page.locator('#planner')).toBeInViewport();
  });
});

test.describe('accordions', () => {
  test('the case shows one item at a time, the questions open independently', async ({ page }) => {
    await openHome(page);
    const items = page.locator('.lp-case details');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute('open', '');
    await items.nth(1).locator('summary').click();
    await expect(items.nth(1)).toHaveAttribute('open', '');
    await expect(items.nth(0)).not.toHaveAttribute('open', '');
    const questions = page.locator('.lp-faq-items details');
    await expect(questions).toHaveCount(5);
    await questions.nth(0).locator('summary').click();
    await questions.nth(1).locator('summary').click();
    await expect(questions.nth(0)).toHaveAttribute('open', '');
    await expect(questions.nth(1)).toHaveAttribute('open', '');
    // From the keyboard: a summary opens on Enter and on Space.
    await questions.nth(2).locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(questions.nth(2)).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(questions.nth(2)).not.toHaveAttribute('open', '');
  });
});

test.describe('words and states', () => {
  test('says the product state once in the row, once in the answer, and the notice at the foot', async ({
    page,
  }) => {
    await openHome(page);
    // textContent, because the answer sits in a closed disclosure.
    const text = ((await page.locator('main').textContent()) ?? '').replace(/\s+/g, ' ');
    const beta = text.includes('Registration is open for public beta');
    if (beta) {
      expect(text).toContain('VisaStack is in public beta');
      expect(text).not.toContain('Real applicant details are not accepted yet');
    } else {
      expect(text).toContain('VisaStack is in a controlled pilot');
      expect(text).toContain('Use sample data during the controlled pilot.');
      expect(text).toContain('Real applicant details are not accepted yet');
    }
    // The visa is the authority's to give.
    expect(text).toContain(
      'The issuing authority sets the official requirements and decides your application.',
    );
  });

  test('has no link to the design studio', async ({ page }) => {
    await openHome(page);
    await expect(page.getByText('Compare designs')).toHaveCount(0);
    await expect(page.locator('a[href="/record/"]')).toHaveCount(0);
  });

  test('keeps the sign-in notice a way forward, not a dead end', async ({ page }) => {
    await page.goto('/?auth_error=ref-1234');
    const alert = page.locator('p.lp-alert');
    await expect(alert).toContainText('Sign-in didn’t complete');
    await expect(alert).toContainText('ref-1234');
    await expect(page.locator('#lp-title')).toBeVisible();
  });

  for (const [width, height] of [
    [360, 740],
    [1024, 768],
    [1440, 900],
  ] as const) {
    test(`reads in Bengali without a break at ${width}x${height}`, async ({ page }) => {
      await openHome(page, width, height);
      const bar = page.locator('.lang-switch');
      if (await bar.isVisible()) await bar.click();
      else {
        await page.locator('button.site-menu-toggle').click();
        await page.locator('.menu-lang').click();
      }
      await expect(html(page)).toHaveAttribute('data-locale', 'bn');
      await settle(page);
      await expect(page.locator('#lp-title')).toBeVisible();
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBeLessThanOrEqual(0);
      // No raw catalogue key ever reaches a reader.
      expect(await page.locator('body').innerText()).not.toMatch(/home\.(page|layout)\./);
    });
  }
});

test('the page is still: nothing on it animates or is pinned', async ({ page }) => {
  await openHome(page, 1440, 900);
  expect(await page.locator('[data-scene]').count()).toBe(0);
  const running = await page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === 'running').length,
  );
  expect(running).toBe(0);
  await expect(page.locator('header.nav')).toHaveCSS('position', 'sticky');
});
