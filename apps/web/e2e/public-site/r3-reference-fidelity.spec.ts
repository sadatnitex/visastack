import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * R3: the public Privacy and Trust page against the owner-approved reference (the "public site, one
 * continuous story" mock, Privacy and Trust page). Six chapters in order: a dark hero "You decide /
 * who sees what." with the timed share sheet; dark "Five promises." with a drawing on each card; dark
 * "Your history, in plain view."; light "What we do. What we do not."; light "Where we are today.";
 * and the closing band. Each chapter is checked, then photographed at a computer size and a phone
 * size so it can be set beside the reference. Set R3_SHOTS_DIR to keep the pictures (default: the
 * test output folder). The reference's own pictures come from the owner's reference mock.
 */

const SIZES = [
  { tag: 'd', width: 1440, height: 900 },
  { tag: 'm', width: 390, height: 844 },
] as const;

const CHAPTERS = [
  { tone: 'dark', title: /^You decide\s*who sees what\.$/ },
  { tone: 'dark', title: /^Five promises\.$/ },
  { tone: 'dark', title: /^Your history,\s*in plain view\.$/ },
  { tone: 'light', title: /^What we do\.\s*What we do not\.$/ },
  { tone: 'light', title: /^Where we are\s*today\.$/ },
  { tone: 'dark', title: /^Private from\s*the first document\.$/ },
] as const;

const env = (name: string): string | undefined => process.env[name];

const chapters = (page: Page) => page.locator('main .pub-chapter');

async function shot(locator: Locator, name: string, tag: string): Promise<void> {
  const dir = env('R3_SHOTS_DIR');
  await locator.scrollIntoViewIfNeeded();
  // The pinned header would sit on top of a tall chapter's picture, so it is hidden for the photograph only.
  await locator.page().evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const position = getComputedStyle(el).position;
      if (position === 'fixed' || position === 'sticky') el.style.visibility = 'hidden';
    }
  });
  const path = dir ? `${dir}/${name}-${tag}.png` : test.info().outputPath(`${name}-${tag}.png`);
  await locator.screenshot({ path });
}

