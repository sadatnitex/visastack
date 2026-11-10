import { expect, test } from '@playwright/test';
import {
  WIDTHS,
  expectNoAxeViolations,
  expectNoSidewaysScroll,
  expectTouchTargets,
  openScreen,
  tabStops,
} from './support';

/**
 * Tier 1a: the screens of the signed-in journeys that exist today, mounted with their real
 * components and made-up data (docs/operations/staging-journeys.md).
 *
 * What this proves: at five widths each screen has no sideways scroll, no WCAG 2.2 AA rule broken
 * in its main region and no control under 44px; the keyboard reaches the controls in reading
 * order with a visible mark; the forms name their fields and announce a refusal; and an anchor
 * only Cases link opens its case. What it does NOT prove: sign-in, who may see what, stored data,
 * or that a server action does what its form says. Those need the staging suite (Tier 2).
 */

// Each screen is bundled from the real product code the first time it is opened in a worker, which
// is slow on a busy build machine.
test.describe.configure({ timeout: 60_000 });

const SCREENS = [
  { view: 'wallet', label: 'document wallet' },
  { view: 'case', label: 'case page card' },
  { view: 'case-no-packs', label: 'case page card without a pack' },
  { view: 'request', label: 'evidence request form' },
  { view: 'cases-link', label: 'agency Cases list' },
] as const;

for (const screen of SCREENS) {
  test.describe(`${screen.label} at every width`, () => {
    for (const size of WIDTHS) {
      test(`${size.width}px (${size.name})`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await openScreen(page, screen.view);
        await expectNoSidewaysScroll(page);
        await expectNoAxeViolations(page);
        await expectTouchTargets(page);
      });
    }
  });
}

