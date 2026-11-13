import { type Locator, type Page, expect } from '@playwright/test';
import { blocked } from './setup';

/**
 * Every name a signed-in journey looks for on a page, in one place. A rename in the product is
 * then a one-file change here, not a hunt through the specs.
 *
 * `VERIFIED_IN_SOURCE` names were read from the code at the revision this suite was first written
 * against. `EXACT_COPY_UI` names belong to the exact-copy work and the Answer from Your Records
 * review (both merged); each one was read from the product source and carries the file and line it
 * comes from (paths are under apps/web/src; line numbers are those of the revision this was
 * written against, so a drift of a few lines is a reason to look, not a failure). Nothing in this
 * file has met a deployed page yet. Each use of an exact-copy control is guarded by
 * `requireExactCopyUi`, which fails the journey as BLOCKED when the deployed page does not show it.
 *
 * Words the product builds from a pattern (a count, an agency name) are functions here, so the
 * pattern is written once, next to the source line it mirrors.
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
  requestSearchField: 'Search Documents and Details',
  notFoundHeading: "We Couldn't Find That Page",
  signOut: 'Sign Out',
} as const;

export const EXACT_COPY_UI = {
  // ---- Traveller: Requests from Agencies (app/app/applicant/[id]/evidence/) ----
  /** The page's h1. i18n/applicant-evidence.ts:28; page.tsx PageHeader title. */
  requestsHeading: 'Requests from Agencies',
  /** The one link on the card above the list. i18n/evidence-answer.ts:118; answer-from-records-card.tsx:58. */
  answerAction: 'Answer from Your Records',
  /**
   * The card's line when exactly one agency waits: "{agency} is waiting for {count} answers".
   * i18n/evidence-answer.ts:114-115; answer-from-records-card.tsx:35 (marked as data, one line).
   * Group 1 is the agency's name, group 2 the count.
   */
  waitingLine: /^(.+) is waiting for (\d+) answers?$/,
  /** "Asked by {agency}" in each request's panel. i18n/evidence-answer.ts:119; evidence/request-panes.tsx:153. */
  askedBy: (agency: string): string => `Asked by ${agency}`,
  /** The panel of one request: the list pattern gives every panel this id. components/list-pattern/list-with-pane.tsx:214. */
  requestPane: (requestId: string): string => `#lp-pane-${requestId}`,

  // ---- Traveller: the review (evidence/answer/) ----
  /** The review's h1. i18n/evidence-answer.ts:12; evidence/answer/page.tsx:105. */
  answerHeading: 'Answer from Your Records',
  /**
   * What a request is called on the review's tick box: "Document: {kind}". The box is named by it
   * (aria-labelledby the name), exactly. evidence/request-name.ts:23; answer/answer-set-form.tsx:147.
   */
  requestName: (kindLabel: string): string => `Document: ${kindLabel}`,
  /** The review's form (one agency, everything ticked goes in one send). answer/answer-set-form.tsx:234. */
  reviewForm: 'form.answer-set-form',
  /** Where the copy's own file name is shown under a single copy's tick box. answer/answer-set-form.tsx:75. */
  copyNameInReview: '.evidence-pick-meta',
  /** A request with several fitting copies is a group of radio buttons named by its legend. answer/answer-set-form.tsx:382,404-410. */
  doNotSendNow: 'Do Not Send Now',
  /**
   * The one button of the review. "Send {count} Answers to {agency}", or "Send 1 Answer to
   * {agency}". i18n/evidence-answer.ts:65-66; answer/answer-set-form.tsx:310.
   */
  sendButton: (count: number, agency: string): string =>
    count === 1 ? `Send 1 Answer to ${agency}` : `Send ${count} Answers to ${agency}`,
  /** The address says which send the receipt is for. answer/answer-set-form.tsx:212-213. */
  receiptParam: 'done',

  // ---- Traveller: the receipt after a send (evidence/answer/answers-sent.tsx) ----
  /** The receipt's heading. i18n/evidence-answer.ts:31; answers-sent.tsx:45-47. */
  receiptHeading: 'Answers Sent',
  /** "{n} exact copies went to {agency}." (one: "1 exact copy"). i18n/evidence-answer.ts:32-34; answers-sent.tsx:48. */
  receiptSummary: (count: number, agency: string): string =>
    count === 1 ? `1 exact copy went to ${agency}.` : `${count} exact copies went to ${agency}.`,
  /** One line per exact copy. answers-sent.tsx:59. */
  receiptLine: '.answers-sent-line',
  /** The copy's name as it was when sent, inside a line. answers-sent.tsx:60. */
  receiptLineName: '.row-key',
  /**
   * The line's facts: "Version {n} · Fingerprint {fingerprint} · {time}". Group 1 is the version
   * number, group 2 the fingerprint. i18n/evidence-answer.ts:35-36; answers-sent.tsx:63-72.
   */
  receiptFacts: /Version (\d+) · Fingerprint (\S+) · /,
  /** Where a line says where its copy stands now. i18n/evidence-answer.ts:38-40; answers-sent.tsx:22-24. */
  stateReceived: 'Received, Not Yet Reviewed',
  stateAccepted: 'Accepted',
  stateSentBack: 'Sent Back',

  // ---- Traveller: answering one request on its own panel (evidence/submit-response-form.tsx) ----
  /** The choices' legend. i18n/applicant-evidence.ts:49; submit-response-form.tsx:182-196. */
  chooseTheCopy: 'Choose the Copy to Send',
  /** The tag on the copy the agency sent back. i18n/applicant-evidence.ts:59; submit-response-form.tsx:247-251. */
  sentBackTag: 'Sent Back by the Agency',
  /** The button; it carries the item's name after these words. submit-response-form.tsx:268-270. */
  sendToAgency: /^Send to the Agency/,
  /** What the panel says after an answer is saved. i18n/applicant-evidence.ts:10; evidence/answer-receipt.tsx:37. */
  answerSent: 'Answer Sent',
  /** The conversation on a request: a region named by this word. components/request-thread/request-thread.tsx:72,84. */
  conversation: 'Conversation',
  /** "You sent {copy name}": one line for every send, newest last. components/request-thread/thread-model.ts:249. */
  youSent: (copyName: string): string => `You sent ${copyName}`,
  /** The word the thread gives a send the agency sent back. components/request-thread/thread-model.ts:12. */
  threadSentBack: 'Sent Back for a Fix',
  /** The agency's reason as the traveller reads it. components/request-thread/thread-model.ts:147. */
  reasonSeenByTraveller: (reason: string): string => `Replacement needed: ${reason}`,

  // ---- Traveller: Upload a Clearer Copy, then Replace with a Newer Document ----
  /** The folding control on a sent-back request; the document's name follows in speech. i18n/applicant-evidence.ts:14; evidence/clearer-copy-panel.tsx:53. */
  uploadClearerCopy: /^Upload a Clearer Copy/,
  /** The box that holds the three steps (choose, confirm, done). documents/manage/replace/replace-action.tsx:191,217,272. */
  replaceSteps: '.lc-replace',
  /** The steps heading. i18n/app-applicant.ts:191; documents/manage/replace/replace-action.tsx:275. */
  replaceHeading: 'Replace with a Newer Document',
  /** The file field and its button. i18n/app-applicant.ts:170-173; replace-action.tsx:352-373. */
  addNewerFile: 'Add the Newer Document',
  addNewerButton: 'Add the Document',
  /** Appears when a check takes a while. i18n/app-applicant.ts:178; replace-action.tsx:345. */
  checkAgain: 'Check Again',
  /** i18n/app-applicant.ts:181,188,182,146; replace-action.tsx:387, 252, 194, 208. */
  continueButton: 'Continue',
  replaceButton: 'Replace',
  replacedHeading: 'Document Replaced',
  doneButton: 'Done',

  // ---- Traveller: adding documents (documents/add) ----
  /** The hidden file input of the upload form that takes a kind (opened by ?type=KEY). document-uploader.tsx:507. */
  documentFilesTestId: 'document-files',
  /** One entry of the list of files being added; its data-status becomes "added" when done. document-uploader.tsx:566. */
  uploadItem: '.upload-item',

  // ---- Agency: the request rows (app/app/agency/[orgId]/clients and neighbours) ----
  /** The folded group that holds the Request Evidence form (closed once requests exist). clients/page.tsx:310; clients/form-group.tsx:38. */
  askGroup: 'details#ask-for-evidence',
  /** A request on the Clients page; its id is `request-<request id>`. clients/page.tsx:451-453. */
  requestRow: '.request-row',
  /** "Copy Waiting for Your Decision" and "Accepted Copy". i18n/app-agency.ts:380,378; evidence-copies.tsx:125-126. */
  copyWaiting: 'Copy Waiting for Your Decision',
  copyAccepted: 'Accepted Copy',
  /** "Received is not Accepted." i18n/app-agency.ts:389; evidence-copies.tsx:154. */
  receivedNotAccepted: 'Received is not Accepted.',
  /** The word before the short code. i18n/app-agency.ts:388; evidence-copies.tsx:96. */
  fingerprint: 'Fingerprint',
  /** The code itself. evidence-copies.tsx:97. */
  fingerprintCode: '.evidence-copy-code',
  /** The copy's name on the card. evidence-copies.tsx:136. */
  copyName: '.evidence-copy-name',
  /** "Send {n}" on the card's facts line. evidence-copies.tsx:85. */
  sendRound: (round: number): string => `Send ${round}`,
  /** The fold of earlier sends: "Earlier Sends ({n})". i18n/app-agency.ts:386-387; evidence-copies.tsx:343. */
  earlierSends: (count: number): string => `Earlier Sends (${count})`,
  /** An earlier send's line: "Send {n}: {copy name}". i18n/app-agency.ts:390; evidence-copies.tsx:232-236. */
  earlierSendLine: (round: number, copyName: string): string => `Send ${round}: ${copyName}`,
  /** "Your reason, shown to the traveller: {reason}". i18n/app-agency.ts:399-400; evidence-copies.tsx:247. */
  reasonSeenByAgency: (reason: string): string => `Your reason, shown to the traveller: ${reason}`,
  /** The decision buttons. evidence-request-actions.tsx:103 (Accept), 116 and i18n/app-agency.ts:423 (Needs Replacement). */
  acceptButton: 'Accept',
  sendBackButton: 'Needs Replacement',
  /** The reason box (an input labelled "Reason") and its Send button. i18n/app-agency.ts:425; evidence-request-actions.tsx:182,187. */
  reasonField: 'Reason',
  reasonSendButton: 'Send',
  /** What the agency is told after a decision. app/app/agency/[orgId]/actions.ts:226-227. */
  accepted: 'Accepted.',
  sentBack: 'Replacement requested.',

  // ---- Traveller: ending access (app/app/applicant/[id]/sharing/) ----
  /** A grant is a row (inside its own wrapper, so an invitation's row is not one); its panel holds the buttons. sharing/page.tsx:573; components/list-pattern/list-row.tsx:92-93,109. */
  grantRow: '.sharing-grant-item [data-pattern="list-row"]',
  grantRowLink: 'a[data-pane-open]',
  /** The button that asks first (the confirm button's own words are in the spec that ends access). sharing/grant-pane.tsx:145. */
  revokeButton: /^Revoke$/,
  /** What the page says once it is done, after it reloads. lib/success-lines.ts:115. */
  accessRevoked: 'Access revoked. They lose it on their next request.',
  /** The word on an ended grant's row. lib/status-words.ts:52. */
  revokedWord: 'Revoked',
} as const;

/** Whether the page shows a control matching `name` as a field, button, choice or link. */
async function shows(page: Page, name: RegExp | string): Promise<boolean> {
  for (const role of ['combobox', 'button', 'radio', 'checkbox', 'link'] as const) {
    if ((await page.getByRole(role, { name }).count()) > 0) return true;
  }
  return (await page.getByLabel(name).count()) > 0;
}

/**
 * The deployed target must show an exact-copy control before a journey that depends on one runs;
 * otherwise the feature is not there (or was renamed) and the journey is BLOCKED rather than
 * tested against a page that cannot prove anything.
 */
export async function requireExactCopyUi(
  page: Page,
  name: RegExp | string,
  where: string,
): Promise<void> {
  if (!(await shows(page, name))) {
    blocked(
      `the deployed page ${where} does not show a control named ${String(name)}. The exact-copy work or the Answer from Your Records review is not deployed to this target, or its wording changed (update selectors.ts)`,
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
