import type { MissionState } from '@visastack/core';
import type { RequirementResultState } from '@visastack/services';
import { CLOSED_REQUEST_LABELS, REQUEST_ITEM_STATUS_LABELS } from './labels';

/**
 * The one chip vocabulary of the signed-in screens: the word on a row's status chip and its tone.
 * Green, amber and red are states (on file, to check, needs you); blue is "received" and is never
 * green, because received is not reviewed. The word is the specific one (Missing, Out of Date, To
 * Confirm); the group a row sits in (Needs You, Needs a Check) is the folder header. Rows on every
 * list screen draw their chip from here, and the pattern conformance test checks that they do.
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusWord {
  readonly word: string;
  readonly tone: StatusTone;
}

/** A checklist item's outcome, in the word a person reads on its row. */
export const REQUIREMENT_STATUS: Readonly<Record<RequirementResultState, StatusWord>> = {
  CRITICAL_GAP: { word: 'Missing', tone: 'danger' },
  CONFLICTING: { word: 'Two Values', tone: 'danger' },
  EXPIRING_STALE: { word: 'Out of Date', tone: 'danger' },
  UNVERIFIED: { word: 'To Confirm', tone: 'warning' },
  ATTENTION: { word: 'Optional', tone: 'neutral' },
  SATISFIED: { word: 'On File', tone: 'success' },
  NOT_APPLICABLE: { word: 'Not Applicable', tone: 'neutral' },
};

/** An optional line that another option on the checklist already covers. */
export const COVERED_STATUS: StatusWord = { word: 'Covered by Another Option', tone: 'success' };

/** Something received but not yet reviewed: blue, never green. */
export const RECEIVED_STATUS: StatusWord = { word: 'Received', tone: 'info' };

/** The file or answer that backs an item, shown when the choice can no longer change. */
export const CHOSEN_STATUS: StatusWord = { word: 'Chosen', tone: 'success' };

/** A file that cannot back an item (not eligible, too old for the route, freshness not known). */
export const NOT_ELIGIBLE_STATUS: StatusWord = { word: 'Not Eligible', tone: 'danger' };
export const TOO_OLD_STATUS: StatusWord = { word: 'Too Old for This Route', tone: 'danger' };
export const FRESHNESS_UNKNOWN_STATUS: StatusWord = { word: 'Freshness Unknown', tone: 'neutral' };

/**
 * A sharing grant's state on its row. The words are the ones the grant's own badge already uses
 * (`grantStatusBadge`, from the translated messages); a test keeps the two equal.
 */
export const GRANT_STATUS: Readonly<Record<string, StatusWord>> = {
  PENDING_ACCEPTANCE: { word: 'Pending Acceptance', tone: 'info' },
  ACTIVE: { word: 'Active', tone: 'success' },
  PAUSED: { word: 'Paused', tone: 'warning' },
  REVOKED: { word: 'Revoked', tone: 'neutral' },
  EXPIRED: { word: 'Expired', tone: 'neutral' },
};

/** A sharing invitation's state on its row. A pending one past its end day reads Expired. */
export const INVITATION_STATUS: Readonly<Record<string, StatusWord>> = {
  PENDING: { word: 'Pending', tone: 'info' },
  ACCEPTED: { word: 'Accepted', tone: 'success' },
  REVOKED: { word: 'Revoked', tone: 'neutral' },
  EXPIRED: { word: 'Expired', tone: 'neutral' },
};

/**
 * A case's stage on the Trips list, in the word a traveller reads and the colour that says how
 * urgent it is: amber means a step is still to do, red means it is waiting on you, blue means
 * someone else is working or has the case, green means ready, grey means finished. Submitted is
 * blue and never reads "Approved": VisaStack does not know the decision. The five stages that
 * only older cases carry (`LEGACY_ONLY_MISSION_STATES`) read as the nearest stage and keep their
 * stored value; a test holds every stored stage to a word here.
 */
export const CASE_STATUS: Readonly<Record<MissionState, StatusWord>> = {
  DRAFT: { word: 'Getting Started', tone: 'warning' },
  INTAKE: { word: 'Gathering Documents', tone: 'warning' },
  IN_REVIEW: { word: 'Being Checked', tone: 'info' },
  AWAITING_APPLICANT: { word: 'Needs You', tone: 'danger' },
  SUBMISSION_READY: { word: 'Ready to Submit', tone: 'success' },
  SUBMITTED: { word: 'Submitted', tone: 'info' },
  CLOSED: { word: 'Closed', tone: 'neutral' },
  CANCELLED: { word: 'Cancelled', tone: 'neutral' },
  // Older cases: the nearest stage above.
  IN_PROGRESS: { word: 'Gathering Documents', tone: 'warning' },
  READY_FOR_REVIEW: { word: 'Being Checked', tone: 'info' },
  UNDER_REVIEW: { word: 'Being Checked', tone: 'info' },
  READY_TO_EXPORT: { word: 'Ready to Submit', tone: 'success' },
  LOCKED: { word: 'Closed', tone: 'neutral' },
};

/** A case stage a person has not met before reads as the plainest word, never as the stored code. */
const UNKNOWN_CASE_STATUS: StatusWord = { word: 'Getting Started', tone: 'warning' };

/** The word and tone for a case's stored stage. */
export function caseStatus(state: string): StatusWord {
  return (CASE_STATUS as Readonly<Record<string, StatusWord>>)[state] ?? UNKNOWN_CASE_STATUS;
}

/** Every chip word a list row may carry. */
export const CHIP_WORDS: ReadonlySet<string> = new Set([
  ...Object.values(REQUIREMENT_STATUS).map((status) => status.word),
  COVERED_STATUS.word,
  RECEIVED_STATUS.word,
  CHOSEN_STATUS.word,
  NOT_ELIGIBLE_STATUS.word,
  TOO_OLD_STATUS.word,
  FRESHNESS_UNKNOWN_STATUS.word,
  // A request's words come from the one set of labels the agency's own summary uses.
  ...Object.values(REQUEST_ITEM_STATUS_LABELS),
  ...Object.values(CLOSED_REQUEST_LABELS),
  ...Object.values(GRANT_STATUS).map((status) => status.word),
  ...Object.values(INVITATION_STATUS).map((status) => status.word),
  ...Object.values(CASE_STATUS).map((status) => status.word),
]);
