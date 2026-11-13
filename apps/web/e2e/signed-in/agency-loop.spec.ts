import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { type SyntheticFile, renderSyntheticPassport } from '../fixtures/synthetic-passport';
import { loop } from './support/loop-state';
import {
  VERIFIED_IN_SOURCE as S,
  EXACT_COPY_UI as UI,
  requireExactCopyUi,
} from './support/selectors';
import { signedInContext } from './support/session';
import { configured, confirmed, ids } from './support/setup';

/**
 * Tier 2, account-backed agency loop with exact copies (docs/operations/staging-journeys.md).
 *
 * Two distinct synthetic accounts, never one account on both sides: a traveller and the agency that
 * asks (the unrelated third agency is checked in agency-isolation.spec.ts, and the several-document
 * review is answer-from-records.spec.ts). The loop is: the agency asks for a passport; the traveller
 * chooses WHICH stored copy answers on the request's own panel; the agency's review shows that exact
 * copy; the agency sends it back with a reason; the traveller sends a clearer copy; the agency
 * accepts that specific submission; and the first round is still on the agency's row afterwards.
 *
 * It is written against the wording the product now has (support/selectors.ts, EXACT_COPY_UI, each
 * name with the source line it comes from). It fails closed: every step is BLOCKED unless the owner
 * has confirmed the exact-copy service is deployed and migrated on the staging database AND the
 * deployed page shows the controls this needs. Not run against any deployment.
 *
 * Setup it relies on and does not create: the agency has been invited by the traveller and the
 * invitation accepted (the invitation emails need a capture inbox, so that leg is not automated),
 * and the grant is for the traveller's whole record. Ending the grant is NOT done here: it is
 * answer-from-records.spec.ts and agency-loop-revoke.spec.ts, which the config runs in its last
 * stages, after every spec that needs the grant (docs/operations/staging-journeys.md, "Reset").
 *
 * Known limit: the specimen passport page names an expiry date in the past. If automatic reading is
 * on in the staging deployment and saves it, the product rightly calls the copy out of date and this
 * loop stops at the traveller's choice with a plain failure; answer-from-records.spec.ts uses kinds
 * that do not expire.
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

const stem = (file: SyntheticFile) => file.name.replace(/\.png$/, '');
const pattern = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** The request rows on the agency's Clients page, by request id. */
async function requestRowIds(page: Page): Promise<string[]> {
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  const rows = page.locator(`${UI.requestRow}[id^="request-"]`);
  const found: string[] = [];
  for (let index = 0; index < (await rows.count()); index += 1) {
    const id = await rows.nth(index).getAttribute('id');
    if (id) found.push(id.replace(/^request-/, ''));
  }
  return found;
}

/** Adds a file of the passport kind (the kind the request names) and waits until the list says it is added. */
async function addFile(page: Page, file: SyntheticFile): Promise<void> {
  await page.goto(`/app/applicant/${ids.traveller()}/documents/add?type=PASSPORT`);
  await page
    .getByTestId(UI.documentFilesTestId)
    .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await expect(
    page.locator(`${UI.uploadItem}[data-status="added"]`).filter({ hasText: file.name }),
  ).toBeVisible({ timeout: 60_000 });
}

/** The request's own panel on the traveller's Requests page. */
function panel(page: Page) {
  return page.locator(UI.requestPane(loop.requestId as string));
}

