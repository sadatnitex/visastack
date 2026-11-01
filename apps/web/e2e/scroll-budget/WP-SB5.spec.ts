import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { VIEWPORTS, expectFixedPanel, expectWithinBudget, renderFixture } from './support';

/**
 * WP-SB5: the agency Cases, Activity, Clients and Dashboard pages at their row caps with
 * worst-case data (200 cases, 300 notes, 400 invitations and 300 requests). The Cases budget
 * (3 screens with 200 cases) and the Activity log panel are the plan's acceptance and are
 * enforced. Since WP-SB11 Clients (3 screens, both sizes) and the Dashboard table (2 screens, the
 * dashboard budget, both sizes) enforce too. The page tests prove the real pages apply these caps
 * and read data for the one open case only.
 */

const FIXTURE = 'WP-SB5';

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

test.describe('WP-SB5 scroll budget', () => {
  test('cases with 200 cases lists 15 and stays within 3 screens', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'cases', total: 200, shown: 15 });
    await expect(page.locator('.agency-case-list-row')).toHaveCount(15);
    await expect(page.getByText('Showing 15 of 200 cases.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show More cases' })).toHaveAttribute(
      'href',
      '/app/agency/o1/cases?before=next-page#agency-case-list',
    );
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
  });

  test('case activity keeps 50 notes in the fixed log panel with filters', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'activity', total: 300, shown: 50 });
    const panel = page.getByRole('region', { name: 'Case Activity Entries' });
    await expect(panel.locator('li')).toHaveCount(50);
    await expect(page.getByRole('link', { name: 'Show Older Entries' })).toBeVisible();
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
      const { scrolls } = await expectFixedPanel(panel, { viewport, mode: 'enforce' });
      expect(scrolls).toBe(true);
    }
    await noSeriousAxe(page);
  });

  test('clients lists 15 invitations and 10 requests, forms closed', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'clients', total: 400, shown: 15 });
    await expect(page.locator('#client-invitation-list .row')).toHaveCount(15);
    await expect(page.locator('#agency-evidence-request-list .row')).toHaveCount(10);
    await expect(page.locator('details#invite-client')).not.toHaveAttribute('open', '');
    // WP-SB11: the pending invitations fold into their own counted group while there are
    // requests to follow, so the page opens on one list; one tap shows the other.
    const invitations = page.locator('details#client-invitations');
    await expect(invitations).not.toHaveAttribute('open', '');
    await expect(invitations.locator('summary')).toContainText('Pending Invitations');
    await expect(invitations.locator('summary')).toContainText('400');
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 3, viewport, mode: 'enforce' });
    }
    await noSeriousAxe(page);
    await invitations.locator('summary').click();
    await expect(page.locator('#client-invitation-list .row').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show More pending invitations' })).toBeVisible();
  });

  test('clients with both lists open breaks the budget', async ({ page }) => {
    await renderFixture(page, FIXTURE, {
      view: 'clients',
      total: 400,
      shown: 15,
      invitationsOpen: true,
    });
    await expect(
      expectWithinBudget(page, { screens: 3, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });

  test('the dashboard table shows the 10 most urgent cases, then Show More', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'dashboard', total: 200, shown: 10 });
    await expect(page.locator('#agency-case-table-rows tr')).toHaveCount(10);
    await expect(page.getByText('Showing 10 of 200 cases.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View All Cases' })).toBeVisible();
    // WP-SB11: on a phone the first 5 cases show as compact cards and the other 5 stay on the page
    // behind Show the Other 5 Cases, so the table fits the dashboard budget of 2 screens on both
    // sizes; a desktop shows all 10 and no toggle.
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: 2, viewport, mode: 'enforce' });
    }
    await page.setViewportSize(VIEWPORTS.desktop);
    await expect(page.locator('#agency-case-table-rows tr:visible')).toHaveCount(10);
    await expect(page.locator('.agency-case-table-toggle')).toBeHidden();
    await page.setViewportSize(VIEWPORTS.phone);
    await expect(page.locator('#agency-case-table-rows tr:visible')).toHaveCount(5);
    const toggle = page.getByRole('checkbox', { name: 'Show All 10 Cases' });
    await expect(page.locator('label[for="agency-case-table-all"]')).toHaveText(
      'Show the Other 5 Cases',
      { useInnerText: true },
    );
    await expect(toggle).not.toBeChecked();
    await noSeriousAxe(page);
    await page.locator('label[for="agency-case-table-all"]').click();
    await expect(toggle).toBeChecked();
    await expect(page.locator('#agency-case-table-rows tr:visible')).toHaveCount(10);
    await expect(page.locator('label[for="agency-case-table-all"]')).toHaveText(
      'Show Fewer Cases',
      { useInnerText: true },
    );
  });

  test('the dashboard table breaks its budget with all 10 cases unfolded on a phone', async ({
    page,
  }) => {
    await renderFixture(page, FIXTURE, { view: 'dashboard', total: 200, shown: 10 });
    await page.setViewportSize(VIEWPORTS.phone);
    await page.locator('label[for="agency-case-table-all"]').click();
    await expect(
      expectWithinBudget(page, { screens: 2, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });

  test('the cases budget fails when the list cap is lost', async ({ page }) => {
    await renderFixture(page, FIXTURE, { view: 'cases', total: 200, shown: 200 });
    await expect(
      expectWithinBudget(page, { screens: 3, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });
});
