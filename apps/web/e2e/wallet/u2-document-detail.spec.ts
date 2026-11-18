import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import { GUARD_SIZES, coveredControls, runLayoutGuards } from '../support/layout-guards';

/**
 * WAL2: the opened document (hero card, details in sections, Check What We Found as compact rows
 * with one-at-a-time review and an accept bar) on the real stylesheet, at 390, 400 and 1280 wide.
 * The fixture is the real component tree with made-up data; server actions are stood in.
 */

const FIXTURE = 'wal2-document-detail';
const mount = (page: Page, open = false) =>
  renderFixture(page, FIXTURE, { open }, { standInServerActions: true });
/**
 * On a phone the opened document is a full-screen dialog over the page, so the page behind it is
 * covered on purpose; every control inside the opened document is checked.
 */
const SHEET = { within: '.wallet-selected-document' } as const;

test.describe('WAL2 layout guards', () => {
  for (const open of [false, true]) {
    for (const motion of ['no-preference', 'reduce'] as const) {
      test(`sections ${open ? 'open' : 'closed'}, ${motion} motion: no sideways scroll, nothing covers a control`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: motion });
        await runLayoutGuards(
          page,
          async () => {
            await mount(page, open);
          },
          SHEET,
        );
      });
    }
  }

  test('with every detail card open: nothing covers Save, a date box or Accept', async ({
    page,
  }) => {
    await runLayoutGuards(
      page,
      async () => {
        await mount(page, true);
        // Open each row's card (Check), so every Accept, Skip and value box is in the flow.
        for (const summary of await page
          .locator('.finding-row-section > details > summary')
          .all()) {
          await summary.click();
        }
        await page.locator('.finding-masked > details > summary').first().click();
      },
      SHEET,
    );
  });
});

test.describe('WAL2 the Profile page review card', () => {
  test('connected app suggestions with a difference: no sideways scroll, nothing covers a control', async ({
    page,
  }) => {
    await runLayoutGuards(page, async () => {
      await renderFixture(page, FIXTURE, { view: 'profile' }, { standInServerActions: true });
      await expect(page.locator('.finding-choice-tiles > label').first()).toBeVisible();
    });
  });
});

test.describe('WAL2 the opened document', () => {
  for (const size of GUARD_SIZES) {
    test(`${size.width} px: the hero card leads, with its states and buttons`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await mount(page);
      const hero = page.locator('.doc-hero');
      await expect(hero).toBeVisible();
      await expect(hero.locator('.doc-hero-name')).toHaveText('Example Passport');
      await expect(hero.getByRole('button', { name: 'Preview' })).toBeVisible();
      await expect(hero.getByRole('button', { name: 'Download Original' })).toBeVisible();
      await expect(hero.locator('.explain-tip-trigger')).toHaveCount(4);
      for (const target of await hero.locator('.explain-tip-trigger, .btn').all()) {
        const box = await target.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      // The dark pass look comes from the picture stylesheet.
      const ground = await hero.evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(ground).toContain('gradient');
    });
  }

  test('on a phone the Add button is gone and the accept bar rests at the bottom while details are in view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page);
    await expect(page.locator('.docs-add-fab')).toBeHidden();
    const bar = page.locator('.finding-accept-bar');
    await expect(bar.getByRole('button')).toHaveText('Accept 4 Clear Details');
    // From the top of the opened document the details run past the bottom of the screen.
    await page.locator('.wallet-selected-document').evaluate((el) => {
      el.scrollTop = 0;
    });
    expect(await bar.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(844);
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    // Resting on the bottom edge of the screen while the details are in view.
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
    expect(await coveredControls(page, SHEET)).toEqual([]);
  });

  test('Sensitive and conflicting details come one at a time, with Back and Skip for Now', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page);
    const steps = page.locator('.finding-steps');
    await expect(steps.locator('.finding-steps-count')).toHaveText('1 of 2');
    const visibleTitle = steps.locator(
      '.finding-steps-list > li:not([hidden]) .finding-card-head h5',
    );
    await expect(visibleTitle).toHaveText('Date of Birth');
    await steps.getByRole('button', { name: 'Skip for Now' }).click();
    await expect(visibleTitle).toHaveText('Passport Number');
    await expect(steps.locator('.finding-steps-count')).toHaveText('2 of 2');
    // Focus follows the detail now shown.
    await expect(steps.locator('.finding-steps-list > li:not([hidden])')).toBeFocused();
    await steps.getByRole('button', { name: 'Back' }).click();
    await expect(visibleTitle).toHaveText('Date of Birth');
  });

  test('a Sensitive value stays hidden until Value Found is opened', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page);
    await page.locator('.finding-steps').getByRole('button', { name: 'Skip for Now' }).click();
    const card = page.locator('.finding-steps-list > li:not([hidden]) .finding-card');
    await expect(card.getByText('X0000000')).toBeHidden();
    await card.locator('.finding-masked > details > summary').click();
    await expect(card.locator('input[name="correctedValue"]')).toHaveValue('X0000000');
    await expect(card.locator('input[name="correctedValue"]')).toBeVisible();
  });

  test('a difference is asked as large choices, each at least 56 px tall', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page);
    const tiles = page.locator(
      '.finding-steps-list > li:not([hidden]) .finding-choice-tiles > label',
    );
    await expect(tiles).toHaveCount(3);
    for (const tile of await tiles.all()) {
      const box = await tile.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
    }
  });

  test('with reduced motion nothing on the opened document animates or transitions', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page);
    const moving = await page
      .locator('.wallet-selected-document')
      .evaluate(
        (root) =>
          [root, ...root.querySelectorAll('*')]
            .map((el) => getComputedStyle(el))
            .filter(
              (style) =>
                style.animationName !== 'none' ||
                style.transitionDuration.split(',').some((d) => Number.parseFloat(d) > 0.01),
            ).length,
      );
    expect(moving).toBe(0);
  });
});