for (const size of SIZES) {
  test.describe(`R3 Privacy and Trust at ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('six chapters in the reference order and tones, no sideways scroll, no empty block', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/trust');
      await expect(chapters(page)).toHaveCount(CHAPTERS.length);
      for (const [index, chapter] of CHAPTERS.entries()) {
        const element = chapters(page).nth(index);
        await expect(element, `chapter ${index + 1} tone`).toHaveAttribute(
          'data-tone',
          chapter.tone,
        );
        await expect(element.locator('h1, h2').first(), `chapter ${index + 1} title`).toHaveText(
          chapter.title,
        );
      }
      await expect(page.getByText('No routes are currently published here.')).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('chapter 1: dark hero with the share sheet and the start links', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/trust');
      const hero = chapters(page).nth(0);
      await expect(
        hero.getByText('Agencies and other people see it only when you share it.'),
      ).toBeVisible();
      await expect(hero.getByRole('link', { name: 'Start with Your Own Profile' })).toHaveAttribute(
        'href',
        '/app',
      );
      // A phone opens on the one start button; the privacy link then sits in chapter 5.
      if (size.width >= 760) {
        await expect(hero.getByRole('link', { name: 'View Privacy Details' })).toHaveAttribute(
          'href',
          '/privacy',
        );
      }
      await expect(
        hero.getByRole('figure', { name: /sharing papers with an agency/i }),
      ).toBeVisible();
      await shot(hero, 'ch1-hero', size.tag);
    });

    test('chapter 2: five promises, each with its own drawing', async ({ page }) => {
      await page.goto('/trust');
      const cards = chapters(page).nth(1).getByRole('listitem');
      await expect(cards).toHaveCount(5);
      for (let index = 0; index < 5; index += 1) {
        await expect(cards.nth(index).locator('svg').first()).toBeVisible();
      }
      await shot(chapters(page).nth(1), 'ch2-promises', size.tag);
    });

    test('chapter 3: the history rows are marked Example', async ({ page }) => {
      await page.goto('/trust');
      const rows = chapters(page).nth(2).getByRole('listitem');
      await expect(rows).toHaveCount(3);
      await expect(chapters(page).nth(2).locator('.pub-example')).toHaveCount(3);
      await shot(chapters(page).nth(2), 'ch3-history', size.tag);
    });

    test('chapter 4: two columns, we do and we do not', async ({ page }) => {
      await page.goto('/trust');
      const limits = chapters(page).nth(3);
      await expect(limits.getByRole('heading', { name: 'We Do', exact: true })).toBeVisible();
      await expect(limits.getByRole('heading', { name: 'We Do Not', exact: true })).toBeVisible();
      await expect(limits.getByText('No approval guarantees.')).toBeVisible();
      await shot(limits, 'ch4-limits', size.tag);
    });

    test('chapter 5: the state of the product, stated plainly', async ({ page }) => {
      await page.goto('/trust');
      const today = chapters(page).nth(4);
      await expect(today.getByText('VisaStack is in a controlled pilot.')).toBeVisible();
      await shot(today, 'ch5-today', size.tag);
    });

    test('chapter 6: closing band with the passport and the start link', async ({ page }) => {
      await page.goto('/trust');
      const closing = chapters(page).nth(5);
      await expect(
        closing.getByRole('link', { name: 'Start with Your Own Profile' }),
      ).toHaveAttribute('href', '/app');
      await shot(closing, 'ch6-closing', size.tag);
    });
  });
}

test.describe('R3 hero motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the looping share sheet has a visible Pause button that stops it (WCAG 2.2.2)', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/trust');
    const pause = page.getByRole('button', { name: 'Pause the Animation' });
    await expect(pause).toBeVisible();
    const box = await pause.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await pause.click();
    const sheet = page.locator('.tr-share-live .kit-sheet');
    await expect(sheet).toHaveAttribute('data-kit-step', '4');
    // Still stopped after more than two full ticks of the loop.
    // This proves something does NOT change, so it waits a fixed time: more than two loop ticks.
    await page.waitForTimeout(2600);
    await expect(sheet).toHaveAttribute('data-kit-step', '4');
    await expect(page.getByRole('button', { name: 'Play the Animation' })).toBeVisible();
  });

  test('with reduced motion the hero plays gently: Pause exists, stops it on the finished step, Play resumes', async ({
    page,
  }) => {
    // Owner, 18 Nov 2026: reduced motion gets gentle fading, not stillness (ADR 0029 amendment).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Note when the shown step changes (every 50 ms is far finer than the 2.2 s pace).
    await page.addInitScript(() => {
      const w = window as unknown as { __changes: number[] };
      w.__changes = [];
      let last = '';
      setInterval(() => {
        const now =
          document.querySelector('.tr-share-live .kit-sheet')?.getAttribute('data-kit-step') ?? '';
        if (now !== '' && now !== last) {
          if (last !== '') w.__changes.push(Date.now());
          last = now;
        }
      }, 50);
    });
    await page.goto('/trust');
    const pause = page.getByRole('button', { name: 'Pause the Animation' });
    await expect(pause).toBeVisible();
    const box = await pause.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const sheet = page.locator('.tr-share-live .kit-sheet');
    // It plays: the step moves on by itself (an attribute condition, never a fixed time).
    await expect(sheet).not.toHaveAttribute('data-kit-step', '0', { timeout: 6000 });
    // No more than three changes in any second.
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => (window as unknown as { __changes: number[] }).__changes))
            .length,
        { timeout: 8000 },
      )
      .toBeGreaterThanOrEqual(3);
    const changes = await page.evaluate(
      () => (window as unknown as { __changes: number[] }).__changes,
    );
    for (let at = 0; at + 3 < changes.length; at++)
      expect((changes[at + 3] ?? 0) - (changes[at] ?? 0)).toBeGreaterThanOrEqual(1000);
    await pause.click();
    await expect(sheet).toHaveAttribute('data-kit-step', '4');
    const play = page.getByRole('button', { name: 'Play the Animation' });
    await expect(play).toBeVisible();
    await play.click();
    await expect(sheet).toHaveAttribute('data-kit-step', '0');
    await expect(page.getByRole('button', { name: 'Pause the Animation' })).toBeVisible();
  });
});

test.describe('R3 phone page length', () => {
  // Six screens of 844 px, the budget the page has held since WP-SB8. Bengali words run longer.
  const BUDGET = 6 * 844;

  for (const locale of ['en', 'bn'] as const) {
    test(`the page fits six phone screens in ${locale === 'en' ? 'English' : 'Bengali'}`, async ({
      page,
    }) => {
      // The switch sits in the header on a computer and in the menu on a phone, so the choice is made
      // at a computer size and the page is then measured at the phone size.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/trust');
      if (locale === 'bn') {
        // The visitor's own choice through the language switch, never a cookie set by the test.
        await page.locator('.lang-switch').click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-locale', locale);
      await page.setViewportSize({ width: 390, height: 844 });
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(height, `${locale} page height`).toBeLessThanOrEqual(BUDGET);
    });
  }
});
