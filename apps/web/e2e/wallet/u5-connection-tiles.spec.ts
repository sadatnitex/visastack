import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import { runLayoutGuards } from '../support/layout-guards';

/**
 * WAL5 (owner decision 17 Nov 2026, Wallet board Pattern 4 option A): one tile per AI
 * connection, on the real stylesheet, for the traveller Sharing section and the agency page's
 * tiles. The fixture's clock is fixed at 15 Jan 2030 12:00 UTC and the traveller's zone is
 * Asia/Dhaka, so the time left never depends on the day the test runs.
 */

const FIXTURE = 'wal5-connection-tiles';
const STAND_INS = { standInServerActions: true } as const;

const open = (page: Page, props: { open?: boolean } = {}) =>
  renderFixture(page, FIXTURE, props, STAND_INS);
const tiles = (page: Page) => page.locator('[data-ai-tile]');
const tile = (page: Page, name: string | RegExp) =>
  tiles(page).filter({ has: page.getByRole('heading', { level: 3, name }) });

test.describe('WAL5 layout guards', () => {
  for (const changeOpen of [false, true]) {
    test(`Change Access ${changeOpen ? 'open' : 'closed'}: no sideways scroll, nothing covers a control`, async ({
      page,
    }) => {
      await runLayoutGuards(page, async () => {
        await open(page, { open: changeOpen });
      });
    });
  }

  test('a Turn Off question open: nothing covers a control', async ({ page }) => {
    await runLayoutGuards(page, async () => {
      await open(page);
      await tile(page, /^Claude/)
        .first()
        .getByRole('button', { name: 'Turn Off Claude' })
        .click();
    });
  });
});

