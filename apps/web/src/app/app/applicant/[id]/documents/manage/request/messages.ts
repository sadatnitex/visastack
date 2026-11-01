import type { RemovalRequestReason } from '@visastack/services';

/*
 * The words of Ask Us to Remove This File (docs/uiux/ccd/VOCABULARY.md: Ask Us to Remove This
 * File, Removal Requested). Plain, and exact about what happens. No typed text is asked for: a
 * typed note could hold personal details, so the reason is a choice.
 */

/** The reasons a person can pick, in the order they are shown. */
export const REASON_CHOICES: ReadonlyArray<{
  readonly value: RemovalRequestReason;
  readonly label: string;
}> = [
  { value: 'WRONG_PERSON', label: "It is someone else's document" },
  { value: 'UPLOADED_BY_MISTAKE', label: 'I added it by mistake' },
  { value: 'NO_LONGER_NEEDED', label: 'I no longer need it' },
  { value: 'PRIVACY_CONCERN', label: 'I am worried about my privacy' },
  { value: 'OTHER', label: 'Something else' },
];

/** What approval does, said before the person sends the request. */
export const WHAT_HAPPENS =
  'Our support team checks the request, usually within 3 working days. If they approve it, the file is removed from VisaStack for good and any open case that uses it will ask you to choose another document. Cases you already finished keep their record.';

/** Backup wording the owner approved (owner decision D10). */
export const BACKUP_NOTE =
  'Removed from VisaStack. Backup copies expire within 90 days and are never brought back.';

export const REQUESTED_MESSAGE =
  'Removal requested. We will tell you when support decides. You can cancel the request until then.';

export const CANCELLED_MESSAGE = 'Request cancelled. The document stays in your records.';

export const NOT_ALLOWED = 'Only the owner of these records can ask for a document to be removed.';
