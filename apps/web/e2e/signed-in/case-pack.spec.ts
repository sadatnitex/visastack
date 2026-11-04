import { expect, test } from '@playwright/test';
import { VERIFIED_IN_SOURCE as S, selectByText } from './support/selectors';
import { signIn } from './support/session';
import { configured, confirmed, ids } from './support/setup';
import { expectNoApprovalPromise, pageText } from './support/ui';

/**
 * Tier 2, case journey (docs/operations/staging-journeys.md): a UK tourism case finds its
 * published requirement pack; a route with no published pack says it is not supported and attaches
 * nothing; the destination country and the place of application stay two separate things; and no
 * page scores or promises an approval.
 *
 * Needs the owner's staging seed: a supported UK tourism pack (its visible label in
 * E2E_UK_TOURISM_PACK_LABEL) and a destination with no pack (E2E_UNSUPPORTED_ROUTE_DESTINATION).
 * The sentence a case shows for an unsupported route is the work of the checklist pack lane (Lane
 * C); it is matched loosely here, and `Visitor1` (a placeholder pack name that must never be
 * attached) is matched exactly.
 */

test.describe.configure({ mode: 'serial' });

const CENTRE = 'Specimen Visa Centre, Utopia';

test.beforeEach(async ({ page }) => {
  await signIn(page, 'TRAVELLER');
});

async function startCase(
  page: import('@playwright/test').Page,
  title: string,
  destination: RegExp,
  centre?: string,
): Promise<void> {
  await page.goto(`/app/applicant/${ids.traveller()}/missions`);
  await page.getByLabel(S.caseTitleField).fill(title);
  await selectByText(page.getByLabel(S.caseDestinationField), destination);
  await selectByText(page.getByLabel(S.casePurposeField), /tourism|visit|holiday/i);
  if (centre) {
    // The centre is under "Add More Details", which may be closed.
    if (!(await page.getByLabel(S.caseCentreField).isVisible())) {
      await page.getByText(S.moreDetails).click();
    }
    await page.getByLabel(S.caseCentreField).fill(centre);
  }
  await page.getByRole('button', { name: S.createCaseButton }).click();
  await expect(page).toHaveURL(/\/app\/mission\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

test('a UK tourism case is matched to the published pack and the country is not the place of application', async ({
  page,
}, info) => {
  confirmed(
    'E2E_UK_TOURISM_PACK_SEEDED',
    'The owner confirms a supported UK tourism pack is published in the staging database.',
  );
  const label = configured('E2E_UK_TOURISM_PACK_LABEL');
  await startCase(page, `Specimen UK Tourism ${Date.now()}`, /United Kingdom/i, CENTRE);
  await expect(page.locator('main')).toContainText(label, { timeout: 30_000 });
  const text = await pageText(page);
  expect(text).not.toContain('Visitor1');
  // Two separate facts, each shown on its own: the country, and the place the person applies.
  expect(text).toMatch(/United Kingdom/);
  expect(text).toContain(CENTRE);
  expect(text).not.toContain(`United Kingdom ${CENTRE}`);
  expectNoApprovalPromise(text);
  await info.attach('case-url.txt', {
    body: new URL(page.url()).pathname,
    contentType: 'text/plain',
  });
});

test('a route with no published pack says so and attaches nothing', async ({ page }) => {
  const destination = new RegExp(configured('E2E_UNSUPPORTED_ROUTE_DESTINATION'), 'i');
  await startCase(page, `Specimen Unsupported Route ${Date.now()}`, destination);
  const text = await pageText(page);
  expect(text).not.toContain('Visitor1');
  expect(text).toMatch(
    /no (published )?(requirement )?(pack|checklist)|not (supported|available) yet|isn't supported|is not supported/i,
  );
  // No made-up readiness figure is shown for a case with no pack.
  const ringNames = await page
    .locator('svg[role="img"][aria-label]')
    .evaluateAll((rings) => rings.map((ring) => ring.getAttribute('aria-label') ?? ''));
  for (const name of ringNames) expect(name).not.toMatch(/\d+\s*(of|\/)\s*\d+|\d+\s*%/);
  expectNoApprovalPromise(text);
});
