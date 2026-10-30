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
