import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  expect,
  test,
} from '@playwright/test';
import type { SyntheticFile } from '../fixtures/synthetic-passport';
import {
  VERIFIED_IN_SOURCE as S,
  EXACT_COPY_UI as UI,
  requireExactCopyUi,
} from './support/selectors';
import { signedInContext } from './support/session';
import { NOBODY, blocked, configured, confirmed, credentials, ids } from './support/setup';
import { WIDTHS, checkAccessibility, expectNoSidewaysScroll, keepScreenshot } from './support/ui';

/**
 * Tier 2, the flagship journey "Answer from Your Records" (docs/operations/staging-journeys.md).
 *
 * Three distinct synthetic accounts, never one account on two sides: a traveller, the agency that
 * asks, and a second agency with no link to either. In one run, through the real sign-in form:
 *
 *  1. the traveller and the agency are different accounts (each is turned away from the other's pages);
 *  2. the traveller saves three documents of three kinds (drawn SPECIMEN pages, no real person);
 *  3. the agency asks for all three in one request;
 *  4. the unrelated agency cannot open the traveller's pages or the agency's request, and the
 *     answer looks the same as for a page that is not there;
 *  5. the traveller opens Requests from Agencies and sees the asking agency named;
 *  6. the traveller answers all three in the Answer from Your Records review with the one button,
 *     and the receipt names each exact copy: its name, its version and its fingerprint;
 *  7. the agency sees those exact copies (same names, same fingerprints), accepts one and sends one
 *     back with a reason;
 *  8. the traveller sees the sent-back round, replaces the sent-back copy with a clearer one and
 *     sends it; the first round is still in the history;
 *  9. the agency sees the clearer copy, still sees the first round and its reason, and accepts it;
 * 10. the traveller later adds a newer document of the same kind, and the earlier receipt still names
 *     the older copies, unchanged;
 * 11. the pages used are checked at 390 px and 1280 px: no serious or critical accessibility finding
 *     and no sideways scroll;
 * 12. the traveller ends the agency's access and the agency loses the pages.
 *
 * LAST STAGE. The last test ends the agency's access, which every journey that needs the grant
 * would be broken by, so playwright.signed-in.config.ts runs this spec after every other journey
 * (project "flagship", which depends on "journeys"), and agency-loop-revoke.spec.ts after it.
 * scripts/staging-journeys.test.mjs keeps the order and the list in step. The owner re-seeds the
 * grant, and removes the documents and requests this adds, before the next run.
 *
 * Fail-closed, like the loop: BLOCKED unless the owner has confirmed the exact-copy service is
 * deployed and migrated on the staging database and the grant is seeded, and BLOCKED at a step whose
 * control the deployed page does not show. Never skipped, never passed without checking.
 *
 * NOT RUN against any deployment: there is no staging deployment, no accounts and no secrets yet.
 * The names it looks for were read from the product source (support/selectors.ts, with file and
 * line); the first run is not evidence until it has been read against the deployed pages.
 */

test.describe.configure({ mode: 'serial' });

/** Three kinds of document, none of which expires, so no copy is out of date before it is sent. */
const KINDS = [
  { key: 'BIRTH_CERTIFICATE', label: 'Birth Certificate', slug: 'birth-certificate' },
  { key: 'MARRIAGE_CERTIFICATE', label: 'Marriage Certificate', slug: 'marriage-certificate' },
  { key: 'BANK_STATEMENT', label: 'Bank Statement', slug: 'bank-statement' },
] as const;
type Kind = (typeof KINDS)[number];
/** Accepted at once, sent back with a reason, and left waiting. */
const [ACCEPTED_KIND, SENT_BACK_KIND, WAITING_KIND] = KINDS;

const REASON = 'The page is cut off at the edge; please send a clearer copy';

/** One exact copy as the receipt names it. */
interface SentCopy {
  readonly name: string;
  readonly version: number;
  readonly fingerprint: string;
  /** The whole line, for the state it ends with. */
  readonly text: string;
}

/** What one run learns as it goes. Serial mode keeps these in one worker, one test after another. */
const run = {
  id: Date.now().toString(36),
  agencyName: '',
  requestIds: new Map<Kind['key'], string>(),
  /** The name each copy had in the review, by kind: what the receipt and the agency must show. */
  copyNames: new Map<Kind['key'], string>(),
  firstReceipt: new Map<Kind['key'], SentCopy>(),
  receiptPath: '',
  replacementName: '',
};

