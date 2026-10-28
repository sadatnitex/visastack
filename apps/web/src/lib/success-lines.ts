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

/** Added after the upload line when an iPhone photo (HEIC) was stored as a JPG copy. */
export const HEIC_CONVERTED_NOTE =
  ' The iPhone photo was saved as a JPG copy so it opens anywhere.';

/** A typed detail was saved to the profile. */
export function detailSavedLine(fieldLabel: string): string {
  return `${fieldLabel} saved to your profile.`;
}

/** A suggested detail was approved and written to the profile. */
/** What a saved detail is now used for, after one or after several (they share the words). */
export const DETAIL_IN_USE_LINE = 'It can now fill checklist items that need it.';
export const DETAILS_IN_USE_LINE = 'They can now fill checklist items that need them.';

/** A suggested detail was approved and written to the profile. */
export const SUGGESTION_SAVED_LINE = `Saved to your profile. ${DETAIL_IN_USE_LINE}`;

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
    // Two sentences (CCD section 6): what happened, then what they do and the way round a lost email.
    return 'Invitation emailed: they sign in or create an account, then accept what you chose. If it does not arrive in a few minutes, ask them to check Spam or Promotions, or send them the link below.';
  }
  if (email === 'failed') {
    return `Invitation ready, but the email could not be sent, so copy the link below and send it yourself. ${SHARE_INVITED_LINE}`;
  }
  return `Invitation ready. The email has not gone out yet and VisaStack keeps trying, so share the link below to avoid a wait. ${SHARE_INVITED_LINE}`;
}

/** A change to someone's access finished (Sharing). Each says what changed and what it means now. */
export const ACCESS_REVOKED_LINE = 'Access revoked. They lose it on their next request.';
export const ACCESS_PAUSED_LINE = 'Access paused. They cannot see anything until you resume it.';
export const ACCESS_RESUMED_LINE = 'Access resumed. They can see what you shared again.';
export const INVITATION_WITHDRAWN_LINE = 'Invitation withdrawn. Its link no longer works.';
export const INVITATION_NOT_WITHDRAWN_LINE =
  'The invitation could not be withdrawn. It may have been accepted already, so check who has access below.';

/**
 * The finished change named by the Sharing page address (`?done=`), which survives the reload
 * that shows the new access list. Only these fixed words are ever shown, never the address text.
 */
const ACCESS_DONE_LINES: Readonly<Record<string, string>> = {
  revoked: ACCESS_REVOKED_LINE,
  paused: ACCESS_PAUSED_LINE,
  resumed: ACCESS_RESUMED_LINE,
  'invitation-withdrawn': INVITATION_WITHDRAWN_LINE,
  'invitation-not-withdrawn': INVITATION_NOT_WITHDRAWN_LINE,
};

export function accessDoneLine(done: string | undefined): string | null {
  return done !== undefined && Object.hasOwn(ACCESS_DONE_LINES, done)
    ? (ACCESS_DONE_LINES[done] ?? null)
    : null;
}

/** A section's "something else" item was saved. */
export function otherItemSavedLine(sectionLabel: string): string {
  return `Saved under ${sectionLabel}.`;
}
