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
]);