let first: Map<Kind['key'], SyntheticFile>;
let clearer: SyntheticFile;
let newer: SyntheticFile;
let traveller: { context: BrowserContext; page: Page };
let agency: { context: BrowserContext; page: Page };
let unrelated: { context: BrowserContext; page: Page };
const baseURL = () => configured('PLAYWRIGHT_BASE_URL');

/** A drawn page of a made-up document. The header says SPECIMEN in words; no real person is in it. */
async function renderRecord(browser: Browser, kind: Kind, round: string): Promise<SyntheticFile> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 440 },
    colorScheme: 'light',
  });
  try {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><body style="margin:0;background:#fff;">
<div style="width:640px;height:440px;box-sizing:border-box;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111;border:2px solid #111;">
<div style="background:#111;color:#fff;padding:8px 12px;font-weight:700;letter-spacing:2px;">SPECIMEN - NOT A REAL DOCUMENT - TEST DATA ONLY</div>
<h1 style="font-size:28px;margin:24px 0 8px;">${kind.label}</h1>
<p style="margin:4px 0;font-size:15px;">Made-up holder: ERIKSSON, ANNA MARIA (Utopia)</p>
<p style="margin:4px 0;font-size:15px;">Test run ${run.id}, ${round}</p>
</div></body></html>`);
    const buffer = await page.screenshot({ type: 'png' });
    return { name: `specimen-${kind.slug}-${run.id}-${round}.png`, mimeType: 'image/png', buffer };
  } finally {
    await context.close();
  }
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Adds one file through the upload form that takes a kind, and waits until the list says it is added. */
async function addDocument(page: Page, kind: Kind, file: SyntheticFile): Promise<void> {
  await page.goto(`/app/applicant/${ids.traveller()}/documents/add?type=${kind.key}`);
  await page
    .getByTestId(UI.documentFilesTestId)
    .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await expect(
    page.locator(`${UI.uploadItem}[data-status="added"]`).filter({ hasText: file.name }),
  ).toBeVisible({ timeout: 60_000 });
}

/** The page of a record that is not there to this account: the app's own not-found page. */
async function expectLooksMissing(page: Page, path: string, baseline: string): Promise<void> {
  await page.goto(path);
  await expect(
    page.getByRole('heading', { name: S.notFoundHeading }),
    `${path} must look missing`,
  ).toBeVisible();
  expect(await page.getByRole('heading', { level: 1 }).first().innerText()).toBe(baseline);
}

/** The request rows on the agency's Clients page, by id. */
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

/** The agency's row for a copy, found by the copy's name (which is unique to this run). */
async function agencyRowFor(page: Page, copyName: string): Promise<Locator> {
  await page.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  const row = page.locator(UI.requestRow).filter({ hasText: copyName });
  await expect(row, `one request row names ${copyName}`).toHaveCount(1);
  return row;
}

/** Reads the receipt on the page: one entry per exact copy. */
async function readReceipt(page: Page): Promise<SentCopy[]> {
  await expect(page.getByRole('heading', { name: UI.receiptHeading })).toBeVisible();
  const lines = page.locator(UI.receiptLine);
  const copies: SentCopy[] = [];
  for (let index = 0; index < (await lines.count()); index += 1) {
    const line = lines.nth(index);
    const name = (await line.locator(UI.receiptLineName).first().innerText()).trim();
    const text = (await line.innerText()).replace(/\s+/g, ' ');
    const facts = UI.receiptFacts.exec(text);
    expect(facts, `the receipt line for ${name} names its version and fingerprint`).not.toBeNull();
    copies.push({ name, version: Number(facts?.[1]), fingerprint: String(facts?.[2]), text });
  }
  return copies;
}

/**
 * Makes sure the review answers exactly the wanted copy for one kind. A single fitting copy is a
 * tick box named "Document: <kind>"; several saved copies are a group of choices under the same
 * name. Returns the copy's name as the review shows it.
 */
async function chooseCopy(form: Locator, kind: Kind, file: SyntheticFile): Promise<string> {
  const requestName = UI.requestName(kind.label);
  const box = form.getByRole('checkbox', { name: requestName, exact: true });
  const boxes = await box.count();
  if (boxes > 1) {
    blocked(
      `staging holds ${boxes} waiting requests named "${requestName}". Reset the staging data first (docs/operations/staging-journeys.md, "Reset")`,
    );
  }
  if (boxes === 1) {
    await box.check();
    const label = form.locator('label').filter({ has: box });
    return (await label.locator(UI.copyNameInReview).first().innerText()).trim();
  }
  const group = form.getByRole('group', { name: requestName, exact: true });
  const radio = group.getByRole('radio', {
    name: new RegExp(escapeForPattern(file.name.replace(/\.png$/, ''))),
  });
  await radio.check();
  // The choice is named by the copy's own name (answer-set-form.tsx:410, aria-labelledby).
  return (
    await radio.evaluate(
      (element) =>
        document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent ?? '',
    )
  ).trim();
}

test.beforeAll(async ({ browser }) => {
  confirmed(
    'E2E_EXACT_COPY_SERVICE_VERIFIED',
    'The exact-copy service is not confirmed deployed and migrated on the staging database, so Answer from Your Records cannot be tested.',
  );
  confirmed(
    'E2E_ACCESS_SEEDED',
    'The owner confirms the traveller has granted the agency access and the agency accepted it.',
  );
  first = new Map(
    await Promise.all(
      KINDS.map(async (kind) => [kind.key, await renderRecord(browser, kind, 'first')] as const),
    ),
  );
  clearer = await renderRecord(browser, SENT_BACK_KIND, 'clearer');
  newer = await renderRecord(browser, SENT_BACK_KIND, 'newer');
  traveller = await signedInContext(browser, 'TRAVELLER', baseURL());
  agency = await signedInContext(browser, 'AGENCY_ADMIN', baseURL());
  unrelated = await signedInContext(browser, 'UNRELATED_AGENCY_ADMIN', baseURL());
});

test.afterAll(async () => {
  await traveller?.context.close();
  await agency?.context.close();
  await unrelated?.context.close();
});

test('the traveller and the agency are different accounts, and each is turned away from the other side', async () => {
  const emails = (['TRAVELLER', 'AGENCY_ADMIN', 'UNRELATED_AGENCY_ADMIN'] as const).map((role) =>
    credentials(role).email.toLowerCase(),
  );
  expect(new Set(emails).size, 'three accounts, three addresses').toBe(3);
  expect(ids.agencyOrg()).not.toBe(ids.unrelatedAgencyOrg());
  // The same facts in the browser: the traveller is not a member of the agency, and the agency does
  // not own the traveller's record.
  await traveller.page.goto(`/app/agency/${NOBODY}`);
  const baseline = await traveller.page.getByRole('heading', { level: 1 }).first().innerText();
  await expectLooksMissing(traveller.page, `/app/agency/${ids.agencyOrg()}/clients`, baseline);
  await agency.page.goto(`/app/applicant/${NOBODY}/evidence/answer`);
  const agencyBaseline = await agency.page.getByRole('heading', { level: 1 }).first().innerText();
  await expectLooksMissing(
    agency.page,
    `/app/applicant/${ids.traveller()}/evidence/answer`,
    agencyBaseline,
  );
  await expectLooksMissing(
    agency.page,
    `/app/applicant/${ids.traveller()}/evidence`,
    agencyBaseline,
  );
});

test('the traveller saves three documents of three kinds', async () => {
  test.setTimeout(300_000);
  for (const kind of KINDS) {
    const file = first.get(kind.key);
    expect(file, `a drawn page for ${kind.label}`).toBeDefined();
    await addDocument(traveller.page, kind, file as SyntheticFile);
  }
});

test('the agency asks for all three in one request', async () => {
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
  for (const kind of KINDS) {
    await form.getByLabel(S.requestSearchField).fill(kind.label);
    await form
      .getByRole('checkbox', { name: new RegExp(`^${escapeForPattern(kind.label)}\\b`) })
      .first()
      .check();
  }
  await expect(form.getByText(`Selected (${KINDS.length})`)).toBeVisible();
  await form.getByLabel('Message (Optional)').fill('Specimen request for Answer from Your Records');
  await form.getByRole('button', { name: `${S.requestEvidenceButton} (${KINDS.length})` }).click();
  await expect(form.getByText(new RegExp(`Sent ${KINDS.length} requests to `))).toBeVisible();
  // The three new rows, by kind.
  const fresh = (await requestRowIds(page)).filter((id) => !before.has(id));
  expect(fresh, 'three new requests appear on the Clients page').toHaveLength(KINDS.length);
  for (const kind of KINDS) {
    for (const id of fresh) {
      const text = await page.locator(`#request-${id}`).innerText();
      if (text.includes(kind.label)) run.requestIds.set(kind.key, id);
    }
    expect(run.requestIds.has(kind.key), `a new request for ${kind.label}`).toBe(true);
  }
});

