import { BILLING_PAYMENT_KIND_LABELS } from '@visastack/core';
import type {
  InvoicePaymentState,
  ManualClaimMethod,
  ManualClaimStatus,
  PaymentAttemptStatus,
  RefundStatus,
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
  REFUNDED: 'Refunded',
  PARTLY_REFUNDED: 'Partly Refunded',
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
  REFUNDED: 'The money paid on this invoice was refunded. There is nothing to pay.',
  PARTLY_REFUNDED:
    'Part of the money paid on this invoice was refunded. There is nothing more to pay on it.',
  VOID: 'This invoice was cancelled. There is nothing to pay.',
};

export const INVOICE_STATE_TONES: Readonly<Record<InvoicePaymentState, Tone>> = {
  OPEN: 'neutral',
  PAYMENT_STARTED: 'warning',
  PAYMENT_REPORTED: 'warning',
  PAID: 'success',
  NEEDS_CHECK: 'danger',
  REFUNDED: 'neutral',
  PARTLY_REFUNDED: 'neutral',
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
  REFUNDED: 'Refunded',
};

/** Where a refund stands (S18), for platform staff. */
export const REFUND_STATUS_LABELS: Readonly<Record<RefundStatus, string>> = {
  REQUESTED: 'Waiting to Send',
  SUBMITTED: 'Sent (Waiting for Confirmation)',
  CONFIRMED: 'Refunded',
  FAILED: 'Not Completed',
  CANCELLED: 'Cancelled',
};

export const REFUND_STATUS_TONES: Readonly<Record<RefundStatus, Tone>> = {
  REQUESTED: 'warning',
  SUBMITTED: 'warning',
  CONFIRMED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

/** Why an online payment was held for a check, in plain words for platform staff. */
export const HOLD_REASON_LABELS: Readonly<Record<string, string>> = {
  already_paid: 'The invoice was already paid another way.',
  invoice_void: 'The invoice was cancelled.',
  invoice_refunded: 'The invoice was refunded, so nothing more is owed on it.',
  already_covered: 'A paid period already covered this time, so the payment was kept for a refund.',
  risky_payment: 'The gateway flagged the payment as risky.',
  risk_unknown: 'The gateway did not say whether the payment was risky.',
  mismatch: 'What the gateway reported did not match this payment.',
  key_conflict: 'The gateway payment id was already used for another payment.',
  not_recordable: 'The payment could not be counted on this invoice.',
};

export function holdReasonLabel(code: string | null): string {
  return code !== null && Object.hasOwn(HOLD_REASON_LABELS, code)
    ? (HOLD_REASON_LABELS[code] ?? 'Held for a check.')
    : 'Held for a check.';
}

/** How the money arrived, as the receipt names it. */
export const RECEIPT_KIND_LABELS: Readonly<Record<string, string>> = BILLING_PAYMENT_KIND_LABELS;

export function receiptKindLabel(kind: string): string {
  return RECEIPT_KIND_LABELS[kind] ?? 'Payment';
}
