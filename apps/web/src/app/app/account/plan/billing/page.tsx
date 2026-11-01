import {
  TEST_PAYMENT_LABEL,
  formatBillingDate,
  formatBillingDateTime,
  formatCoveredPeriod,
  formatMoney,
} from '@visastack/core';
import {
  type OwnPurchaseStatus,
  type OwnPurchaseView,
  hasOwnBilling,
  listOwnBilling,
  travellerPlansEnabled,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, StatusBadge } from '../../../../../components/ui';
import type { SearchParamsRecord } from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { supportEmail } from '../../../../../lib/support-email';
import { BillingListEnd, billingRowId, billingRowsShown, capRows } from './billing-list';
import { BillingRow } from './billing-row';

export const metadata: Metadata = { title: 'Billing History' };

export const dynamic = 'force-dynamic';

/**
 * Billing History for a traveller (ADR 0025, T5): what they bought, with the invoice and receipts
 * of each purchase as PDFs, and the way to ask for a refund within 7 days of paying (D8, 12.2).
 *
 * While paid plans are switched off (`TRAVELLER_PLANS_ENABLED`), the page exists only for someone
 * who bought while they were on: the one read is whether this person has any purchase at all, and
 * without one the page is "not found" and nothing billing-related is read or shown. With the
 * switch on, or with a purchase, it lists everything the person bought. Only the signed-in
 * person's own rows are ever read (their `SelfScope`).
 *
 * Refunds: there is no refund request inside VisaStack yet (T6), so "Request a Refund" opens an
 * email to the watched support inbox with the purchase reference filled in. Without a support
 * inbox set up, a sentence says how to ask through Help and Support instead.
 */
export default async function BillingHistoryPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const query = (await searchParams) ?? {};
  // Scroll Budget (WP-SB9): the newest 10 purchases, then Show More; one extra row is read only to
  // know whether more exist. Still only this person's own rows (their SelfScope).
  const shown = billingRowsShown(query);
  const listed = await withSession(async ({ db, self }) => {
    if (!travellerPlansEnabled() && !(await hasOwnBilling(db, self))) return null;
    const read = await listOwnBilling(db, self, { limit: shown + 1 });
    return read.ok ? read.value : null;
  });
  if (listed === null) notFound();
  const capped = capRows(listed, shown);
  const purchases = capped.rows;
  const email = supportEmail();

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Account"
        title="Billing History"
        description="What you bought, with an invoice and receipts you can download."
        actions={
          <Link className="btn btn-secondary" href="/app/account/plan">
            Plan &amp; Usage
          </Link>
        }
      />

      {purchases.length === 0 ? (
        <article className="card" aria-labelledby="billing-empty-title">
          <h2 className="card-title" id="billing-empty-title">
            No Purchases Yet
          </h2>
          <p className="card-body">
            When you buy a plan, its invoice and receipt appear here. Nothing is charged without you
            paying for it.
          </p>
        </article>
      ) : (
        <div className="billing-rows">
          {purchases.map((purchase, index) => (
            <PurchaseCard
              key={purchase.id}
              rowId={billingRowId('purchase', index)}
              open={index === 0}
              purchase={purchase}
              supportEmail={email}
            />
          ))}
          <BillingListEnd
            prefix="purchase"
            pathname="/app/account/plan/billing"
            searchParams={query}
            capped={capped}
            shown={shown}
            noun={{ one: 'purchase', other: 'purchases' }}
          />
        </div>
      )}
    </section>
  );
}

const STATUS_TONES: Readonly<Record<OwnPurchaseStatus, 'success' | 'neutral' | 'warning'>> = {
  paid: 'success',
  waiting: 'neutral',
  not_paid: 'neutral',
  cancelled: 'neutral',
  refunded: 'warning',
};

/** One plain sentence under the status, so the badge is never the only explanation. */
const STATUS_NOTES: Readonly<Record<OwnPurchaseStatus, string>> = {
  paid: 'Paid. Your plan covers the period shown.',
  waiting: 'Not paid. You owe nothing: the plan covers you only once it is paid.',
  not_paid: 'Not paid in time, so nothing was charged and you owe nothing.',
  cancelled: 'Cancelled. There is nothing to pay.',
  refunded: 'The money paid for this was refunded.',
};

/** The note under the status; a partial refund says only part was refunded. */
function statusNote(purchase: OwnPurchaseView): string {
  if (purchase.status === 'refunded' && purchase.statusLabel === 'Partly Refunded') {
    return 'Part of the money paid for this was refunded.';
  }
  return STATUS_NOTES[purchase.status];
}

/**
 * One purchase as a compact row (WP-SB9): its reference, status and amount stay visible; the
 * period, receipts, refund and PDFs open beneath it. The newest purchase starts open.
 */
