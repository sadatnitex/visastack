/**
 * Billing words shared by the screens and the downloadable documents (S30), so an invoice page, a
 * receipt page and their PDFs always name a thing the same way (docs/uiux/ccd/VOCABULARY.md).
 *
 * Pure and framework-free: safe to import in the browser.
 */

/** How the money arrived, as a receipt names it. Keyed by the ledger's payment kind. */
export const BILLING_PAYMENT_KIND_LABELS = {
  ONLINE: 'Paid Online',
  MANUAL_CLAIM: 'Reported Payment, Confirmed',
  ADMIN_RECORDED: 'Recorded by VisaStack',
  CREDIT: 'Credit',
  REFUND: 'Refund',
} as const satisfies Readonly<Record<string, string>>;

/**
 * S29: the label on a payment made in the gateway's test mode, wherever a payment is shown
 * (invoice cards, receipts, platform pages, invoice and receipt PDFs). A test payment marks an
 * invoice paid but is not money, and is left out of the Monthly Accounting File.
 */
export const TEST_PAYMENT_LABEL = 'Test Payment';

/** How the money arrived, with "(Test Payment)" after it for a test payment. */
export function paymentKindWords(kind: string, mode: 'TEST' | 'LIVE' | null | undefined): string {
  const label =
    (BILLING_PAYMENT_KIND_LABELS as Readonly<Record<string, string>>)[kind] ?? 'Payment';
  return mode === 'TEST' ? `${label} (${TEST_PAYMENT_LABEL})` : label;
}
