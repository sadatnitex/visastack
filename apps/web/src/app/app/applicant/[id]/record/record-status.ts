import {
  STATUS_KINDS,
  type StatusKind,
} from '../../../../../components/pictures/status-picture-words';

/** The six kinds by their place in the shared list (no state is typed a second time here). */
const [ENTERED, SUGGESTED, , , MISMATCH, NO_LONGER_CURRENT] = STATUS_KINDS;

/**
 * The one status picture each Record state wears (U6). The six pictures are the Wallet's own
 * (ADR 0030); this file only chooses which drawing fits each state the Record can say, and names
 * the message-catalogue key of the one plain sentence for its Explain note. The name beside the
 * picture is always the state's own word from `record-hub.ts`, so a screen reader and a person
 * pointing at the picture hear the same thing the row says.
 *
 * The rule: the green Backed by a Document picture is never used here. The Record does not know
 * that a file backs a value (a typed profile section has no file, and a Current Version only
 * passed its safety check), so a finished state wears the plain thin ring (Entered) and anything
 * still open (checking, waiting for you, incomplete, nothing yet) wears the dashed ring.
 */

const SENTENCES = {
  currentVersion: 'appApplicant.appApplicantIdRecordRow.stateCurrentVersion',
  currentVersionDated: 'appApplicant.appApplicantIdRecordRow.stateCurrentVersionDated',
  expiringSoon: 'appApplicant.appApplicantIdRecordRow.stateExpiringSoon',
  needsYourCheck: 'appApplicant.appApplicantIdRecordRow.stateNeedsYourCheck',
  partlyFilledIn: 'appApplicant.appApplicantIdRecordRow.statePartlyFilledIn',
  stillBeingChecked: 'appApplicant.appApplicantIdRecordRow.stateStillBeingChecked',
  nothingSavedYet: 'appApplicant.appApplicantIdRecordRow.stateNothingSavedYet',
  allDetailsSaved: 'appApplicant.appApplicantIdRecordRow.stateAllDetailsSaved',
  cannotBeUsed: 'appApplicant.appApplicantIdRecordRow.stateCannotBeUsed',
  expired: 'appApplicant.appApplicantIdRecordRow.stateExpired',
  previousVersion: 'appApplicant.appApplicantIdRecordRow.statePreviousVersion',
  savedHere: 'appApplicant.appApplicantIdRecordRow.stateSavedHere',
} as const;

export type RecordSentenceKey = (typeof SENTENCES)[keyof typeof SENTENCES];

interface RecordStatusPicture {
  readonly kind: StatusKind;
  /** The message-catalogue key of the one sentence the Explain note shows. */
  readonly sentenceKey: RecordSentenceKey;
}

const PICTURES: Readonly<Record<string, RecordStatusPicture>> = {
  'Current Version': { kind: ENTERED, sentenceKey: SENTENCES.currentVersion },
  'Expiring Soon': { kind: SUGGESTED, sentenceKey: SENTENCES.expiringSoon },
  'Needs Your Check': { kind: SUGGESTED, sentenceKey: SENTENCES.needsYourCheck },
  'Partly Filled In': { kind: SUGGESTED, sentenceKey: SENTENCES.partlyFilledIn },
  'Still Being Checked': { kind: SUGGESTED, sentenceKey: SENTENCES.stillBeingChecked },
  'Nothing Saved Yet': { kind: SUGGESTED, sentenceKey: SENTENCES.nothingSavedYet },
  'All Details Saved': { kind: ENTERED, sentenceKey: SENTENCES.allDetailsSaved },
  'Cannot Be Used': { kind: MISMATCH, sentenceKey: SENTENCES.cannotBeUsed },
  Expired: { kind: MISMATCH, sentenceKey: SENTENCES.expired },
  'Previous Version': { kind: NO_LONGER_CURRENT, sentenceKey: SENTENCES.previousVersion },
};

const FALLBACK: RecordStatusPicture = { kind: ENTERED, sentenceKey: SENTENCES.savedHere };

/**
 * The drawing and sentence key for a Record state, by the state's own name. A Current Version
 * says "not past its end date" only when an end date is known (`dated`).
 */
export function recordStatusPicture(label: string, dated = false): RecordStatusPicture {
  const picture = PICTURES[label] ?? FALLBACK;
  return label === 'Current Version' && dated
    ? { ...picture, sentenceKey: SENTENCES.currentVersionDated }
    : picture;
}