test("an unrelated agency cannot open the traveller's pages or the agency's request, and it looks the same as nothing there", async () => {
  const { page } = unrelated;
  await page.goto(`/app/agency/${NOBODY}`);
  const baseline = await page.getByRole('heading', { level: 1 }).first().innerText();
  const requestId = run.requestIds.get(ACCEPTED_KIND.key) as string;
  expect(requestId, 'the request id was read in the step that asked').toBeTruthy();
  const paths = [
    `/app/agency/${ids.agencyOrg()}/clients`,
    `/app/agency/${ids.agencyOrg()}/clients?request=${requestId}`,
    `/app/applicant/${ids.traveller()}/evidence`,
    `/app/applicant/${ids.traveller()}/evidence?item=${requestId}`,
    `/app/applicant/${ids.traveller()}/evidence/answer`,
    `/app/applicant/${ids.traveller()}/sharing`,
  ];
  for (const path of paths) {
    await expectLooksMissing(page, path, baseline);
    const text = await page.locator('body').innerText();
    expect(text, `${path} leaks no request id`).not.toContain(requestId);
    expect(text, `${path} leaks no traveller id`).not.toContain(ids.traveller());
    for (const kind of KINDS) expect(text, `${path} leaks no kind`).not.toContain(kind.label);
  }
});

