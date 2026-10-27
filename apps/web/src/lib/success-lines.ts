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

/**
 * What happened to an invitation email by the time the screen answers: handed to the mail
 * service while the person waited (`sent`), not out yet and still being retried (`pending`),
 * refused for good with nothing retrying it (`failed`), or email not set up here at all (`none`). "Sent" is never claimed before the mail service took it.
 */
export type InvitationEmailOutcome = 'sent' | 'pending' | 'failed' | 'none';

const SPAM_HINT = 'If it does not arrive in a few minutes, ask them to check Spam or Promotions.';

/** An invitation was created; says plainly whether its email already went out. */
export function invitationReadyLine(email: InvitationEmailOutcome, expiry: string | null): string {
  const tail = expiry ? ` It stays open for ${expiry}.` : '';
  if (email === 'sent') {
    return `Invitation emailed. ${SPAM_HINT} The link below works too.${tail}`;
  }
  if (email === 'pending') {
    return `Invitation ready. The email has not gone out yet and VisaStack keeps trying, so share the link below to avoid a wait.${tail}`;
  }
  if (email === 'failed') {
    return `Invitation ready, but the email could not be sent. Copy the link below and send it yourself.${tail}`;
  }
  return `Invitation ready. Email is not set up here, so copy the link below and send it yourself.${tail}`;
}

/** An existing account joined an agency team. */
export function memberAddedLine(roleLabel: string): string {
  return `Team member added as ${roleLabel}. Their role decides which cases they can open.`;
}

/** A person's own record was shared with someone who already has an account. */
export const SHARE_CREATED_LINE =
  'Shared. They see only what you chose, and only after they accept. You can stop it at any time below.';

/** A share was offered to someone without an account yet. */
export const SHARE_INVITED_LINE =
  'They create an account or sign in, then review what you chose and accept.';

/** The share invitation line, saying plainly whether its email already went out. */
export function shareInvitedLine(email: Exclude<InvitationEmailOutcome, 'none'>): string {
  if (email === 'sent') {
    return `Invitation emailed. ${SHARE_INVITED_LINE} ${SPAM_HINT} The link below works too.`;
  }
  if (email === 'failed') {
    return `Invitation ready, but the email could not be sent, so copy the link below and send it yourself. ${SHARE_INVITED_LINE}`;
  }
  return `Invitation ready. The email has not gone out yet and VisaStack keeps trying, so share the link below to avoid a wait. ${SHARE_INVITED_LINE}`;
}

/** A section's "something else" item was saved. */
export function otherItemSavedLine(sectionLabel: string): string {
  return `Saved under ${sectionLabel}.`;
}