function PurchaseCard({
  rowId,
  open,
  purchase,
  supportEmail: email,
}: {
  readonly rowId: string;
  readonly open: boolean;
  readonly purchase: OwnPurchaseView;
  readonly supportEmail: string | null;
}) {
  const headingId = `purchase-${purchase.id}`;
  const money = (minor: number) => formatMoney(minor, purchase.currency);
  return (
    <BillingRow
      id={rowId}
      open={open}
      title={purchase.invoiceRef}
      line={`${money(purchase.amountMinorUnits)}, ${purchase.planName}`}
      badges={
        <>
          <StatusBadge tone={STATUS_TONES[purchase.status]}>{purchase.statusLabel}</StatusBadge>
          {purchase.testPayment ? (
            <StatusBadge tone="warning">{TEST_PAYMENT_LABEL}</StatusBadge>
          ) : null}
        </>
      }
    >
      {/* The row's reference again as a heading, so the receipt and refund headings sit under it. */}
      <h2 className="sr-only" id={headingId}>
        {purchase.invoiceRef}
      </h2>
      <p className="invoice-note">{statusNote(purchase)}</p>
      <dl className="invoice-facts">
        <div>
          <dt>Plan</dt>
          <dd>{purchase.planName}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{money(purchase.amountMinorUnits)}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>{formatCoveredPeriod(purchase.periodStart, purchase.periodEnd)}</dd>
        </div>
        {purchase.paidAt ? (
          <div>
            <dt>Paid On</dt>
            <dd>{formatBillingDate(purchase.paidAt)}</dd>
          </div>
        ) : null}
      </dl>

      {purchase.receipts.length > 0 ? (
        <section className="invoice-section" aria-label={`Receipts for ${purchase.invoiceRef}`}>
          <h3 className="invoice-subhead">Receipts</h3>
          <ul className="invoice-list">
            {purchase.receipts.map((receipt) => (
              <li key={receipt.id} className="invoice-list-item">
                <span>{`Receipt ${receipt.number}`}</span>
                <span>
                  {formatMoney(receipt.amountMinorUnits, receipt.currency)} on{' '}
                  {formatBillingDate(receipt.issuedAt)}
                </span>
                {receipt.mode === 'TEST' ? (
                  <StatusBadge tone="warning">{TEST_PAYMENT_LABEL}</StatusBadge>
                ) : null}
                <a
                  className="invoice-link"
                  href={`/app/account/plan/billing/receipts/${receipt.id}/pdf`}
                >
                  Download Receipt (PDF)
                  <span className="sr-only"> {receipt.number}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {purchase.refundableUntil ? (
        <RefundRequest
          headingId={`${headingId}-refund`}
          invoiceRef={purchase.invoiceRef}
          until={purchase.refundableUntil}
          paidAt={purchase.paidAt}
          supportEmail={email}
        />
      ) : null}

      <div className="billing-documents">
        <a
          className="btn btn-secondary"
          href={`/app/account/plan/billing/invoices/${purchase.id}/pdf`}
        >
          Download Invoice (PDF)
          <span className="sr-only"> {purchase.invoiceRef}</span>
        </a>
      </div>
    </BillingRow>
  );
}

/**
 * The way to ask for the 7-day full refund (ADR 0025 D8, 12.2): no reason asked, the purchase
 * reference filled in, and what happens to the plan said up front.
 */
function RefundRequest({
  headingId,
  invoiceRef,
  until,
  paidAt,
  supportEmail: email,
}: {
  readonly headingId: string;
  readonly invoiceRef: string;
  readonly until: Date;
  readonly paidAt: Date | null;
  readonly supportEmail: string | null;
}) {
  const paidOn = paidAt ? `, paid on ${formatBillingDate(paidAt)}` : '';
  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(`Refund Request ${invoiceRef}`)}&body=${encodeURIComponent(`Please refund my purchase ${invoiceRef}${paidOn}.`)}`
    : null;
  return (
    <section className="invoice-section" aria-labelledby={headingId}>
      <h3 className="invoice-subhead" id={headingId}>
        Refund
      </h3>
      <p className="invoice-note">
        You can ask for a full refund until {formatBillingDateTime(until)} (Bangladesh time), and
        you do not need to give a reason. The period it paid for ends once the refund is made.
      </p>
      {mailto ? (
        <a className="invoice-link" href={mailto}>
          Request a Refund
          <span className="sr-only"> for {invoiceRef}</span>
        </a>
      ) : (
        <p className="invoice-note">
          To ask, contact VisaStack from <Link href="/app/help#contact">Help and Support</Link> and
          quote {invoiceRef}.
        </p>
      )}
    </section>
  );
}
