import type {
  InvoicePaymentState,
  ManualClaimMethod,
  ManualClaimStatus,
  PaymentAttemptStatus,
} from '@visastack/services';
import type { Tone } from '../components/ui';

/**
 * The plain words of the agency Invoices page (Small Commercial V1 S12). Pure tables with no
 * server code, so a screen can use them anywhere. An invoice shows one of these states, worked
 * out from facts by the service (`deriveInvoicePaymentState`), never from a stored label.
 */

export const INVOICE_STATE_LABELS: Readonly<Record<InvoicePaymentState, string>> = {
  OPEN: 'Open',
  PAYMENT_STARTED: 'Payment Started',
  PAYMENT_REPORTED: 'Payment Reported',
  PAID: 'Paid',
  NEEDS_CHECK: 'Payment Needs a Check',
  VOID: 'Cancelled',
};

/** One short sentence under the state, saying what it means and what happens next. */
export const INVOICE_STATE_HINTS: Readonly<Record<InvoicePaymentState, string>> = {
  OPEN: 'Nothing is under way. Pay online or report a payment you made another way.',
  PAYMENT_STARTED:
    'A payment page was opened a few minutes ago. Check it before you start another payment.',
  PAYMENT_REPORTED: 'Waiting for confirmation. Nothing is counted until VisaStack confirms it.',
  PAID: 'This invoice is paid in full.',
  NEEDS_CHECK:
    'A payment came in that could not be counted automatically. VisaStack will contact you.',
  VOID: 'This invoice was cancelled. There is nothing to pay.',
};

export const INVOICE_STATE_TONES: Readonly<Record<InvoicePaymentState, Tone>> = {
  OPEN: 'neutral',
  PAYMENT_STARTED: 'warning',
  PAYMENT_REPORTED: 'warning',
  PAID: 'success',
  NEEDS_CHECK: 'danger',
  VOID: 'neutral',
};

export const CLAIM_METHOD_LABELS: Readonly<Record<ManualClaimMethod, string>> = {
  BANK_TRANSFER: 'Bank Transfer',
  BKASH: 'bKash',
  CHEQUE: 'Cheque',
  OTHER: 'Another Way',
};

export const CLAIM_STATUS_LABELS: Readonly<Record<ManualClaimStatus, string>> = {
  SUBMITTED: 'Waiting for Confirmation',
  APPROVED: 'Confirmed',
  REJECTED: 'Not Accepted',
};

export const CLAIM_STATUS_TONES: Readonly<Record<ManualClaimStatus, Tone>> = {
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

/** What an online payment attempt is called to the agency. Gateway wording and codes never show. */
export const ATTEMPT_STATUS_LABELS: Readonly<Record<PaymentAttemptStatus, string>> = {
  CREATED: 'Starting',
  REDIRECTED: 'Waiting for the Payment Page',
  VALIDATED: 'Confirming',
  RECORDED: 'Received',
  FAILED: 'Not Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Timed Out',
  HELD_FOR_REVIEW: 'Needs a Check',
};

/** How the money arrived, as the receipt names it. */
export const RECEIPT_KIND_LABELS: Readonly<Record<string, string>> = {
  ONLINE: 'Paid Online',
  MANUAL_CLAIM: 'Reported Payment, Confirmed',
  ADMIN_RECORDED: 'Recorded by VisaStack',
  CREDIT: 'Credit',
};

export function receiptKindLabel(kind: string): string {
  return RECEIPT_KIND_LABELS[kind] ?? 'Payment';
}
