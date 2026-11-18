import { expect, test } from '@playwright/test';
import { VIEWPORTS, expectWithinBudget } from '../scroll-budget/support';

/**
 * R2: the rebuilt How It Works page. Four chapters, four rows whose text and picture swap sides,
 * pictures that rise in on scroll (and are simply there with reduced motion or without script),
 * and four word tiles that are real buttons.
 */

test.describe('how it works rebuild at 1440 wide', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('has the four chapters in order and none of the old case story', async ({ page }) => {
    await page.goto('/how-it-works');
    const tones = await page
      .locator('main section.pub-chapter')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tone')));
    expect(tones).toEqual(['dark', 'light', 'light', 'dark']);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('How It Works.');
    await expect(page.locator('.hk-step-chip')).toHaveCount(4);
    for (const gone of ['Step by Step', 'You Stay in Charge', 'Ready When You Are']) {
      await expect(page.getByText(gone)).toHaveCount(0);
    }
  });

  test('swaps text and picture sides row by row, and the pictures rise in on scroll', async ({
    page,
  }) => {
    await page.goto('/how-it-works');
    await expect(page.locator('html')).toHaveAttribute('data-scenes', 'live');
    const sides: boolean[] = [];
    for (let at = 0; at < 4; at++) {
      const row = page.locator('.hk-row').nth(at);
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator('.kit-rise.is-in')).toHaveCount(2);
      const text = await row.locator('.hk-row-text').boundingBox();
      const art = await row.locator('.hk-row-art').boundingBox();
      expect(text && art).toBeTruthy();
      sides.push((text?.x ?? 0) < (art?.x ?? 0));
    }
    expect(sides).toEqual([true, false, true, false]);
  });

  test('shows the Germany checklist at 3 of 8 and the share sheet resting on Turn Off', async ({
    page,
  }) => {
    await page.goto('/how-it-works');
    await expect(page.getByText('Germany: 3 of 8 Ready')).toBeVisible();
    await expect(page.getByText('Turn Off')).toBeVisible();
    await expect(page.getByText('Completeness only. Not an approval.')).toBeVisible();
  });

  test('turns a word tile from the keyboard and keeps its meaning readable either way', async ({
    page,
  }) => {
    await page.goto('/how-it-works');
    const tile = page.locator('button.hk-flip').first();
    await tile.scrollIntoViewIfNeeded();
    await expect(tile).toHaveAttribute('aria-pressed', 'false');
    await expect(tile).toContainText('No one has checked it yet.');
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(tile).toHaveAttribute('aria-pressed', 'false');
  });

  test('keeps the start and privacy links where they were', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.getByRole('link', { name: 'Start with Your Own Profile' })).toHaveAttribute(
      'href',
      '/app',
    );
    await expect(
      page.locator('main').getByRole('link', { name: 'Privacy and Trust' }),
    ).toHaveAttribute('href', '/trust');
  });
});

test.describe('how it works rebuild with less motion', () => {
  test('reduced motion shows every row finished and still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/how-it-works');
    await expect(page.locator('html')).not.toHaveAttribute('data-scenes', 'live');
    const hidden = await page
      .locator('.kit-rise')
      .evaluateAll(
        (nodes) => nodes.filter((node) => Number(getComputedStyle(node).opacity) < 1).length,
      );
    expect(hidden).toBe(0);
  });

  test.describe('without script', () => {
    test.use({ javaScriptEnabled: false });

    test('reads complete: every row, every word tile and the closing', async ({ page }) => {
      await page.goto('/how-it-works');
      await expect(page.locator('.hk-row')).toHaveCount(4);
      const hidden = await page
        .locator('.kit-rise')
        .evaluateAll(
          (nodes) => nodes.filter((node) => Number(getComputedStyle(node).opacity) < 1).length,
        );
      expect(hidden).toBe(0);
      await expect(page.getByText('See It With Your Own Passport.')).toBeVisible();
    });
  });
});

test.describe('how it works rebuild on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('never scrolls sideways and keeps every target 44 px high', async ({ page }) => {
    await page.goto('/how-it-works');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
      false,
    );
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('main a, main button')]
        .filter((el) => el.getBoundingClientRect().height < 43.5)
        .map((el) => (el.textContent ?? '').trim().slice(0, 30)),
    );
    expect(small).toEqual([]);
  });
});

test.describe('how it works rebuild scroll budget', () => {
  test('fits 6 screens on a phone and 12 on a desktop (the public page budget)', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto('/how-it-works');
    await expectWithinBudget(page, { screens: 6, viewport: 'phone', mode: 'enforce' });
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/how-it-works');
    await expectWithinBudget(page, { screens: 12, viewport: 'desktop' });
  });
});