test('the traveller opens Requests from Agencies and sees which agency is asking', async () => {
  const { page } = traveller;
  await page.goto(`/app/applicant/${ids.traveller()}/evidence`);
  await expect(page.getByRole('heading', { level: 1, name: UI.requestsHeading })).toBeVisible();
  await requireExactCopyUi(page, UI.answerAction, 'Requests from Agencies');
  const line = (await page.getByText(UI.waitingLine).first().innerText()).trim();
  const match = UI.waitingLine.exec(line);
  expect(match, `the card names one agency and a count: "${line}"`).not.toBeNull();
  run.agencyName = String(match?.[1]);
  expect(Number(match?.[2]), 'at least the three answers asked for').toBeGreaterThanOrEqual(
    KINDS.length,
  );
  // Each request's own panel says who asked.
  for (const kind of KINDS) {
    const id = run.requestIds.get(kind.key) as string;
    await page.goto(`/app/applicant/${ids.traveller()}/evidence?item=${id}`);
    await expect(page.locator(UI.requestPane(id))).toContainText(UI.askedBy(run.agencyName));
  }
  // It is the agency's own name: the agency's own pages carry it too.
  await agency.page.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  await expect(agency.page.locator('body')).toContainText(run.agencyName);
});

test('the traveller answers all three from saved records with one button, and the receipt names each exact copy', async () => {
  test.setTimeout(300_000);
  const { page } = traveller;
  await page.goto(`/app/applicant/${ids.traveller()}/evidence`);
  await page.getByRole('link', { name: UI.answerAction, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: UI.answerHeading })).toBeVisible();
  const reviewAddress = page.url();
  // The files are checked in the background: the review offers each copy only once it is ready.
  const form = page.locator(UI.reviewForm);
  await expect(async () => {
    await page.goto(reviewAddress);
    for (const kind of KINDS) {
      const found =
        (await form
          .getByRole('checkbox', { name: UI.requestName(kind.label), exact: true })
          .count()) + (await form.getByRole('group', { name: UI.requestName(kind.label) }).count());
      expect(found, `${kind.label} is offered once its file is checked`).toBeGreaterThan(0);
    }
  }).toPass({ timeout: 150_000, intervals: [5_000, 10_000] });

  for (const kind of KINDS) {
    run.copyNames.set(kind.key, await chooseCopy(form, kind, first.get(kind.key) as SyntheticFile));
  }
  // Only the three: anything else that was ticked on its own is left for another day.
  const wanted = new Set(KINDS.map((kind) => UI.requestName(kind.label)));
  const boxes = form.getByRole('checkbox');
  for (let index = 0; index < (await boxes.count()); index += 1) {
    const box = boxes.nth(index);
    const name = await box.evaluate((element) => {
      const id = element.getAttribute('aria-labelledby') ?? '';
      return document.getElementById(id)?.textContent?.trim() ?? '';
    });
    if (!wanted.has(name) && (await box.isChecked())) await box.uncheck();
  }

  const send = form.getByRole('button', {
    name: UI.sendButton(KINDS.length, run.agencyName),
    exact: true,
  });
  await expect(send, 'one button that says how many go and to whom').toBeVisible();
  await send.click();
  await page.waitForURL(new RegExp(`[?&]${UI.receiptParam}=`), { timeout: 60_000 });
  run.receiptPath = new URL(page.url()).pathname + new URL(page.url()).search;

  await expect(page.getByText(UI.receiptSummary(KINDS.length, run.agencyName))).toBeVisible();
  const receipt = await readReceipt(page);
  expect(receipt, 'one line for each exact copy').toHaveLength(KINDS.length);
  for (const kind of KINDS) {
    const copyName = run.copyNames.get(kind.key) as string;
    const sent = receipt.find((entry) => entry.name === copyName);
    expect(sent, `the receipt names the copy "${copyName}"`).toBeDefined();
    expect(sent?.fingerprint.length, 'a fingerprint is named').toBeGreaterThan(0);
    expect(sent?.text, 'nobody has reviewed it yet').toContain(UI.stateReceived);
    run.firstReceipt.set(kind.key, sent as SentCopy);
  }
  // The receipt is the record, not the page's memory: the same address shows it again.
  await page.goto(run.receiptPath);
  expect(await readReceipt(page)).toEqual(receipt);
});

