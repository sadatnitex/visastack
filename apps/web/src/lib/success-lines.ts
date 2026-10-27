import { readyNote } from './readiness-words';

/**
 * What the main flows say when they work: one specific line that names what happened and what
 * it means next, and the checklist count where it is known. Shown on screen only; no name,
 * number or address of a person goes into a line, because a line can end up in a log or a test
 * report. Where a count is not known yet (a file still being checked) none is given.
 */

type Counts = Parameters<typeof readyNote>[0];

/** A file was uploaded. It counts toward a checklist only after its safety scan, so no count is promised. */
export function documentAddedLine(typeLabel: string | null, duplicateNote = ''): string {
  const first = typeLabel
    ? `${typeLabel} added. It counts toward a checklist once its safety scan finishes.`
    : 'Document added. Set its type so it can count toward a checklist once its safety scan finishes.';
  return `${first}${duplicateNote}`;
}

/** A typed detail was saved to the profile. */
export function detailSavedLine(fieldLabel: string): string {
  return `${fieldLabel} saved to your profile.`;
}

/** A suggested detail was approved and written to the profile. */
export const SUGGESTION_SAVED_LINE =
  'Saved to your profile. It can now fill checklist items that need it.';

/** A suggested document type was approved. */
export function documentTypeSavedLine(typeLabel: string): string {
  return `Saved as ${typeLabel}. It can now fill checklist items that ask for it.`;
}

/** A checklist was attached to a case. */
export function checklistAttachedLine(readiness: Counts): string {
  return `Checklist attached.${readyNote(readiness)}`;
}

/** Evidence was chosen for one checklist item. */
export function evidenceChosenLine(readiness: Counts): string {
  return `Evidence chosen for this item.${readyNote(readiness)}`;
}

/** The traveller sent something in reply to an agency request. Received is not reviewed. */
export const EVIDENCE_SENT_LINE = 'Sent to the agency. It shows as received until they review it.';

/** An agency asked a traveller for something. */
export const REQUEST_SENT_LINE = 'Request sent. It stays open until the traveller replies.';

/** An invitation was created, with or without an email being queued. */
export function invitationReadyLine(emailQueued: boolean, expiry: string | null): string {
  const tail = expiry ? ` It stays open for ${expiry}.` : '';
  return emailQueued
    ? `Invitation ready. An email is on its way, and the link below works too.${tail}`
    : `Invitation ready. Email is not set up here, so copy the link below and send it yourself.${tail}`;
}

/** An existing account joined an agency team. */
export function memberAddedLine(roleLabel: string): string {
  return `Team member added as ${roleLabel}. They can open the cases you assign to them.`;
}

/** A person's own record was shared with someone who already has an account. */
export const SHARE_CREATED_LINE =
  'Shared. They see only what you chose, and only after they accept. You can stop it at any time below.';

/** A share was offered to someone without an account yet. */
export const SHARE_INVITED_LINE =
  'Invitation ready. An email is on its way. They create an account or sign in, then review what you chose and accept. The link below works too.';

/** A section's "something else" item was saved. */
export function otherItemSavedLine(sectionLabel: string): string {
  return `Saved under ${sectionLabel}.`;
}
