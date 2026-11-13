import { type Page, expect, test } from '@playwright/test';
import { EXACT_COPY_UI as UI } from './support/selectors';
import { signedInContext } from './support/session';
import { configured, confirmed, ids } from './support/setup';

/**
 * Tier 2, the step that destroys what the other journeys need: the traveller ends the agency's
 * access, and the agency can no longer reach the traveller's requests or the files (docs/operations/
 * staging-journeys.md). Everything else that needs the grant (the exact-copy loop, the Cases anchor
 * with real data, the agency pages) must run BEFORE this, so playwright.signed-in.config.ts runs it
 * in the last stage (the project "revocation", which depends on the projects before it).
 * scripts/staging-journeys.test.mjs keeps the two lists in step.
 *
 * It runs after answer-from-records.spec.ts, whose last test also ends the grant (the flagship
 * journey proves the end of access in its own account of the world). Whichever of the two reaches
 * the grant first ends it. When this one finds the grant already ended, it does not pretend to end
 * it again: it checks the sharing page says Revoked, and that the agency's pages hold none of the
 * traveller's requests. When it finds the grant live, it ends it and checks the same afterwards.
 * It reads the pages it needs itself: a later project gets a fresh worker, so nothing the loop
 * learned is carried here.
 *
 * Same fail-closed setup as the loop: BLOCKED unless the owner has confirmed the exact-copy service
 * and the seeded grant. The owner re-seeds the grant before the next run.
 */

const baseURL = () => configured('PLAYWRIGHT_BASE_URL');

test.beforeAll(() => {
  confirmed(
    'E2E_EXACT_COPY_SERVICE_VERIFIED',
    'The exact-copy service is not confirmed deployed and migrated on the staging database, so ending an exact-copy grant cannot be tested.',
  );
  confirmed(
    'E2E_ACCESS_SEEDED',
    'The owner confirms the traveller has granted the agency access and the agency accepted it.',
  );
});

/** The request rows the agency's Clients page lists, by request id. */
async function agencyRequestIds(page: Page): Promise<string[]> {
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  const rows = page.locator(`${UI.requestRow}[id^="request-"]`);
  const found: string[] = [];
  for (let index = 0; index < (await rows.count()); index += 1) {
    const id = await rows.nth(index).getAttribute('id');
    if (id) found.push(id.replace(/^request-/, ''));
  }
  return found;
}

test('ending the access stops the agency reaching the traveller requests and files', async ({
  browser,
}) => {
  const traveller = await signedInContext(browser, 'TRAVELLER', baseURL());
  const agency = await signedInContext(browser, 'AGENCY_ADMIN', baseURL());
  try {
    const { page } = traveller;
    const seenBefore = await agencyRequestIds(agency.page);
    await page.goto(`/app/applicant/${ids.traveller()}/sharing`);
    const grants = page.locator(UI.grantRow);
    expect(await grants.count(), 'the traveller has a grant listed').toBeGreaterThan(0);
    const live = grants.filter({ hasNotText: UI.revokedWord });
    const endedNow = (await live.count()) > 0;
    if (endedNow) {
      const grantId = await live.first().getAttribute('data-row');
      await live.first().locator(UI.grantRowLink).click();
      const pane = page.locator(`#lp-pane-${grantId}`);
      await pane.getByRole('button', { name: UI.revokeButton }).click();
      // The page asks first; the confirm button's words are sharing/grant-op-buttons.tsx:11.
      await pane.getByRole('button', { name: 'Yes, Revoke Access' }).click();
      await expect(page.getByText(UI.accessRevoked).first()).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(
        grants.filter({ hasText: UI.revokedWord }).first(),
        'the grant already ended in this run shows as Revoked',
      ).toBeAttached();
    }
    // The agency's next request: what it saw before is gone, and after an earlier end nothing is left.
    const seenAfter = await agencyRequestIds(agency.page);
    expect(
      seenAfter.filter((id) => seenBefore.includes(id)),
      'requests of the traveller are no longer on the agency pages',
    ).toEqual([]);
    if (!endedNow) expect(seenAfter, 'the agency lists none of the traveller requests').toEqual([]);
  } finally {
    await traveller.context.close();
    await agency.context.close();
  }
});