test('the agency sees the exact copies, accepts one and sends one back with a reason', async () => {
  const { page } = agency;
  // Each copy as the traveller's receipt named it: same name, same fingerprint.
  for (const kind of KINDS) {
    const sent = run.firstReceipt.get(kind.key) as SentCopy;
    const row = await agencyRowFor(page, sent.name);
    await expect(row).toContainText(UI.copyWaiting);
    await expect(row).toContainText(UI.receivedNotAccepted);
    await expect(row).toContainText(UI.sendRound(1));
    await expect(row.locator(UI.copyName).first()).toHaveText(sent.name);
    await expect(row.locator(UI.fingerprintCode).first()).toHaveText(sent.fingerprint);
  }
  await requireExactCopyUi(page, UI.acceptButton, 'on the agency request row');

  const acceptedRow = await agencyRowFor(
    page,
    (run.firstReceipt.get(ACCEPTED_KIND.key) as SentCopy).name,
  );
  await acceptedRow.getByRole('button', { name: UI.acceptButton, exact: true }).click();
  await expect(acceptedRow.getByText(UI.accepted, { exact: true })).toBeVisible();

  const backRow = await agencyRowFor(
    page,
    (run.firstReceipt.get(SENT_BACK_KIND.key) as SentCopy).name,
  );
  await backRow.getByRole('button', { name: UI.sendBackButton }).click();
  await backRow.getByLabel(UI.reasonField, { exact: true }).fill(REASON);
  await backRow.getByRole('button', { name: UI.reasonSendButton, exact: true }).click();
  await expect(backRow.getByText(UI.sentBack, { exact: true })).toBeVisible();

  // After a reload: the accepted copy is named as accepted; the sent-back one is history with its reason.
  const afterAccept = await agencyRowFor(
    page,
    (run.firstReceipt.get(ACCEPTED_KIND.key) as SentCopy).name,
  );
  await expect(afterAccept).toContainText(UI.copyAccepted);
  const afterBack = await agencyRowFor(
    page,
    (run.firstReceipt.get(SENT_BACK_KIND.key) as SentCopy).name,
  );
  await expect(afterBack).toContainText(UI.reasonSeenByAgency(REASON));
  // The third copy has had no decision.
  const waiting = await agencyRowFor(
    page,
    (run.firstReceipt.get(WAITING_KIND.key) as SentCopy).name,
  );
  await expect(waiting).toContainText(UI.copyWaiting);
});

