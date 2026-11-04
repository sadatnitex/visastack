import { expect, test } from '@playwright/test';
import { loop } from './support/loop-state';
import { AWAITING_LANES_D_E as D_E, VERIFIED_IN_SOURCE as S } from './support/selectors';
import { signedInContext } from './support/session';
import { configured, confirmed, ids } from './support/setup';

/**
 * Tier 2, the one step that destroys what the other journeys need: the traveller ends the
 * agency's access, and the agency can no longer reach the request or the file (docs/operations/
 * staging-journeys.md). Everything else that needs the grant (the exact-copy loop, the Cases
 * anchor with real data, the agency pages) must run BEFORE this, so playwright.signed-in.config.ts
 * runs it in a last stage (the project "revocation", which depends on the project "journeys").
 * scripts/staging-journeys.test.mjs keeps the two lists in step.
 *
 * Same fail-closed setup as the loop: BLOCKED unless the owner has confirmed the exact-copy service
 * and the seeded grant. The owner re-seeds the grant before the next run.
 */

const baseURL = () => configured('PLAYWRIGHT_BASE_URL');

test.beforeAll(() => {
  confirmed(
    'E2E_EXACT_COPY_SERVICE_VERIFIED',
    'Lanes D and E are not confirmed deployed and migrated on the staging database, so ending an exact-copy grant cannot be tested.',
  );
  confirmed(
    'E2E_ACCESS_SEEDED',
    'The owner confirms the traveller has granted the agency access and the agency accepted it.',
  );
});

test('ending the access stops the agency fetching the file', async ({ browser }) => {
  const traveller = await signedInContext(browser, 'TRAVELLER', baseURL());
  const agency = await signedInContext(browser, 'AGENCY_ADMIN', baseURL());
  try {
    const { page } = traveller;
    await page.goto(`/app/applicant/${ids.traveller()}/sharing`);
    await page.getByRole('button', { name: D_E.revokeButton }).first().click();
    await page.getByRole('button', { name: 'Yes, Revoke Access' }).click();
    await expect(page.getByText(/revoked|ended/i).first()).toBeVisible();
    // The agency tries again on its next request.
    const answer = await agency.page.goto(
      loop.requestPath ?? `/app/agency/${ids.agencyOrg()}/clients`,
    );
    const looksMissing =
      (await agency.page.getByRole('heading', { name: S.notFoundHeading }).count()) > 0;
    expect(
      looksMissing || (answer?.status() ?? 0) === 404,
      'revoked access looks like a missing page',
    ).toBe(true);
  } finally {
    await traveller.context.close();
    await agency.context.close();
  }
});
