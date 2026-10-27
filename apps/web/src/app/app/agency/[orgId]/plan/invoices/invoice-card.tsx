import { type AgencyInvoiceView, formatAmountForCurrency } from '@visastack/services';
import Link from 'next/link';
import { StatusBadge } from '../../../../../../components/ui';
import {
  formatDateOnly,
  formatTimestamp,
  formatTimestampDate,
} from '../../../../../../lib/format-date';
import {
  ATTEMPT_STATUS_LABELS,
  CLAIM_METHOD_LABELS,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_TONES,
  INVOICE_STATE_HINTS,
  INVOICE_STATE_LABELS,
  INVOICE_STATE_TONES,
} from '../../../../../../lib/invoice-labels';
import { formatPrice } from '../../../../../../lib/usage-format';
import {
  CheckStatusButton,
  ClaimForm,
  PayOnlineButton,
  RecentPaymentChoices,
} from './invoice-forms';

/** Online payment covers invoices in this currency only (ADR 0020). Other currencies use the report form. */
const ONLINE_CURRENCY = 'BDT';

function plainAmount(minorUnits: number, currency: string): string {
  return formatPrice(minorUnits, currency);
}

export function InvoiceCard({
  invoice,
  organizationId,
  onlineAvailable,
  latestDate,
}: {
  readonly invoice: AgencyInvoiceView;
  readonly organizationId: string;
  readonly onlineAvailable: boolean;
  /** The latest day a payment can have been made (YYYY-MM-DD, anywhere on earth). */
  readonly latestDate: string;
}) {
  const open = invoice.status !== 'PAID' && invoice.status !== 'VOID';
  const reported = invoice.state === 'PAYMENT_REPORTED';
  const canPayOnline =
    open &&
    onlineAvailable &&
    invoice.state !== 'NEEDS_CHECK' &&
    invoice.currency === ONLINE_CURRENCY &&
    invoice.outstandingMinorUnits > 0;
  const balance = formatAmountForCurrency(invoice.outstandingMinorUnits, invoice.currency)
    .slice(invoice.currency.length)
    .trim();
  const headingId = `invoice-${invoice.id}`;
  const hasOldPayment = invoice.attempts.some((a) => a.status === 'REDIRECTED');

  return (
    <article className="card invoice-card" aria-labelledby={headingId}>
      <div className="invoice-head">
        <h3 id={headingId} className="invoice-ref">
          {invoice.invoiceRef}
        </h3>
        <StatusBadge tone={INVOICE_STATE_TONES[invoice.state]}>
          {INVOICE_STATE_LABELS[invoice.state]}
        </StatusBadge>
      </div>
      <p className="invoice-note">
        {INVOICE_STATE_HINTS[invoice.state]}
        {invoice.partlyPaid && invoice.state === 'OPEN' ? ' Part of it has been paid.' : ''}
      </p>
      <dl className="invoice-facts">
        <div>
          <dt>Invoiced</dt>
          <dd>{plainAmount(invoice.invoicedAmountMinorUnits, invoice.currency)}</dd>
        </div>
        <div>
          <dt>Paid So Far</dt>
          <dd>{plainAmount(invoice.collectedAmountMinorUnits, invoice.currency)}</dd>
        </div>
        <div>
          <dt>Still Owed</dt>
          <dd>{plainAmount(invoice.outstandingMinorUnits, invoice.currency)}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>{formatDateOnly(invoice.dueDate)}</dd>
        </div>
      </dl>

      {open ? (
        <div className="invoice-actions">
          {invoice.recentAttemptStartedAt ? (
            <RecentPaymentChoices
              organizationId={organizationId}
              invoiceId={invoice.id}
              startedAt={formatTimestamp(invoice.recentAttemptStartedAt)}
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
              You have a payment report waiting for confirmation. Once it is decided you can report
              another.
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
                  {formatDateOnly(claim.paidOn)}
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
                  {formatTimestamp(attempt.redirectedAt ?? attempt.createdAt)}
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
                  {formatTimestampDate(receipt.issuedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