test('the traveller sees the sent-back round, replaces the copy with a clearer one and sends it; the first round stays in the history', async () => {
  test.setTimeout(300_000);
  const { page } = traveller;
  const requestId = run.requestIds.get(SENT_BACK_KIND.key) as string;
  const firstName = (run.firstReceipt.get(SENT_BACK_KIND.key) as SentCopy).name;
  await page.goto(`/app/applicant/${ids.traveller()}/evidence?item=${requestId}`);
  const pane = page.locator(UI.requestPane(requestId));
  await expect(pane).toBeVisible();
  const thread = pane.getByRole('region', { name: UI.conversation });
  await expect(thread).toContainText(UI.youSent(firstName));
  await expect(thread).toContainText(UI.threadSentBack);
  await expect(thread).toContainText(UI.reasonSeenByTraveller(REASON));
  await expect(pane.getByText(UI.sentBackTag)).toBeVisible();
  // Upload a Clearer Copy: the same steps as Replace with a Newer Document, started from the sent-back copy.
  const clearerToggle = pane.locator('summary').filter({ hasText: UI.uploadClearerCopy });
  if ((await clearerToggle.count()) === 0) {
    blocked(
      `the deployed page for a sent-back request does not show a control named ${UI.uploadClearerCopy}. The exact-copy work is not deployed to this target, or its wording changed (update selectors.ts)`,
    );
  }
  await clearerToggle.click();
  const steps = pane.locator(UI.replaceSteps);
  await expect(steps.getByRole('heading', { name: UI.replaceHeading })).toBeVisible();
  await steps
    .getByLabel(UI.addNewerFile)
    .setInputFiles({ name: clearer.name, mimeType: clearer.mimeType, buffer: clearer.buffer });
  await steps.getByRole('button', { name: UI.addNewerButton }).click();
  const candidate = steps.getByRole('radio', {
    name: new RegExp(escapeForPattern(clearer.name.replace(/\.png$/, ''))),
  });
  // The new file is checked first: wait until it can be chosen, asking again when the page offers to.
  await expect(async () => {
    const again = steps.getByRole('button', { name: UI.checkAgain });
    if ((await candidate.count()) > 0 && (await candidate.isEnabled())) return;
    if ((await again.count()) > 0) await again.click();
    throw new Error('the clearer copy is still being checked');
  }).toPass({ timeout: 150_000, intervals: [5_000, 10_000] });
  await candidate.check();
  await steps.getByRole('button', { name: UI.continueButton }).click();
  await steps.getByRole('button', { name: UI.replaceButton, exact: true }).click();
  await expect(steps.getByRole('heading', { name: UI.replacedHeading })).toBeVisible();
  await steps.getByRole('button', { name: UI.doneButton, exact: true }).click();

  // The list of copies now offers the clearer one; the person chooses it and sends it.
  const choices = pane.getByRole('group', { name: UI.chooseTheCopy });
  const clearerChoice = choices.getByRole('radio', {
    name: new RegExp(escapeForPattern(clearer.name.replace(/\.png$/, ''))),
  });
  await expect(clearerChoice).toBeVisible();
  await clearerChoice.check();
  await pane.getByRole('button', { name: UI.sendToAgency }).click();
  await expect(pane.getByText(UI.answerSent, { exact: true })).toBeVisible({ timeout: 30_000 });
  run.replacementName = clearer.name.replace(/\.png$/, '');

  // Both rounds are in the history: the first, sent back with its reason, and the second.
  await page.goto(`/app/applicant/${ids.traveller()}/evidence?item=${requestId}`);
  const history = page
    .locator(UI.requestPane(requestId))
    .getByRole('region', { name: UI.conversation });
  await expect(history).toContainText(UI.youSent(firstName));
  await expect(history).toContainText(UI.reasonSeenByTraveller(REASON));
  await expect(history).toContainText(UI.youSent(run.replacementName));
});

test('the agency sees the clearer copy and the first round, and accepts the clearer copy', async () => {
  const { page } = agency;
  const firstName = (run.firstReceipt.get(SENT_BACK_KIND.key) as SentCopy).name;
  const row = await agencyRowFor(page, firstName);
  await expect(row).toContainText(UI.copyWaiting);
  await expect(row.locator(UI.copyName).first()).toContainText(run.replacementName);
  await expect(row).toContainText(UI.sendRound(2));
  // The first round: the fold of earlier sends, its copy and the reason the agency gave.
  await expect(row).toContainText(UI.earlierSends(1));
  await expect(row).toContainText(UI.earlierSendLine(1, firstName));
  await expect(row).toContainText(UI.reasonSeenByAgency(REASON));
  await row.getByRole('button', { name: UI.acceptButton, exact: true }).click();
  await expect(row.getByText(UI.accepted, { exact: true })).toBeVisible();
  const after = await agencyRowFor(page, firstName);
  await expect(after).toContainText(UI.copyAccepted);
});