/** Opens the request and sends the copy named by `file` with the panel's own button. */
async function sendFromPanel(page: Page, file: SyntheticFile): Promise<void> {
  await expect(async () => {
    await page.goto(`/app/applicant/${ids.traveller()}/evidence?item=${loop.requestId}`);
    await expect(
      panel(page).getByRole('radio', { name: pattern(stem(file)) }),
      'the copy is offered once its file is checked',
    ).toBeVisible();
  }).toPass({ timeout: 150_000, intervals: [5_000, 10_000] });
  await requireExactCopyUi(page, UI.chooseTheCopy, 'on the request panel');
  await panel(page)
    .getByRole('radio', { name: pattern(stem(file)) })
    .check();
  await panel(page).getByRole('button', { name: UI.sendToAgency }).click();
  await expect(panel(page).getByText(UI.answerSent, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test.beforeAll(async ({ browser }) => {
  confirmed(
    'E2E_EXACT_COPY_SERVICE_VERIFIED',
    'The exact-copy service is not confirmed deployed and migrated on the staging database, so the exact-copy loop cannot be tested.',
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
  const before = new Set(await requestRowIds(page));
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  // The form sits in a fold that starts closed once requests exist.
  const fold = page.locator(UI.askGroup);
  if (!(await fold.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await fold.locator('summary').click();
  }
  const form = page.locator('form', {
    has: page.getByRole('button', { name: new RegExp(`^${S.requestEvidenceButton}`) }),
  });
  await form.getByLabel(S.requestTravellerField, { exact: true }).selectOption({ index: 1 });
  // The picker: find the document by its name, tick it, and it shows in the Selected tray.
  await form.getByLabel(S.requestSearchField).fill('passport');
  await form
    .getByRole('checkbox', { name: /^Passport\b/ })
    .first()
    .check();
  await expect(form.getByText('Selected (1)')).toBeVisible();
  await form.getByLabel('Message (Optional)').fill('Specimen request for the exact-copy test');
  await form.getByRole('button', { name: S.requestEvidenceButton, exact: true }).click();
  await expect(form.getByText(/Sent 1 request to /)).toBeVisible();
  const fresh = (await requestRowIds(page)).filter((id) => !before.has(id));
  expect(fresh, 'one new request appears on the Clients page').toHaveLength(1);
  loop.requestId = fresh[0] as string;
  loop.requestPath = `/app/agency/${ids.agencyOrg()}/clients`;
});

test('the traveller chooses which stored copy answers the request', async () => {
  test.setTimeout(300_000);
  expect(loop.requestId, 'the request id was read in the step that asked').toBeTruthy();
  await addFile(traveller.page, scanOne);
  await sendFromPanel(traveller.page, scanOne);
  loop.firstCopyName = stem(scanOne);
});

test('the agency review shows the exact copy that was sent', async () => {
  const { page } = agency;
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients?request=${loop.requestId}`);
  const row = page.locator(`#request-${loop.requestId}`);
  await requireExactCopyUi(page, UI.acceptButton, 'in the agency review');
  await expect(row).toContainText(UI.copyWaiting);
  await expect(row).toContainText(UI.fingerprint);
  await expect(row.locator(UI.copyName).first()).toContainText(loop.firstCopyName as string);
});

test('the agency sends it back with a reason', async () => {
  const { page } = agency;
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients?request=${loop.requestId}`);
  const row = page.locator(`#request-${loop.requestId}`);
  await requireExactCopyUi(page, UI.sendBackButton, 'in the agency review');
  await row.getByRole('button', { name: UI.sendBackButton }).click();
  await row
    .getByLabel(UI.reasonField, { exact: true })
    .fill('The photo page is cut off; please send a clearer copy');
  await row.getByRole('button', { name: UI.reasonSendButton, exact: true }).click();
  await expect(row.getByText(UI.sentBack, { exact: true })).toBeVisible();
});

test('the traveller sends a clearer copy after the first was sent back', async () => {
  test.setTimeout(300_000);
  await addFile(traveller.page, scanTwo);
  await sendFromPanel(traveller.page, scanTwo);
});

test('the agency accepts that specific submission', async () => {
  const { page } = agency;
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients?request=${loop.requestId}`);
  const row = page.locator(`#request-${loop.requestId}`);
  await requireExactCopyUi(page, UI.acceptButton, 'in the agency review');
  await expect(row.locator(UI.copyName).first()).toContainText(stem(scanTwo));
  await row.getByRole('button', { name: UI.acceptButton, exact: true }).click();
  await expect(row.getByText(UI.accepted, { exact: true })).toBeVisible();
});

test('the first round is still on the agency row after the replacement', async () => {
  const { page } = agency;
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients?request=${loop.requestId}`);
  const row = page.locator(`#request-${loop.requestId}`);
  expect(loop.firstCopyName, 'the first copy was recorded in an earlier step').toBeTruthy();
  // The earlier submission is history: still listed, still naming the copy that was sent.
  await expect(row).toContainText(UI.earlierSends(1));
  await expect(row).toContainText(UI.earlierSendLine(1, loop.firstCopyName as string));
});
