import { type Page, expect, test } from '@playwright/test';
import { type SyntheticFile, renderSyntheticPassport } from '../fixtures/synthetic-passport';
import { VERIFIED_IN_SOURCE as S } from './support/selectors';
import { signIn } from './support/session';
import { ids } from './support/setup';

/**
 * Tier 2, traveller journey (docs/operations/staging-journeys.md): add a first document, see it is
 * safe or still being checked, find it again, add a clearer copy, and see a same-file copy handled
 * without confusion. The document is a drawn SPECIMEN page (fixtures/synthetic-passport.ts); no
 * real person's data is used.
 *
 * Runs only in the on-demand staging workflow, against a deployment bound to the synthetic
 * staging database. The names it looks for were read from the source and have not been run against
 * that deployment. Reading and the "new copy" suggestion are done in the background, so the page
 * is reloaded until they appear.
 */

test.describe.configure({ mode: 'serial' });

let first: SyntheticFile;
let clearer: SyntheticFile;
let documentsUrl: string;

async function addFile(page: Page, file: SyntheticFile): Promise<void> {
  await page.goto(`/app/applicant/${ids.traveller()}/documents/add`);
  await page
    .getByTestId(S.importFilesTestId)
    .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await expect(page.getByLabel(`Upload of ${file.name}`)).toBeVisible({ timeout: 30_000 });
}

/** Reloads the documents page until `check` passes, because reading runs in the background. */
async function reloadUntil(page: Page, check: () => Promise<void>, seconds = 150): Promise<void> {
  await expect(async () => {
    await page.goto(documentsUrl);
    await check();
  }).toPass({ timeout: seconds * 1000, intervals: [5_000, 10_000] });
}

test.beforeAll(async ({ browser }) => {
  first = await renderSyntheticPassport(browser, 'first-scan');
  clearer = await renderSyntheticPassport(browser, 'clearer-scan');
  documentsUrl = `/app/applicant/${ids.traveller()}/documents`;
});

test.beforeEach(async ({ page }) => {
  await signIn(page, 'TRAVELLER');
});

test('the first document is added and shows a safety state that says what is true', async ({
  page,
}, info) => {
  await addFile(page, first);
  await reloadUntil(page, async () => {
    await expect(
      page.getByText(first.name.replace(/\.png$/, ''), { exact: false }).first(),
    ).toBeVisible();
  });
  const panel = page.getByRole('complementary', { name: 'Document details' });
  await panel.getByLabel(S.documentFinder).fill('specimen');
  const badge = panel.locator('.document-review-status .badge').first();
  await expect(badge).toBeVisible();
  const state = (await badge.innerText()).trim();
  expect(state.length).toBeGreaterThan(0);
  await info.attach('safety-state.txt', { body: state, contentType: 'text/plain' });
  // A preview button is offered only to a file that is not still being checked.
  const preview = panel.getByRole('button', { name: 'Open Secure Preview' });
  if (/being checked/i.test(state)) await expect(preview).toHaveCount(0);
});

test('the document can be found again by a part of its name', async ({ page }) => {
  await page.goto(documentsUrl);
  const panel = page.getByRole('complementary', { name: 'Document details' });
  await panel.getByLabel(S.documentFinder).fill('first-scan');
  await expect(panel.getByRole('heading', { name: /first-scan/i })).toBeVisible();
  await panel.getByLabel(S.documentFinder).fill('zzz-no-such-file');
  await expect(panel.getByText('No documents match.')).toBeVisible();
});

test('a clearer copy is offered as a new copy and confirming it keeps both files', async ({
  page,
}) => {
  await addFile(page, clearer);
  await reloadUntil(page, async () => {
    await expect(page.locator('.umpe-p3-needs-decision')).toContainText('looks like a new copy of');
  });
  const card = page.locator('.umpe-p3-needs-decision');
  await expect(card).toContainText(
    'Confirm keeps both files and marks the older one as the Earlier Copy.',
  );
  await card.getByRole('button', { name: /^Confirm: .*clearer-scan/ }).click();
  await expect(page.locator('.umpe-p3-decision-status')).not.toBeEmpty();
  await reloadUntil(
    page,
    async () => {
      await expect(page.getByRole('heading', { name: 'Linked Copies' })).toBeVisible();
      await expect(page.locator('.umpe-p3-linked-list')).toContainText('Earlier Copy');
    },
    60,
  );
});

test('the same file added twice is called the same file, and nothing is deleted', async ({
  page,
}) => {
  await addFile(page, clearer);
  await reloadUntil(page, async () => {
    await expect(page.locator('.umpe-p3-needs-decision')).toContainText('is the same file as');
  });
  const card = page.locator('.umpe-p3-needs-decision');
  await expect(card).toContainText('Both files are kept.');
  await card.getByRole('button', { name: /^Keep Separate: .*clearer-scan/ }).click();
  await expect(page.locator('.umpe-p3-decision-status')).not.toBeEmpty();
});

test('the page shows file names and states only: no storage keys, no file fingerprints', async ({
  page,
}) => {
  await page.goto(documentsUrl);
  const html = await page.content();
  expect(html).not.toMatch(/\b[a-f0-9]{64}\b/);
  expect(html).not.toMatch(/r2:\/\/|s3:\/\/|storageKey|storage_key|blob\.vercel-storage/i);
  // The synthetic page is a specimen: its holder's name, never a real one, is all that can show.
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
});
