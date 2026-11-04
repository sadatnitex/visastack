import { expect, test } from '@playwright/test';
import { VERIFIED_IN_SOURCE as S } from './support/selectors';
import { forget, signIn } from './support/session';
import { ids } from './support/setup';

/**
 * Tier 2, sessions that end (docs/operations/staging-journeys.md): a visitor whose session is
 * gone is sent to sign in and sees none of the private page; signing out ends the session for
 * real; and the Back button after signing out does not bring the private page back.
 *
 * "Gone" is made the way a browser makes it: the cookies the real sign-in set are cleared. The
 * server's own idle and age limits (src/lib/session-age.ts) are held by unit tests; a browser
 * cannot wait out a real limit in a staging run.
 */

test('a visitor whose cookies are gone is sent to sign in and sees nothing private', async ({
  page,
  context,
}) => {
  await signIn(page, 'TRAVELLER');
  await page.goto(`/app/applicant/${ids.traveller()}/documents`);
  await expect(page.locator('main')).toBeVisible();
  await context.clearCookies();
  await page.goto(`/app/applicant/${ids.traveller()}/documents`);
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Find a Document');
  expect(text).not.toContain(ids.traveller());
  forget('TRAVELLER');
});

test('a session that ends part-way through an action is told so, not left on a blank page', async ({
  page,
  context,
}) => {
  await signIn(page, 'TRAVELLER');
  await page.goto(`/app/applicant/${ids.traveller()}/missions`);
  await context.clearCookies();
  await page.getByLabel(S.caseTitleField).fill('Specimen Session Ended');
  await page.getByRole('button', { name: S.createCaseButton }).click();
  // Either the sign-in page or a plain message on the page: never a silent success.
  await expect(async () => {
    const onSignIn = /\/auth\/sign-in/.test(page.url());
    const message = await page.locator('[role="alert"], .field-msg-err').count();
    expect(onSignIn || message > 0).toBe(true);
  }).toPass({ timeout: 20_000 });
  forget('TRAVELLER');
});

test('signing out ends the session, and Back does not bring the private page back', async ({
  page,
}) => {
  await signIn(page, 'TRAVELLER');
  await page.goto(`/app/applicant/${ids.traveller()}/documents`);
  await page.getByRole('button', { name: S.signOut }).first().click();
  await expect(page).not.toHaveURL(/\/app\/applicant\//);
  await page.goBack();
  await page.reload();
  await expect(page).toHaveURL(/\/auth\/sign-in|\/$/);
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Find a Document');
  forget('TRAVELLER');
});
