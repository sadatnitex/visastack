import { type Locator, type Page, expect } from '@playwright/test';
import { blocked } from './setup';

/**
 * Every name a signed-in journey looks for on a page, in one place. A rename in the product is
 * then a one-file change here, not a hunt through the specs.
 *
 * `VERIFIED_IN_SOURCE` names were read from the code at the revision this suite was written
 * against; they have not been run against a deployed target. `AWAITING_LANES_D_E` names belong to
 * the exact-copy work (evidence version pinning and the agency loop) that was not merged when
 * this was written: they are the names the design documents promise, so each use is guarded by
 * `requireExactCopyUi`, which fails the journey as BLOCKED when the deployed page does not show
 * them. Change them here when Lanes D and E settle their wording.
 */

export const VERIFIED_IN_SOURCE = {
  /** documents/add: the hidden file input behind "Choose Files". */
  importFilesTestId: 'import-files',
  documentFinder: 'Find a Document',
  decisionCard: 'Needs One Decision',
  createCaseButton: 'Create Case',
  caseTitleField: 'What is this case for?',
  caseDestinationField: 'Where are you going?',
  casePurposeField: 'What is the trip for?',
  caseCentreField: 'Embassy or Visa Centre (Optional)',
  moreDetails: 'Add More Details (Optional)',
  requestEvidenceButton: 'Request Evidence',
  requestTravellerField: 'Traveller',
  requestKindField: 'What do you need?',
  requestKeyField: 'Which document?',
  notFoundHeading: "We Couldn't Find That Page",
  signOut: 'Sign Out',
} as const;

export const AWAITING_LANES_D_E = {
  /** The traveller chooses which stored copy answers a request (Lane E response picker). */
  pinnedCopyPicker: /copy to send|choose a copy|which copy/i,
  /** The agency's review shows the exact copy that was sent (Lane D/E exact-copy label). */
  exactCopyLabel: /exact copy|copy sent|sent copy/i,
  /** Agency actions on a submission (Lane E). */
  rejectButton: /^(Send Back|Reject)/i,
  rejectReasonField: /reason/i,
  acceptButton: /^Accept/i,
  /** The traveller revokes or lets an agency's access end (existing sharing page wording). */
  revokeButton: /^(Revoke|Stop Sharing|End Access)/i,
} as const;

/** Whether the page shows a control matching `name` as a combobox, button or labelled field. */
async function shows(page: Page, name: RegExp): Promise<boolean> {
  for (const role of ['combobox', 'button', 'radio', 'link'] as const) {
    if ((await page.getByRole(role, { name }).count()) > 0) return true;
  }
  return (await page.getByLabel(name).count()) > 0;
}

/**
 * The deployed target must show an exact-copy control before a journey that depends on one runs;
 * otherwise the feature is not there (or was renamed) and the journey is BLOCKED rather than
 * tested against a page that cannot prove anything.
 */
export async function requireExactCopyUi(page: Page, name: RegExp, where: string): Promise<void> {
  if (!(await shows(page, name))) {
    blocked(
      `the deployed page ${where} does not show a control named ${name}. The exact-copy work (Lanes D and E) is not deployed to this target, or its wording changed (update selectors.ts)`,
    );
  }
}

/** Picks the option of a select whose visible text matches (a select accepts only exact text). */
export async function selectByText(select: Locator, pattern: RegExp): Promise<string> {
  const options = await select.locator('option').allTextContents();
  const found = options.map((text) => text.trim()).find((text) => pattern.test(text));
  expect(found, `no option matching ${pattern} among ${options.length}`).toBeDefined();
  await select.selectOption({ label: found as string });
  return found as string;
}
