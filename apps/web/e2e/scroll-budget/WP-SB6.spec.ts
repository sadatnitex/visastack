import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectFixedPanel, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB6: the staff operations pages with 1,000 rows behind every list (the plan's acceptance):
 * the overview within 2 phone screens, audit, email delivery, complaints and access within 3, and
 * every log or queue in its fixed box that scrolls inside. Enforced. The page tests prove the
 * real pages read one load (50, 20 or 25 rows) and the next one from the server.
 */

const FIXTURE = 'WP-SB6';
const TOTAL = 1000;

async function noSeriousAxe(page: import('@playwright/test').Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function panelsHold(
  page: import('@playwright/test').Page,
  names: readonly string[],
): Promise<void> {
  for (const viewport of ['phone', 'desktop'] as const) {
    for (const name of names) {
      const { scrolls } = await expectFixedPanel(page.getByRole('region', { name }), {
        viewport,
        mode: 'enforce',
      });
      expect(scrolls, `${name} scrolls inside at ${viewport}`).toBe(true);
    }
  }
}

test.describe('WP-SB6 scroll budget', () => {
  test('the overview fits 2 screens: status and failed jobs first, the rest in groups', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'overview', total: TOTAL });
    await expect(page.locator('.failed-job-row')).toHaveCount(50);
    await expect(page.getByText('Showing 50 of 1000 failed jobs.')).toBeVisible();
    await expect(page.locator('details.admin-overview-group')).toHaveCount(8);
    await expect(page.locator('details.admin-overview-group[open]')).toHaveCount(0);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 2, viewport, mode: 'enforce' });
    }
    await panelsHold(page, ['Failed Intake Jobs']);
    await noSeriousAxe(page);
  });

  test('the audit trail fits 3 screens with 50 entries in its fixed box', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'audit', total: TOTAL });
    await expect(page.locator('.activity-log-row')).toHaveCount(50);
    await expect(page.getByRole('link', { name: 'Show Older Entries' })).toHaveAttribute(
      'href',
      '/app/admin/audit?before=CURSOR#admin-audit-log',
    );
    await expect(page.getByLabel('Find by Email')).toBeVisible();
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await panelsHold(page, ['Audit Events']);
    await noSeriousAxe(page);
  });

  test('email delivery fits 3 screens with both lists in fixed boxes', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'email', total: TOTAL });
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await panelsHold(page, ['Emails That Did Not Arrive', 'Emails Still Waiting']);
    await noSeriousAxe(page);
  });

  test('complaints fit 3 screens: tabs, 20 complaints and feedback in fixed boxes', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'complaints', total: TOTAL });
    await expect(page.locator('.complaint-row')).toHaveCount(20);
    await expect(page.getByRole('link', { name: /Open \(1000\)/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await panelsHold(page, ['Complaints', 'Private Feedback Entries']);
    await noSeriousAxe(page);
  });

  test('access fits 3 screens: pending first, history apart, 25 a load each', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'access', total: TOTAL });
    await expect(page.locator('.invitation-row')).toHaveCount(50);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await panelsHold(page, ['Invitations Waiting to Be Used', 'Accepted and Revoked Invitations']);
    await noSeriousAxe(page);
  });

  test('the budget fails when the lists lose their fixed boxes', async ({ page }) => {
    for (const view of ['overview', 'email', 'complaints', 'access'] as const) {
      await renderFixture(page, FIXTURE, { view, total: TOTAL, unboxed: true });
      await expect(
        expectWithinBudget(page, {
          screens: view === 'overview' ? 2 : 3,
          viewport: 'phone',
          mode: 'enforce',
        }),
      ).rejects.toThrow(/page height at phone/);
    }
  });
});
