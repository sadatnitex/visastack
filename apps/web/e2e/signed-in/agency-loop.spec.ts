import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { type SyntheticFile, renderSyntheticPassport } from '../fixtures/synthetic-passport';
import { loop } from './support/loop-state';
import {
  AWAITING_LANES_D_E as D_E,
  VERIFIED_IN_SOURCE as S,
  requireExactCopyUi,
  selectByText,
} from './support/selectors';
import { signedInContext } from './support/session';
import { configured, confirmed, ids } from './support/setup';

/**
 * Tier 2, account-backed agency loop with exact copies (docs/operations/staging-journeys.md).
 *
 * Two distinct synthetic accounts, never one account on both sides: a traveller and the agency that
 * asks (the unrelated third agency is checked in agency-isolation.spec.ts). The loop is: the agency asks for
 * a passport; the traveller chooses WHICH stored copy answers; the agency's review shows that exact
 * copy; the agency sends it back with a reason; the traveller sends a clearer copy that replaces
 * it; the agency accepts that specific submission; the first receipt still names the first copy;
 * and when the traveller ends the agency's access the agency can no longer fetch the file.
 *
 * DEPENDS ON LANES D AND E (evidence version pinning; agency loop and replacement), which were not
 * merged when this was written. It is written against the behaviour their design documents state.
 * It fails closed: every step is BLOCKED unless the owner has confirmed the exact-copy service is
 * deployed and migrated on the staging database AND the deployed page shows the controls this
 * needs (selectors.ts, AWAITING_LANES_D_E). Not run against any deployment.
 *
 * Setup it relies on and does not create: the agency has been invited by the traveller and the
 * invitation accepted (the invitation emails need a capture inbox, so that leg is not automated),
 * and the grant is for the traveller's whole record. Ending the grant is NOT done here: it is
 * agency-loop-revoke.spec.ts, which the config runs in a last stage, after every spec that needs the
 * grant (docs/operations/staging-journeys.md, "Reset").
 */

test.describe.configure({ mode: 'serial' });

let scanOne: SyntheticFile;
let scanTwo: SyntheticFile;
let traveller: { context: BrowserContext; page: Page };
let agency: { context: BrowserContext; page: Page };
const baseURL = () => configured('PLAYWRIGHT_BASE_URL');

async function open(browser: Browser, role: 'TRAVELLER' | 'AGENCY_ADMIN') {
  return signedInContext(browser, role, baseURL());
}

test.beforeAll(async ({ browser }) => {
  confirmed(
    'E2E_EXACT_COPY_SERVICE_VERIFIED',
    'Lanes D and E are not confirmed deployed and migrated on the staging database, so the exact-copy loop cannot be tested.',
  );
  confirmed(
    'E2E_ACCESS_SEEDED',
    'The owner confirms the traveller has granted the agency access and the agency accepted it.',
  );
  scanOne = await renderSyntheticPassport(browser, 'first-scan');
  scanTwo = await renderSyntheticPassport(browser, 'clearer-scan');
  traveller = await open(browser, 'TRAVELLER');
  agency = await open(browser, 'AGENCY_ADMIN');
});

test.afterAll(async () => {
  await traveller?.context.close();
  await agency?.context.close();
});

test('the agency asks the traveller for a passport', async () => {
  const { page } = agency;
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  const form = page.locator('form', {
    has: page.getByRole('button', { name: S.requestEvidenceButton }),
  });
  await form.getByLabel(S.requestTravellerField, { exact: true }).selectOption({ index: 1 });
  // The picker: find the document by its name, tick it, and it shows in the Selected tray.
  await form.getByLabel(S.requestSearchField).fill('passport');
  await form.getByRole('checkbox', { name: /^Passport$/ }).check();
  await expect(form.getByText('Selected (1)')).toBeVisible();
  await form.getByLabel('Message (Optional)').fill('Specimen request for the exact-copy test');
  await form.getByRole('button', { name: S.requestEvidenceButton }).click();
  await expect(page.getByRole('status').or(page.locator('.field-msg')).first()).toBeVisible();
});

