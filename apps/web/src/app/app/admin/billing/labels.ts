import { type OverduePolicy, type OverduePreview, dayCount } from '@visastack/services';
import type { FormResult } from '../../../../components/form-feedback';

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

/** The day counts a preview was worked out for, with their units. */
export function previewDays(preview: OverduePolicy): string {
  return `Grace from ${dayCount(preview.graceAfterDays)} after the due date, Suspended from ${dayCount(
    preview.suspendAfterDays,
  )}.`;
}

/** The confirmation, with the counts in the label itself. */
export function confirmLabel(preview: OverduePreview): string {
  return `I understand this moves ${agencies(preview.toGrace)} to Grace and ${preview.toSuspended} to Suspended today`;
}

/** A rule's day count after the due date, or that it is not set. */
export function daysAfterDue(value: number | null): string {
  return value === null ? 'Not set' : `${dayCount(value)} after the due date`;
}

export const PAID_IN_FULL =
  'Paying in full ends a Grace or Suspended status that VisaStack set. A status a person set is never changed automatically.';

export const WHAT_SUSPENDED_DOES =
  'Grace changes nothing for the agency; it is a warning. Suspended pauses adding cases, team members and files for that agency. Nothing is deleted or hidden, and travellers keep every record.';

export const TRAVELLER_UPLOADS_NOTE =
  'While an agency is Suspended, a traveller who shares records with it also cannot add new files. Decide whether that is right before turning this on.';

/** The values as typed, sent back with every reply so the form never loses them. */
export interface BillingRulesValues {
  readonly dueDays: string;
  readonly overdueHandling: 'on' | 'off';
  readonly graceAfterDays: string;
  readonly suspendAfterDays: string;
}

/** A preview the server worked out for exactly these day counts. */
export type BillingRulesPreview = OverduePolicy & OverduePreview;

/** What saving the billing rules answers. */
export interface BillingRulesState extends FormResult {
  readonly values?: BillingRulesValues;
  /** Present when the save needs this preview confirmed first. Not a failure in itself. */
  readonly preview?: BillingRulesPreview;
}
