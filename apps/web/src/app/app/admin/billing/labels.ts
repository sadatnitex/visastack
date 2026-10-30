import { dayCount } from '@visastack/core';
import type { OverduePolicy, OverduePreview } from '@visastack/services';
import type { FormResult } from '../../../../components/form-feedback';

/** "1 agency", "2 agencies". */
export function agencies(count: number): string {
  return count === 1 ? '1 agency' : `${count} agencies`;
}

function movesToday(preview: OverduePreview): string {
  if (preview.toGrace === 0 && preview.toSuspended === 0) return 'moves no agencies';
  return `moves ${agencies(preview.toGrace)} to Grace and ${agencies(preview.toSuspended)} to Suspended`;
}

/** What switching automatic Grace and Suspended on would do today, in one sentence. */
export function previewSentence(preview: OverduePreview): string {
  return `Turning this on today ${movesToday(preview)}.`;
}

/** The same, for the rules already saved: "With the saved day counts, turning this on today ...". */
export function savedPreviewSentence(preview: OverduePreview): string {
  return `With the saved day counts, turning this on today ${movesToday(preview)}.`;
}

/** The day counts a preview was worked out for, with their units. */
export function previewDays(preview: OverduePolicy): string {
  return `Grace from ${dayCount(preview.graceAfterDays)} after the due date, Suspended from ${dayCount(
    preview.suspendAfterDays,
  )}.`;
}

/** The confirmation, with the counts in the label itself. */
export function confirmLabel(preview: OverduePreview): string {
  return `I understand this ${movesToday(preview)} today`;
}

/** A rule's day count after the due date, or that it is not set. */
export function daysAfterDue(value: number | null): string {
  return value === null ? 'Not set' : `${dayCount(value)} after the due date`;
}

export const PAID_IN_FULL =
  'Paying in full ends a Grace or Suspended status that VisaStack set. A status a person set is never changed automatically.';

export const WHAT_SUSPENDED_DOES =
  'Grace changes nothing for the agency; it is a warning. Suspended pauses adding cases, team members and files for that agency. Nothing is deleted or hidden, and travellers keep every record.';

/** Owner decision O13 (30 Oct 2026, S29): a suspension pauses only the agency's own team. */
export const TRAVELLER_UPLOADS_NOTE =
  "While an agency is Suspended, travellers who share records with it still add their own files as usual. Only the agency's own team cannot add files until it is Active again.";

/** S29: the gateway's mode, in the words Billing Rules shows it. */
export const PAYMENT_MODE_WORDS = {
  TEST: {
    badge: 'Test Payments Only',
    tone: 'warning',
    sentence:
      'Online payment is in test mode. Only you can make a test payment: it marks the invoice paid, is labelled Test Payment, and is left out of the Monthly Accounting File. Agencies cannot pay online until it is live.',
  },
  LIVE: {
    badge: 'Live',
    tone: 'success',
    sentence: 'Online payment takes real money from agencies.',
  },
  NONE: {
    badge: 'Not Set Up',
    tone: 'neutral',
    sentence:
      'Online payment is not set up. Agencies pay another way and report it, and you record it.',
  },
} as const;

/**
 * S19 step 0 round 2: some payment providers live and some in test mode. The badge never says
 * Live, and the sentence names the currencies that can still only take test payments.
 */
export const MIXED_PAYMENT_MODE = { badge: 'Partly Live', tone: 'warning' } as const;

export function mixedPaymentSentence(
  currencies: { readonly live: readonly string[]; readonly test: readonly string[] },
  words: (codes: readonly string[]) => string,
): string {
  const parts = [
    currencies.live.length > 0
      ? `Online payment takes real money for invoices in ${words(currencies.live)}.`
      : null,
    currencies.test.length > 0
      ? `Invoices in ${words(currencies.test)} can still only take test payments: only you can make one, it marks the invoice paid, is labelled Test Payment, and is left out of the Monthly Accounting File. Agencies cannot pay those invoices online until their payment method is live.`
      : null,
    currencies.live.length === 0 || currencies.test.length === 0
      ? 'One payment method is in a different mode, but no invoice currency is paid through it.'
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(' ');
}

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
