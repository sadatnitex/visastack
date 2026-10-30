import {
  billingDaysUntil,
  formatBillingDate,
  formatBillingDateTime,
  formatMoney,
  formatMoneyNumber,
} from '@visastack/core';
import type { AgencyInvoiceView } from '@visastack/services';
import Link from 'next/link';
import { StatusBadge } from '../../../../../../components/ui';
import {
  ATTEMPT_STATUS_LABELS,
  CLAIM_METHOD_LABELS,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_TONES,
  INVOICE_STATE_HINTS,
  INVOICE_STATE_LABELS,
  INVOICE_STATE_TONES,
} from '../../../../../../lib/invoice-labels';
import {
  CheckStatusButton,
  ClaimForm,
  PayOnlineButton,
  RecentPaymentChoices,
} from './invoice-forms';

/** Online payment covers invoices in this currency only (ADR 0020). Other currencies use the report form. */
const ONLINE_CURRENCY = 'BDT';

function plainAmount(minorUnits: number, currency: string): string {
  return formatMoney(minorUnits, currency);
}

/**
 * When an unpaid invoice is due, as its own marker beside the state (S30): "Overdue" from the
 * Bangladesh day after the due date, "Due Today" on the day itself. A word and a mark, never
 * colour alone. Nothing for an invoice that owes nothing.
 */
export function dueMarker(
  invoice: Pick<AgencyInvoiceView, 'dueDate' | 'outstandingMinorUnits'>,
  now: Date,
): { readonly label: 'Overdue' | 'Due Today'; readonly tone: 'danger' | 'warning' } | null {
  if (invoice.outstandingMinorUnits <= 0) return null;
  const days = billingDaysUntil(invoice.dueDate, now);
  if (days < 0) return { label: 'Overdue', tone: 'danger' };
  if (days === 0) return { label: 'Due Today', tone: 'warning' };
  return null;
}

