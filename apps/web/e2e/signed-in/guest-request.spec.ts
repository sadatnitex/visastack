import { expect, test } from '@playwright/test';
import { renderSyntheticPassport } from '../fixtures/synthetic-passport';
import { guestRecipient, waitForGuestCode } from './support/inbox';
import { selectByText } from './support/selectors';
import { signIn } from './support/session';
import { configured, ids } from './support/setup';

/**
 * Tier 2, guest private request (docs/operations/staging-journeys.md): an agency asks a person who
 * has no account for documents; the person opens the private link, proves they own the address
 * with a code emailed to it, adds a file, sends it, and the agency sees the same answer. The link
 * alone gives the visitor nothing, and nothing is shared when it is opened.
 *
 * Needs the capture inbox described in support/inbox.ts (E2E_GUEST_INBOX_URL, E2E_GUEST_INBOX_TOKEN,
 * E2E_GUEST_RECIPIENT_EMAIL) and the agency collection desk switched on in the staging deployment.
 * Without them every step here is BLOCKED. Labels were read from the source and not run against a
 * deployment. The issued checklist is frozen: this checks the guest sees what was issued, but the
 * "frozen revision" guarantee itself is held by the service tests, not by this browser run.
 */

test.describe.configure({ mode: 'serial' });

const shared: { link?: string; fileName?: string } = {};

test('the agency creates and issues a request for a guest', async ({ page }) => {
  guestRecipient();
  configured('E2E_GUEST_INBOX_URL');
  configured('E2E_GUEST_INBOX_TOKEN');
  await signIn(page, 'AGENCY_ADMIN');
  await page.goto(`/app/agency/${ids.agencyOrg()}/collection/new`);
  await selectByText(page.getByLabel('Destination'), /United Kingdom/i);
  await page.getByLabel('Name', { exact: true }).fill('Specimen Guest');
  await page.getByLabel('Email', { exact: true }).fill(guestRecipient());
  await page.getByRole('button', { name: 'Create Request' }).click();
  await expect(page).toHaveURL(/\/collection\/request/, { timeout: 30_000 });
  await page.getByRole('button', { name: /^Issue( a New Revision| Request)?$/ }).click();
  const link = page.locator('input[readonly]').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  shared.link = await link.inputValue();
  expect(shared.link).toMatch(/^https?:\/\//);
  // The link is only ever shown once, to the agency, and is kept out of the report.
});

test('opening the link shows nothing about the request and signs nobody in', async ({
  browser,
}) => {
  expect(shared.link, 'the request was issued in the previous step').toBeTruthy();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(shared.link as string);
    // The visitor is asked to prove who they are before any file or detail is shown.
    await expect(page.getByRole('button', { name: /Email Me a Code/ })).toBeVisible();
    const text = (await page.locator('main').innerText()).toLowerCase();
    expect(text).not.toContain(guestRecipient().toLowerCase());
    expect(text).not.toMatch(/passport number|bank statement|date of birth/);
    // The token does not stay in the address bar.
    expect(page.url()).not.toContain(
      new URL(shared.link as string).searchParams.get('token') ?? '@@',
    );
    // No wallet, no workspace: the signed-in area still turns this visitor away.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  } finally {
    await context.close();
  }
});

test('a wrong code is refused with a message that is announced', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(shared.link as string);
    await page.getByRole('button', { name: /Email Me a Code/ }).click();
    await page.getByLabel(/code/i).fill('000000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[role="alert"], [role="status"], output').first()).toContainText(
      /.+/,
    );
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('the guest proves their address, adds a file and sends it', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(shared.link as string);
    const asked = Date.now();
    await page.getByRole('button', { name: /Email Me a Code/ }).click();
    await page.getByLabel(/code/i).fill(await waitForGuestCode(asked));
    await page.getByRole('button', { name: 'Continue' }).click();
    const file = await renderSyntheticPassport(browser, 'clearer-scan');
    shared.fileName = file.name;
    await page
      .getByLabel('Files to Add')
      .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    await expect(page.getByText(file.name).first()).toBeVisible({ timeout: 60_000 });
    await page
      .getByRole('button', { name: /^(Send|Submit)/i })
      .first()
      .click();
    await expect(page.getByText(/sent|received|thank/i).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.close();
  }
});

test('the agency sees the same file the guest sent', async ({ page }) => {
  await signIn(page, 'AGENCY_ADMIN');
  await page.goto(`/app/agency/${ids.agencyOrg()}/collection`);
  await page
    .getByRole('link', { name: /Specimen Guest/ })
    .first()
    .click();
  expect(shared.fileName, 'the guest sent a file in the previous step').toBeTruthy();
  await expect(page.getByText(shared.fileName as string).first()).toBeVisible();
});
