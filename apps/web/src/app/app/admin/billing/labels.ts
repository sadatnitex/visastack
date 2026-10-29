import type { OverduePreview } from '@visastack/services';

/** "1 agency", "2 agencies". */
export function agencies(count: number): string {
  return count === 1 ? '1 agency' : `${count} agencies`;
}

/** What switching automatic Grace and Suspended on would do today, in one sentence. */
export function previewSentence(preview: OverduePreview): string {
  if (preview.toGrace === 0 && preview.toSuspended === 0) {
    return 'Turning this on today moves no agencies.';
  }
  return `Turning this on today moves ${agencies(preview.toGrace)} to Grace and ${agencies(
    preview.toSuspended,
  )} to Suspended.`;
}

export const PAID_IN_FULL =
  'Paying in full ends a Grace or Suspended status that VisaStack set. A status a person set is never changed automatically.';

export const WHAT_SUSPENDED_DOES =
  'Grace changes nothing for the agency; it is a warning. Suspended pauses adding cases, team members and files for that agency. Nothing is deleted or hidden, and travellers keep every record.';

export const TRAVELLER_UPLOADS_NOTE =
  'While an agency is Suspended, a traveller who shares records with it also cannot add new files. Decide whether that is right before turning this on.';