test.describe('document wallet', () => {
  test('the keyboard reaches the decisions first, then the list and the finder, in reading order', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openScreen(page, 'wallet');
    const stops = await tabStops(page, 13);
    // Named by the page itself, so a screen reader user hears which file each choice is about.
    expect(stops.map((s) => s.name)).toEqual([
      '← Overview',
      'Choose What It Is: Specimen Letter Still Being Checked',
      'What Happens Next',
      'Confirm: Specimen Passport, Newer Scan',
      'Keep Separate: Specimen Passport, Newer Scan',
      'What Happens Next',
      'Confirm: Specimen Letter Still Being Checked',
      'Keep Separate: Specimen Letter Still Being Checked',
      'About These Choices',
      'Specimen Passport, Newer ScanReady',
      'Specimen Passport, First ScanReady',
      'Specimen Letter Still Being CheckedProcessing',
      'Find a Document',
    ]);
    expect(
      stops.filter((s) => !s.marked).map((s) => s.name),
      'stops with no focus mark',
    ).toEqual([]);
  });

  test('both choices for a newer copy say what they will do and name the file', async ({
    page,
  }) => {
    await openScreen(page, 'wallet');
    const card = page.locator('.umpe-p3-needs-decision');
    await expect(
      card.getByText('looks like a new copy of Specimen Passport, First Scan.'),
    ).toBeVisible();
    // What each choice does sits one tap away, under "What Happens Next" beside each decision.
    for (const fold of await card.getByText('What Happens Next').all()) await fold.click();
    await expect(
      card.getByText('Confirm keeps both files and marks the older one as the Earlier Copy.'),
    ).toBeVisible();
    await expect(card.getByText('Both files are kept.')).toBeVisible();
    await expect(
      card.getByRole('button', { name: 'Confirm: Specimen Passport, Newer Scan' }),
    ).toBeVisible();
    await expect(
      card.getByRole('button', { name: 'Keep Separate: Specimen Passport, Newer Scan' }),
    ).toBeVisible();
  });

  test('an answer that was refused is announced and focus moves to it', async ({ page }) => {
    await openScreen(page, 'wallet');
    await page.getByRole('button', { name: 'Confirm: Specimen Passport, Newer Scan' }).click();
    const status = page.locator('.umpe-p3-decision-status');
    await expect(status).toContainText('Test fixture: nothing was changed.');
    await expect(status).toBeFocused();
    // The refusal is the stand-in server speaking: nothing was filed, so both files are still there.
    await expect(page.locator('.umpe-p3-decision-item')).toHaveCount(2);
  });

  test('the finder narrows the list and the preview never opens a file that is still being checked', async ({
    page,
  }) => {
    await openScreen(page, 'wallet');
    const panel = page.getByRole('complementary', { name: 'Document details' });
    await expect(
      panel.getByRole('heading', { name: 'Specimen Passport, Newer Scan' }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Open Secure Preview' })).toBeVisible();
    await panel.getByLabel('Find a Document').fill('letter');
    await expect(
      panel.getByRole('heading', { name: 'Specimen Letter Still Being Checked' }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Open Secure Preview' })).toHaveCount(0);
    await expect(panel.getByText('This document is not available to preview.')).toBeVisible();
    await panel.getByLabel('Find a Document').fill('no such file');
    await expect(
      panel.getByText('No documents match. Try another name or clear your search.'),
    ).toBeVisible();
  });
});

test.describe('case page card', () => {
  test('exactly one stage is marked, and it never talks about approval odds', async ({ page }) => {
    await openScreen(page, 'case');
    await expect(page.locator('.lift-steps-list [aria-current="step"]')).toHaveCount(1);
    await expect(page.locator('.lift-steps-list [aria-current="step"]')).toContainText(
      'In Progress',
    );
    const text = (await page.locator('main').innerText()).toLowerCase();
    expect(text).toContain('not an approval probability');
    expect(text).not.toMatch(
      /chance of approval|likely to be approved|approval rate|you will be approved/,
    );
  });

  test('the pack choice has a name, and a refusal is shown beside it', async ({ page }) => {
    await openScreen(page, 'case');
    const pack = page.getByRole('combobox', { name: 'Requirement Pack' });
    await expect(pack).toBeVisible();
    await pack.selectOption({ label: 'Specimen Visitor Pack, Version 1' });
    await page.getByRole('button', { name: 'Attach Pack' }).click();
    await expect(page.getByText('Test fixture: nothing was changed.')).toBeVisible();
  });

  test('with no pack on offer the form draws nothing, so there is no empty choice', async ({
    page,
  }) => {
    await openScreen(page, 'case-no-packs');
    await expect(page.locator('[data-pack-note]')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Requirement Pack' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Attach Pack' })).toHaveCount(0);
  });
});

test.describe('evidence request form (the picker)', () => {
  test('every field has a name, and the picker finds items by plain names and keeps a tray', async ({
    page,
  }) => {
    await openScreen(page, 'request');
    for (const name of [
      'Traveller',
      'Case',
      'Search Documents and Details',
      'Message (Optional)',
      'Due Date (Optional)',
    ]) {
      await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Selected (0)')).toBeVisible();
    await page.getByLabel('Search Documents and Details').fill('nid');
    await page.getByRole('checkbox', { name: 'National ID Card' }).check();
    await page.getByLabel('Search Documents and Details').fill('something else');
    await page.getByRole('checkbox', { name: 'Other Document' }).check();
    await expect(page.getByText('Selected (2)')).toBeVisible();
    await page.getByRole('button', { name: 'Remove National ID Card' }).click();
    await expect(page.getByText('Selected (1)')).toBeVisible();
    await page.getByLabel('Search Documents and Details').fill('zzzz');
    await expect(
      page.getByText('Not in the list? Choose Other Document and explain in the message.'),
    ).toBeVisible();
  });

  test('it can be filled and sent from the keyboard alone, and the answer is announced', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScreen(page, 'request');
    await page.getByLabel('Traveller', { exact: true }).focus();
    await page
      .getByLabel('Traveller', { exact: true })
      .selectOption({ label: 'Specimen Traveller' });
    await page.getByLabel('Search Documents and Details').fill('solvency');
    await page.getByRole('checkbox', { name: 'Bank Solvency Certificate' }).check();
    await page.getByLabel('Message (Optional)').fill('Needed for the visa form');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Test fixture: nothing was changed.')).toBeVisible();
  });

  test('nothing is sent while a required choice is missing', async ({ page }) => {
    await openScreen(page, 'request');
    await page.getByRole('button', { name: 'Request Evidence' }).click();
    await expect(page.getByText('Test fixture: nothing was changed.')).toHaveCount(0);
    await expect(page.getByLabel('Traveller', { exact: true })).toBeFocused();
  });
});

test.describe('agency Cases link', () => {
  const FIRST = '0b7a4c1e-5d3f-4a62-9c18-3e2f7a9b0d11';
  const SECOND = '7c2d9e40-1b8a-4f56-8a07-6d5e4c3b2a10';

  test('an anchor-only link opens its case, with the case in the address', async ({ page }) => {
    await openScreen(page, 'cases-link');
    await expect(page.locator('[data-open-case=""]')).toBeVisible();
    await page.getByRole('link', { name: 'Specimen Visitor Visa, Autumn 2026' }).click();
    await expect(page.locator(`[data-open-case="${FIRST}"]`)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Specimen Visitor Visa, Autumn 2026', level: 2 }).last(),
    ).toBeVisible();
    const address = new URL(page.url());
    expect(address.pathname).toBe('/app/agency/synthetic/cases');
    expect(address.searchParams.get('case')).toBe(FIRST);
    expect(address.hash).toBe(`#mission-${FIRST}`);
    expect(await page.evaluate(() => window.__uiFixtureNavigations)).toHaveLength(1);
  });

  test('the keyboard opens a case, and a second link replaces the first', async ({ page }) => {
    await openScreen(page, 'cases-link');
    await page.getByRole('link', { name: 'Specimen Visitor Visa, Autumn 2026' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-open-case="${FIRST}"]`)).toBeVisible();
    await page.getByRole('link', { name: 'Specimen Study Visa, January 2027' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-open-case="${SECOND}"]`)).toBeVisible();
    await expect(page.locator(`[data-open-case="${FIRST}"]`)).toHaveCount(0);
  });

  test('an old bookmark that only changes the anchor still opens the case', async ({ page }) => {
    await openScreen(page, 'cases-link');
    await page.evaluate((id) => {
      window.location.hash = `#mission-${id}`;
    }, SECOND);
    await expect(page.locator(`[data-open-case="${SECOND}"]`)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('case')).toBe(SECOND);
  });

  test('an anchor that is not a case address is left alone', async ({ page }) => {
    await openScreen(page, 'cases-link');
    await page.evaluate(() => {
      window.location.hash = '#mission-not-a-case';
    });
    await expect(page.locator('[data-open-case=""]')).toBeVisible();
    expect(await page.evaluate(() => window.__uiFixtureNavigations ?? [])).toHaveLength(0);
    expect(new URL(page.url()).searchParams.has('case')).toBe(false);
  });
});