test('a newer document added later does not change what the earlier receipt names', async () => {
  test.setTimeout(300_000);
  const { page } = traveller;
  await addDocument(page, SENT_BACK_KIND, newer);
  expect(run.receiptPath, 'the receipt address was kept by the step that sent').toBeTruthy();
  await page.goto(run.receiptPath);
  const again = await readReceipt(page);
  expect(again, 'the same three copies').toHaveLength(KINDS.length);
  for (const kind of KINDS) {
    const before = run.firstReceipt.get(kind.key) as SentCopy;
    const line = again.find((entry) => entry.name === before.name);
    expect(line, `the earlier receipt still names "${before.name}"`).toBeDefined();
    expect(line?.version, 'same version').toBe(before.version);
    expect(line?.fingerprint, 'same fingerprint').toBe(before.fingerprint);
  }
  const text = await page.locator('body').innerText();
  expect(text, 'the newer document is not on the earlier receipt').not.toContain(newer.name);
  // Where each copy stands now is read from the records: the decisions made since are shown.
  const byName = (kind: Kind) => again.find((entry) => entry.name === run.copyNames.get(kind.key));
  expect(byName(ACCEPTED_KIND)?.text).toContain(UI.stateAccepted);
  expect(byName(SENT_BACK_KIND)?.text).toContain(UI.stateSentBack);
  expect(byName(WAITING_KIND)?.text).toContain(UI.stateReceived);
});

for (const size of WIDTHS.filter((entry) => entry.width === 390 || entry.width === 1280)) {
  test(`the pages of this journey work at ${size.width}px: no serious accessibility finding, no sideways scroll`, async ({
    browser: _browser,
  }, info) => {
    const pages: ReadonlyArray<readonly [Page, string, string]> = [
      [traveller.page, `/app/applicant/${ids.traveller()}/evidence`, 'requests'],
      [traveller.page, run.receiptPath, 'receipt'],
      [agency.page, `/app/agency/${ids.agencyOrg()}/clients`, 'agency-requests'],
    ];
    for (const [page, path, name] of pages) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await expectNoSidewaysScroll(page);
      await checkAccessibility(page, info);
      await keepScreenshot(page, info, `answer-${name}-${size.width}.png`);
    }
  });
}

test('the traveller ends the agency access and the agency loses the pages', async () => {
  expect(run.agencyName, 'the agency name was read in an earlier step').toBeTruthy();
  const { page } = traveller;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/app/applicant/${ids.traveller()}/sharing`);
  const row = page
    .locator(UI.grantRow)
    .filter({ hasText: run.agencyName })
    .filter({ hasNotText: UI.revokedWord });
  await expect(row, 'one live grant to this agency').toHaveCount(1);
  const grantId = await row.getAttribute('data-row');
  await row.locator(UI.grantRowLink).click();
  const pane = page.locator(`#lp-pane-${grantId}`);
  await pane.getByRole('button', { name: UI.revokeButton }).click();
  // The page asks first; the confirm button's words are sharing/grant-op-buttons.tsx:11.
  await pane.getByRole('button', { name: 'Yes, Revoke Access' }).click();
  await expect(page.getByText(UI.accessRevoked).first()).toBeVisible({ timeout: 30_000 });

  // The agency's next request: the traveller's requests and copies are gone from its pages.
  const aPage = agency.page;
  await aPage.goto(`/app/agency/${ids.agencyOrg()}/clients`);
  const body = await aPage.locator('body').innerText();
  for (const kind of KINDS) {
    const id = run.requestIds.get(kind.key) as string;
    await expect(aPage.locator(`#request-${id}`), `${kind.label} request is gone`).toHaveCount(0);
    expect(body, 'no copy of the traveller is named').not.toContain(
      run.copyNames.get(kind.key) as string,
    );
  }
  const linked = run.requestIds.get(ACCEPTED_KIND.key) as string;
  await aPage.goto(`/app/agency/${ids.agencyOrg()}/clients?request=${linked}`);
  await expect(aPage.locator(`#request-${linked}`)).toHaveCount(0);
  // The traveller's own record stays closed to the agency, as it was before.
  await aPage.goto(`/app/applicant/${NOBODY}/evidence`);
  const baseline = await aPage.getByRole('heading', { level: 1 }).first().innerText();
  await expectLooksMissing(aPage, `/app/applicant/${ids.traveller()}/evidence`, baseline);
});