test('the traveller chooses which stored copy answers the request', async () => {
  const { page } = traveller;
  // A first copy is on file before the choice is made, so there is something to choose from.
  await page.goto(`/app/applicant/${ids.traveller()}/documents/add`);
  await page
    .getByTestId(S.importFilesTestId)
    .setInputFiles({ name: scanOne.name, mimeType: scanOne.mimeType, buffer: scanOne.buffer });
  await expect(page.getByLabel(`Upload of ${scanOne.name}`)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/app/applicant/${ids.traveller()}/documents`);
  await requireExactCopyUi(page, D_E.pinnedCopyPicker, 'for a request');
  const picker = page.getByRole('combobox', { name: D_E.pinnedCopyPicker }).first();
  await picker.selectOption({ index: 1 });
  loop.firstCopyName = (await picker.locator('option:checked').innerText()).trim();
  await page
    .getByRole('button', { name: /^(Send|Share|Submit)/i })
    .first()
    .click();
});

test('the agency review shows the exact copy that was sent', async () => {
  const { page } = agency;
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  await requireExactCopyUi(page, D_E.exactCopyLabel, 'in the agency review');
  await expect(page.getByText(D_E.exactCopyLabel).first()).toBeVisible();
  if (loop.firstCopyName) await expect(page.getByText(loop.firstCopyName).first()).toBeVisible();
  loop.requestPath = new URL(page.url()).pathname;
});

test('the agency sends it back with a reason', async () => {
  const { page } = agency;
  await page.goto(loop.requestPath ?? `/app/agency/${ids.agencyOrg()}/clients`);
  await requireExactCopyUi(page, D_E.rejectButton, 'in the agency review');
  await page.getByRole('button', { name: D_E.rejectButton }).first().click();
  await page
    .getByLabel(D_E.rejectReasonField)
    .fill('The photo page is cut off; please send a clearer copy');
  await page.getByRole('button', { name: D_E.rejectButton }).last().click();
  await expect(page.getByText(/cut off/)).toBeVisible();
});

test('the traveller sends a clearer copy that replaces the first', async () => {
  const { page } = traveller;
  await page.goto(`/app/applicant/${ids.traveller()}/documents/add`);
  await page
    .getByTestId(S.importFilesTestId)
    .setInputFiles({ name: scanTwo.name, mimeType: scanTwo.mimeType, buffer: scanTwo.buffer });
  await expect(page.getByLabel(`Upload of ${scanTwo.name}`)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/app/applicant/${ids.traveller()}/documents`);
  await requireExactCopyUi(page, D_E.pinnedCopyPicker, 'for a request that was sent back');
  const picker = page.getByRole('combobox', { name: D_E.pinnedCopyPicker }).first();
  await selectByText(picker, new RegExp(scanTwo.name.replace('.png', ''), 'i'));
  await page
    .getByRole('button', { name: /^(Send|Share|Submit)/i })
    .first()
    .click();
});

test('the agency accepts that specific submission', async () => {
  const { page } = agency;
  await page.goto(loop.requestPath ?? `/app/agency/${ids.agencyOrg()}/clients`);
  await requireExactCopyUi(page, D_E.acceptButton, 'in the agency review');
  await expect(
    page.getByText(new RegExp(scanTwo.name.replace('.png', ''), 'i')).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: D_E.acceptButton }).first().click();
});

test('the first receipt still names the first copy after the replacement', async () => {
  const { page } = agency;
  await page.goto(loop.requestPath ?? `/app/agency/${ids.agencyOrg()}/clients`);
  expect(loop.firstCopyName, 'the first copy was recorded in an earlier step').toBeTruthy();
  // The earlier submission is history: still readable, still pointing at the copy that was sent.
  await expect(page.getByText(loop.firstCopyName as string).first()).toBeVisible();
});
