import { expect, test } from '@playwright/test';
import { VERIFIED_IN_SOURCE as S } from './support/selectors';
import { signedInContext } from './support/session';
import { NOBODY, configured, credentials, ids } from './support/setup';

/**
 * Tier 2, isolation (docs/operations/staging-journeys.md): an agency that has nothing to do with
 * a traveller or another agency learns nothing about either, and "you may not" looks exactly like
 * "there is nothing". Three distinct synthetic accounts are used and the test refuses to run if
 * two of them share an address, because one account standing on both sides proves nothing.
 *
 * Unlike the exact-copy loop this needs no new service: it holds today's access rules to account
 * in a real browser with real sign-in, so it needs only the accounts and ids the owner seeds.
 */

const baseURL = () => configured('PLAYWRIGHT_BASE_URL');

test('the three accounts are three different people', () => {
  const emails = (['TRAVELLER', 'AGENCY_ADMIN', 'UNRELATED_AGENCY_ADMIN'] as const).map((role) =>
    credentials(role).email.toLowerCase(),
  );
  expect(new Set(emails).size).toBe(3);
  expect(ids.agencyOrg()).not.toBe(ids.unrelatedAgencyOrg());
});

test('an unrelated agency cannot open another agency or a traveller, and the answer is the same as for nothing', async ({
  browser,
}) => {
  const other = await signedInContext(browser, 'UNRELATED_AGENCY_ADMIN', baseURL());
  try {
    const missing: string[] = [];
    // What a missing record looks like to this same person: the baseline for "denied".
    for (const path of [
      `/app/agency/${NOBODY}`,
      `/app/applicant/${NOBODY}/documents`,
      `/app/mission/${NOBODY}`,
    ]) {
      await other.page.goto(path);
      missing.push(await other.page.getByRole('heading', { level: 1 }).first().innerText());
    }
    for (const path of [
      `/app/agency/${ids.agencyOrg()}`,
      `/app/agency/${ids.agencyOrg()}/clients`,
      `/app/agency/${ids.agencyOrg()}/cases`,
      `/app/applicant/${ids.traveller()}`,
      `/app/applicant/${ids.traveller()}/documents`,
      `/app/applicant/${ids.traveller()}/sharing`,
    ]) {
      await other.page.goto(path);
      await expect(
        other.page.getByRole('heading', { name: S.notFoundHeading }),
        `${path} must look missing to an unrelated agency`,
      ).toBeVisible();
      expect(await other.page.getByRole('heading', { level: 1 }).first().innerText()).toBe(
        missing[0],
      );
      // Nothing of the other side leaks into the page: no id, no email, no name of a traveller.
      const text = await other.page.locator('body').innerText();
      expect(text).not.toContain(ids.traveller());
      expect(text.toLowerCase()).not.toContain(credentials('TRAVELLER').email.toLowerCase());
      expect(text.toLowerCase()).not.toContain(credentials('AGENCY_ADMIN').email.toLowerCase());
    }
  } finally {
    await other.context.close();
  }
});

test('an unrelated agency still has its own working space', async ({ browser }) => {
  const other = await signedInContext(browser, 'UNRELATED_AGENCY_ADMIN', baseURL());
  try {
    const answer = await other.page.goto(`/app/agency/${ids.unrelatedAgencyOrg()}`);
    expect(answer?.status()).toBe(200);
    await expect(other.page.locator('.app-frame')).toBeVisible();
    // Its own clients page lists no traveller of the other agency.
    await other.page.goto(`/app/agency/${ids.unrelatedAgencyOrg()}/clients`);
    const text = (await other.page.locator('main').innerText()).toLowerCase();
    expect(text).not.toContain(credentials('TRAVELLER').email.toLowerCase());
  } finally {
    await other.context.close();
  }
});