test.describe('WAL5 one tile per connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
  });

  test('every connection is one tile with who, Connected, Ends, Last Used and its actions', async ({
    page,
  }) => {
    await expect(tiles(page)).toHaveCount(5);
    const traveller = page.locator('.wal5-traveller [data-ai-tile]');
    await expect(traveller).toHaveCount(3);
    for (const index of [0, 1, 2]) {
      const one = traveller.nth(index);
      await expect(one.locator('dt')).toHaveText(['Connected', 'Ends', 'Last Used']);
      await expect(one.locator('summary', { hasText: 'Change Access' })).toBeVisible();
      await expect(one.getByRole('button', { name: /^Turn Off / })).toBeVisible();
    }
    const agency = page.locator('.wal5-agency [data-ai-tile]');
    await expect(agency).toHaveCount(2);
    await expect(agency.first().locator('dt')).toHaveText([
      'Connected',
      'Connected By',
      'Ends',
      'Last Used',
    ]);
    // Each tile is found by its heading, with no landmark per connection.
    await expect(page.locator('[data-ai-tile] h3').first()).toHaveText('Claude claude.ai');
    await expect(page.locator('[data-ai-tile][role], section[data-ai-tile]')).toHaveCount(0);
    // An ended agency connection says Ended once, with no stale end date.
    await expect(agency.nth(1).locator('dt')).toHaveText([
      'Connected',
      'Connected By',
      'Last Used',
    ]);
  });

  test('what an app can read is pictures that explain themselves, in the consent words', async ({
    page,
  }) => {
    const first = tile(page, /^Claude/).first();
    const names = await first
      .locator('.explain-tip-trigger')
      .evaluateAll((els) => els.map((el) => el.textContent?.trim()));
    expect(names).toEqual([
      'Personal Details',
      'Passports and Travel Documents',
      'List of My Documents',
      'Cases: All Current Cases',
      'Full Document Numbers: No',
    ]);
    const passports = first.getByRole('button', { name: 'Passports and Travel Documents' });
    await expect(passports).toHaveAccessibleDescription(
      'Passport and visa details and their dates.',
    );
    await passports.focus();
    const note = first.locator('.explain-tip[data-open="true"] [role="tooltip"]');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Passport and visa details and their dates.');
    await page.keyboard.press('Escape');
    await expect(first.locator('[role="tooltip"]:visible')).toHaveCount(0);
    // Tap opens it too.
    await first.getByRole('button', { name: 'Full Document Numbers: No' }).click();
    await expect(first.locator('[role="tooltip"]:visible')).toContainText(
      'Numbers show only their last three characters.',
    );
    // A connection with nothing from the record says so in words.
    await expect(tile(page, /^ChatGPT/).first()).toContainText('Nothing from this record');
  });

  test('every picture button and action is at least 44 px', async ({ page }) => {
    const controls = page.locator(
      '[data-ai-tile] :is(.explain-tip-trigger, .btn, summary):visible',
    );
    const count = await controls.count();
    expect(count).toBeGreaterThan(10);
    for (let i = 0; i < count; i += 1) {
      const box = await controls.nth(i).boundingBox();
      // A visible control with no box is a failure, never skipped.
      expect(box, `control ${i} has no box`).not.toBeNull();
      if (!box) return;
      expect(box.height, `control ${i}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `control ${i}`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the clock: days left, ending soon in hours, no end, and ended; dates in the person zone', async ({
    page,
  }) => {
    const running = tile(page, /^Claude/).first();
    await expect(running.locator('.ai-tile-ring')).toHaveAttribute('data-state', 'running');
    await expect(running.locator('.ai-tile-left')).toHaveText('29 Days Left');
    // 15 Jan 2030 12:00 UTC is 18:00 in Dhaka; 29 days on, the same.
    await expect(running.locator('dd').nth(1)).toHaveText('13 Feb 2030, 18:00');
    await expect(running.locator('dd').nth(2)).toHaveText('15 Jan 2030, 16:00');

    const soon = tile(page, /^A Very Long Example/);
    await expect(soon.locator('.ai-tile-ring')).toHaveAttribute('data-state', 'ending_soon');
    await expect(soon.locator('.ai-tile-left')).toContainText('4 Hours Left');
    await expect(soon.locator('.ai-tile-soon')).toHaveText('Ending Soon');

    const openEnded = tile(page, /^ChatGPT/).first();
    await expect(openEnded.locator('.ai-tile-ring')).toHaveAttribute('data-state', 'open');
    await expect(openEnded.locator('.ai-tile-left')).toHaveCount(0);
    await expect(openEnded.locator('dd').nth(1)).toHaveText('Until You Turn It Off');

    const ended = page.locator('.wal5-agency [data-ai-tile]').nth(1);
    await expect(ended.locator('.ai-tile-ring')).toHaveAttribute('data-state', 'ended');
    await expect(ended.locator('.ai-tile-left')).toHaveText('Ended');
    await expect(ended.locator('.ai-tile-ring-fill')).toHaveCount(0);
  });

  test('Turn Off still asks first, inside the page, and Keep It On puts it back', async ({
    page,
  }) => {
    const first = tile(page, /^Claude/).first();
    await first.getByRole('button', { name: 'Turn Off Claude' }).click();
    await expect(first.locator('.notice[role="alert"]')).toContainText('Turn off Claude');
    await expect(first.getByRole('button', { name: 'Yes, Turn Off' })).toBeVisible();
    await first.getByRole('button', { name: 'Keep It On' }).click();
    await expect(first.getByRole('button', { name: 'Turn Off Claude' })).toBeFocused();
  });

  test('no serious accessibility problem on the tiles', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
  });
});

test('reduced motion: the ring shows its final state and nothing moves', async ({ page }) => {
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const ring = tile(page, /^Claude/)
      .first()
      .locator('.ai-tile-ring-fill');
    await expect(ring).toHaveAttribute('stroke-dasharray', '97 3');
    const motion = await ring.evaluate((el) => {
      const style = getComputedStyle(el);
      return { animation: style.animationName, transition: style.transitionDuration };
    });
    expect(motion).toEqual({ animation: 'none', transition: '0s' });
  }
});

test('works with script switched off: tiles, names and Change Access from the page markup', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  // The tiles as drawn, with every script removed, opened again with script switched off.
  // The script elements are removed from a copy through the page's own DOM, never by filtering text.
  const markup = await page.locator('main.scroll-fixture').evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const script of copy.querySelectorAll('script')) script.remove();
    return copy.outerHTML;
  });
  const origin = new URL(page.url()).origin;
  const sheets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href),
  );
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...sheets.map((href) => `<link rel="stylesheet" href="${href}">`),
    `</head><body>${markup}</body></html>`,
  ].join('');
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const still = await context.newPage();
    await still.route(`${origin}/__wal5-without-script`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    );
    await still.goto(`${origin}/__wal5-without-script`);
    expect(await still.evaluate(() => document.querySelectorAll('script').length)).toBe(0);
    await expect(still.locator('[data-ai-tile]')).toHaveCount(5);
    await expect(still.locator('.explain-tip-popup').first()).toBeHidden();
    await expect(still.locator('.explain-tip-trigger').first()).toHaveText('Personal Details');
    await expect(still.locator('.ai-tile-left').first()).toHaveText('29 Days Left');
    const change = still.locator('details.ai-connection-change').first();
    await change.locator('summary').click();
    await expect(change.locator('form')).toBeVisible();
  } finally {
    await context.close();
  }
});
