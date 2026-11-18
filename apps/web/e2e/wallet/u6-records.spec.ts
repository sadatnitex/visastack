import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import { runLayoutGuards } from '../support/layout-guards';

/**
 * U6: All Records on the Wallet rows, on the real stylesheet with made-up records. Each item is
 * one compact row (picture, name, one status picture, one action); the details sit inside it.
 * Also holds the two bugs that were pinned on the signed-in page: the filter buttons were
 * covered by their own edge.
 */
const FIXTURE = 'u6-records';
/**
 * The fixture page carries the site's global stylesheet only. The Record's own stylesheet is
 * imported by the row component (so a route loads it), so the spec adds that same file here.
 */
const ROW_CSS = resolve(__dirname, '../../src/app/app/applicant/[id]/record/u6-records.css');
async function open(page: Page): Promise<void> {
  await renderFixture(page, FIXTURE, {});
  await page.addStyleTag({ path: ROW_CSS });
}
const rows = (page: Page) => page.locator('.u6-row');

test.describe('U6 layout guards', () => {
  test('no sideways scroll and nothing covers a control, closed and with every row open', async ({
    page,
  }) => {
    await runLayoutGuards(page, async () => {
      await open(page);
    });
    await runLayoutGuards(page, async () => {
      await open(page);
      for (const toggle of await page.locator('.u6-row summary').all()) await toggle.click();
    });
  });

  test('the five filter buttons are pressable at their corners', async ({ page }) => {
    await runLayoutGuards(
      page,
      async () => {
        await open(page);
      },
      { within: '.u6-filters' },
    );
  });
});

test.describe('U6 compact rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
  });

  test('one picture, one status picture and at most one action per row', async ({ page }) => {
    const count = await rows(page).count();
    expect(count).toBeGreaterThan(5);
    for (let index = 0; index < count; index += 1) {
      const row = rows(page).nth(index);
      await expect(row.locator('.expandable-section-picture')).toHaveCount(1);
      await expect(row.locator('.expandable-section-status .status-picture')).toHaveCount(1);
      expect(await row.locator('.u6-row-action a').count()).toBeLessThanOrEqual(1);
    }
  });

  test('closed rows are compact and repeat no detail line', async ({ page }) => {
    const text = (await page.locator('.record-hub-group').allInnerTexts()).join('\n');
    expect(text).not.toContain('Not used in a case yet');
    expect(text).not.toContain('Not shared');
    expect(text).not.toContain('Version 2');
    const heights = await rows(page).evaluateAll((nodes) =>
      nodes.map((node) => ({
        long: node.textContent?.includes('A Very Long Example') ?? false,
        height: Math.round(node.getBoundingClientRect().height),
      })),
    );
    // Name and a one line summary, then the action under it on a phone: under 150 px. The one
    // 80-character name wraps over several lines and is only held to a sane ceiling.
    for (const { long, height } of heights) expect(height).toBeLessThan(long ? 280 : 150);
  });

  test('the row name keeps the Wallet size and no extra space under it', async ({ page }) => {
    const style = await rows(page)
      .first()
      .locator('.expandable-section-title')
      .evaluate((node) => {
        const css = getComputedStyle(node);
        return { margin: css.marginBottom, size: css.fontSize };
      });
    const body = await page.evaluate(() => getComputedStyle(document.body).fontSize);
    expect(style.margin).toBe('0px');
    expect(Number.parseFloat(style.size)).toBeLessThanOrEqual(Number.parseFloat(body) * 1.05);
  });

  test('opening a row shows version, saved date, use in cases and sharing', async ({ page }) => {
    const row = rows(page).filter({ hasText: 'Example Passport' }).first();
    await row.locator('summary').click();
    await expect(row.locator('.u6-fact dt')).toHaveText([
      'Version',
      'Saved',
      'Expires',
      'Used in Cases',
      'Shared With',
    ]);
    await expect(row.getByRole('link', { name: 'Open Document' })).toBeVisible();
  });

  test('empty sections gather into one Not Started group with a quiet row and links inside', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Next' }).click();
    const group = page.locator('section.record-hub-group').filter({
      has: page.getByRole('heading', { level: 2, name: 'Not Started' }),
    });
    await expect(group).toHaveCount(1);
    await expect(page.locator('section.record-hub-group h2').last()).toHaveText('Not Started');
    const quiet = group.locator('.u6-quiet .expandable-section');
    await expect(quiet).toHaveCount(1);
    await expect(quiet.locator('.expandable-section-summary')).toHaveText('1 more to add');
    await quiet.locator('summary').click();
    await expect(quiet.getByRole('link', { name: 'Visas You Have Held' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Nothing saved yet:');
  });

  test('filters, category, search and paging still work', async ({ page }) => {
    await page.getByRole('button', { name: /^Previous Versions/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: /^Everything/ }).click();
    await page.getByLabel('Search Your Record').fill('bank letter');
    await expect(rows(page)).toHaveCount(1);
    await page.getByLabel('Search Your Record').fill('');
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('output')).toContainText('Page 2 of');
  });

  test('has no accessibility violations with a row open', async ({ page }) => {
    await rows(page).first().locator('summary').click();
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