export function InvoiceCard({
  invoice,
  organizationId,
  onlineAvailable,
  latestDate,
  now = new Date(),
}: {
  readonly invoice: AgencyInvoiceView;
  readonly organizationId: string;
  readonly onlineAvailable: boolean;
  /** The latest day a payment can have been made (YYYY-MM-DD, anywhere on earth). */
  readonly latestDate: string;
  /** The moment the page is drawn, for Overdue and Due Today. */
  readonly now?: Date;
}) {
  // A refunded invoice is never owed again (S18, D2): it has no Pay button and no report form.
  // Decided from the money itself, not from the state, so a payment held for a check (which
  // outranks the refunded states) can never bring back a way to pay a refunded invoice.
  const refunded = invoice.refundedMinorUnits > 0;
  const open = invoice.status !== 'PAID' && invoice.status !== 'VOID' && !refunded;
  const reported = invoice.state === 'PAYMENT_REPORTED';
  // While a payment report waits, paying online could pay twice: the report is checked first.
  const canPayOnline =
    open &&
    !reported &&
    onlineAvailable &&
    invoice.state !== 'NEEDS_CHECK' &&
    invoice.currency === ONLINE_CURRENCY &&
    invoice.outstandingMinorUnits > 0;
  const balance = formatMoneyNumber(invoice.outstandingMinorUnits, invoice.currency, {
    grouping: false,
  });
  const due = open ? dueMarker(invoice, now) : null;
  const headingId = `invoice-${invoice.id}`;
  const hasOldPayment = invoice.attempts.some((a) => a.status === 'REDIRECTED');

  return (
    <article className="card invoice-card" aria-labelledby={headingId}>
      <div className="invoice-head">
        <h3 id={headingId} className="invoice-ref">
          {invoice.invoiceRef}
        </h3>
        <span className="invoice-badges">
          <StatusBadge tone={INVOICE_STATE_TONES[invoice.state]}>
            {INVOICE_STATE_LABELS[invoice.state]}
          </StatusBadge>
          {due ? <StatusBadge tone={due.tone}>{due.label}</StatusBadge> : null}
        </span>
      </div>
      <p className="invoice-note">
        {INVOICE_STATE_HINTS[invoice.state]}
        {invoice.partlyPaid && invoice.state === 'OPEN' ? ' Part of it has been paid.' : ''}
        {due?.label === 'Overdue' ? ` It was due on ${formatBillingDate(invoice.dueDate)}.` : ''}
        {due?.label === 'Due Today' ? ' It is due today.' : ''}
      </p>
      {invoice.creditMinorUnits > 0 ? (
        <p className="invoice-note">
          Credit from an earlier payment: {plainAmount(invoice.creditMinorUnits, invoice.currency)}{' '}
          of an online payment VisaStack held for a check was counted towards this invoice.
        </p>
      ) : null}
      <dl className="invoice-facts">
        <div>
          <dt>Invoiced</dt>
          <dd>{plainAmount(invoice.invoicedAmountMinorUnits, invoice.currency)}</dd>
        </div>
        <div>
          <dt>{refunded ? 'Kept After Refunds' : 'Paid So Far'}</dt>
          <dd>{plainAmount(invoice.collectedAmountMinorUnits, invoice.currency)}</dd>
        </div>
        {invoice.refundedMinorUnits > 0 ? (
          <div>
            <dt>Refunded</dt>
            <dd>{plainAmount(invoice.refundedMinorUnits, invoice.currency)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Still Owed</dt>
          <dd>{plainAmount(invoice.outstandingMinorUnits, invoice.currency)}</dd>
        </div>
        {refunded ? null : (
          <div>
            <dt>Due</dt>
            <dd className={due ? `invoice-due invoice-due-${due.tone}` : undefined}>
              {formatBillingDate(invoice.dueDate)}
            </dd>
          </div>
        )}
      </dl>

      {open ? (
        <div className="invoice-actions">
          {invoice.recentAttemptStartedAt ? (
            <RecentPaymentChoices
              organizationId={organizationId}
              invoiceId={invoice.id}
              startedAt={formatBillingDateTime(invoice.recentAttemptStartedAt)}
            />
          ) : (
            <>
              {canPayOnline ? (
                <PayOnlineButton organizationId={organizationId} invoiceId={invoice.id} />
              ) : null}
              {onlineAvailable && hasOldPayment ? (
                <CheckStatusButton organizationId={organizationId} invoiceId={invoice.id} />
              ) : null}
            </>
          )}
          {reported ? (
            <p className="invoice-note">
              Payment Reported: we are checking it. Once it is decided you can pay online or report
              another payment.
            </p>
          ) : (
            <ClaimForm
              organizationId={organizationId}
              invoiceId={invoice.id}
              currency={invoice.currency}
              balance={balance}
              latestDate={latestDate}
            />
          )}
        </div>
      ) : null}

      {invoice.claims.length > 0 ? (
        <section
          className="invoice-section"
          aria-label={`Payment reports for ${invoice.invoiceRef}`}
        >
          <h4 className="invoice-subhead">Payment Reports</h4>
          <ul className="invoice-list">
            {invoice.claims.map((claim) => (
              <li key={claim.id} className="invoice-list-item">
                <span>
                  {CLAIM_METHOD_LABELS[claim.method]},{' '}
                  {plainAmount(claim.amountMinorUnits, claim.currency)}, paid{' '}
                  {formatBillingDate(claim.paidOn)}
                </span>
                <StatusBadge tone={CLAIM_STATUS_TONES[claim.status]}>
                  {CLAIM_STATUS_LABELS[claim.status]}
                </StatusBadge>
                {claim.status === 'REJECTED' && claim.decisionReason ? (
                  <span className="invoice-note">Reason: {claim.decisionReason}</span>
                ) : null}
                {claim.hasProofFile ? (
                  <a
                    className="invoice-link"
                    href={`/api/billing/proof/${organizationId}/${claim.id}`}
                    download
                  >
                    Download Proof
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invoice.attempts.length > 0 ? (
        <section
          className="invoice-section"
          aria-label={`Online payments for ${invoice.invoiceRef}`}
        >
          <h4 className="invoice-subhead">Online Payments</h4>
          <ul className="invoice-list">
            {invoice.attempts.map((attempt) => (
              <li key={attempt.id} className="invoice-list-item">
                <span>
                  {plainAmount(attempt.amountMinorUnits, attempt.currency)}, started{' '}
                  {formatBillingDateTime(attempt.redirectedAt ?? attempt.createdAt)}
                </span>
                <StatusBadge
                  tone={
                    attempt.status === 'RECORDED'
                      ? 'success'
                      : attempt.status === 'HELD_FOR_REVIEW'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {ATTEMPT_STATUS_LABELS[attempt.status]}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invoice.receipts.length > 0 ? (
        <section className="invoice-section" aria-label={`Receipts for ${invoice.invoiceRef}`}>
          <h4 className="invoice-subhead">Receipts</h4>
          <ul className="invoice-list">
            {invoice.receipts.map((receipt) => (
              <li key={receipt.id} className="invoice-list-item">
                <Link
                  className="invoice-link"
                  href={`/app/agency/${organizationId}/plan/invoices/receipts/${receipt.id}`}
                >
                  {`Receipt ${receipt.number}`}
                </Link>
                <span>
                  {plainAmount(receipt.amountMinorUnits, receipt.currency)} on{' '}
                  {formatBillingDate(receipt.issuedAt)}
                </span>
                <a
                  className="invoice-link"
                  href={`/app/agency/${organizationId}/plan/invoices/receipts/${receipt.id}/pdf`}
                  download
                >
                  Download Receipt (PDF)
                  <span className="sr-only"> {receipt.number}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="invoice-documents">
        <a
          className="btn btn-secondary"
          href={`/app/agency/${organizationId}/plan/invoices/${invoice.id}/pdf`}
          download
        >
          Download Invoice (PDF)
          <span className="sr-only"> {invoice.invoiceRef}</span>
        </a>
      </div>
    </article>
  );
}
