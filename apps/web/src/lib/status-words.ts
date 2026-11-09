import type { RequirementResultState } from '@visastack/services';

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

/** Every chip word a list row may carry. */
export const CHIP_WORDS: ReadonlySet<string> = new Set([
  ...Object.values(REQUIREMENT_STATUS).map((status) => status.word),
  COVERED_STATUS.word,
  RECEIVED_STATUS.word,
]);
