import {
  TEST_PAYMENT_LABEL,
  billingDaysUntil,
  formatBillingDate,
  formatBillingDateTime,
  formatMoney,
  formatMoneyNumber,
} from '@visastack/core';
import { type AgencyInvoiceView, PAYMENT_METHOD_OFF } from '@visastack/services';
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

/**
 * What online payment an invoice's currency gets for this viewer (S19 step 0): `pay` (Pay Online
 * is offered), `testing` (only a provider in test mode takes it, so the viewer is told online
 * payment is being tested). A currency with no entry is paid another way (the report form).
 */
export type OnlineOffer = 'pay' | 'testing';

function offerFor(
  online: Readonly<Record<string, OnlineOffer>>,
  currency: string,
): OnlineOffer | null {
  return Object.hasOwn(online, currency) ? (online[currency] ?? null) : null;
}

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

/** The invoice's state and, while money is owed, Overdue or Due Today. */
export function InvoiceBadges({
  invoice,
  due,
}: {
  readonly invoice: Pick<AgencyInvoiceView, 'state'>;
  readonly due: ReturnType<typeof dueMarker>;
}) {
  return (
    <span className="billing-badges">
      <StatusBadge tone={INVOICE_STATE_TONES[invoice.state]}>
        {INVOICE_STATE_LABELS[invoice.state]}
      </StatusBadge>
      {due ? <StatusBadge tone={due.tone}>{due.label}</StatusBadge> : null}
    </span>
  );
}

/**
 * Whether money can still be asked for on this invoice: not paid, not cancelled, never refunded
 * (the same rule the card uses for its Pay and report choices).
 */
export function invoiceStillOwed(
  invoice: Pick<AgencyInvoiceView, 'status' | 'refundedMinorUnits'>,
): boolean {
  return invoice.status !== 'PAID' && invoice.status !== 'VOID' && invoice.refundedMinorUnits <= 0;
}

export function InvoiceCard({
  invoice,
  organizationId,
  online,
  testModeHint = null,
  latestDate,
  now = new Date(),
  inRow = false,
}: {
  readonly invoice: AgencyInvoiceView;
  readonly organizationId: string;
  /** Per invoice currency, what online payment this viewer is offered (from the Invoices page). */
  readonly online: Readonly<Record<string, OnlineOffer>>;
  /**
   * S29 round 2: the sentence saying online payment is being tested, shown in place of Pay Online
   * where the invoice's currency is `testing` for this viewer.
   */
  readonly testModeHint?: string | null;
  /** The latest day a payment can have been made (YYYY-MM-DD, anywhere on earth). */
  readonly latestDate: string;
  /** The moment the page is drawn, for Overdue and Due Today. */
  readonly now?: Date;
  /**
   * WP-SB9: drawn inside a compact row that already shows the reference and badges, so the card
   * keeps its heading for screen readers only and drops its own frame.
   */
  readonly inRow?: boolean;
}) {
  // A refunded invoice is never owed again (S18, D2): it has no Pay button and no report form.
  // Decided from the money itself, not from the state, so a payment held for a check (which
  // outranks the refunded states) can never bring back a way to pay a refunded invoice.
  const refunded = invoice.refundedMinorUnits > 0;
  const open = invoiceStillOwed(invoice);
  const reported = invoice.state === 'PAYMENT_REPORTED';
  // A stranded payment (S19 step 0, decided once in the service): no new online payment.
  const stranded = invoice.strandedPayment;

  // Whether this invoice can be paid online at all: a provider takes its stored currency, for this
  // viewer, now.
  const offer = offerFor(online, invoice.currency);
  const onlineOffered =
    open &&
    offer === 'pay' &&
    !stranded &&
    invoice.state !== 'NEEDS_CHECK' &&
    invoice.outstandingMinorUnits > 0;
  // While a payment report waits, paying online could pay twice: the report is checked first.
  const canPayOnline = onlineOffered && !reported;
  const balance = formatMoneyNumber(invoice.outstandingMinorUnits, invoice.currency, {
    grouping: false,
  });
  const due = open ? dueMarker(invoice, now) : null;
  const headingId = `invoice-${invoice.id}`;
  const showTestHint = testModeHint !== null && offer === 'testing';
  const hasOldPayment = invoice.attempts.some((a) => a.status === 'REDIRECTED');

  return (
    <article
      className={inRow ? 'invoice-card invoice-card-in-row' : 'card invoice-card'}
      aria-labelledby={headingId}
    >
      {inRow ? (
        <h3 id={headingId} className="sr-only">
          {invoice.invoiceRef}
        </h3>
      ) : (
        <div className="invoice-head">
          <h3 id={headingId} className="invoice-ref">
            {invoice.invoiceRef}
          </h3>
          <InvoiceBadges invoice={invoice} due={due} />
        </div>
      )}
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
            <dd className={due ? `billing-due-${due.tone}` : undefined}>
              {formatBillingDate(invoice.dueDate)}
            </dd>
          </div>
        )}
      </dl>

      {open ? (
        <section
          className="invoice-actions"
          aria-label={`Pay ${invoice.invoiceRef}`}
          {...(showTestHint ? { 'aria-describedby': `${headingId}-test-mode` } : {})}
        >
          {showTestHint ? (
            <p className="invoice-note" id={`${headingId}-test-mode`}>
              {testModeHint}
            </p>
          ) : null}
          {stranded ? (
            // Said instead of any way to pay online (S19 step 0 round 2): nobody can check that
            // payment, so paying again could charge twice. The sentence Check Status gives.
            <p className="invoice-note">{PAYMENT_METHOD_OFF}</p>
          ) : invoice.recentAttemptStartedAt ? (
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
              {offer === 'pay' && hasOldPayment ? (
                <CheckStatusButton organizationId={organizationId} invoiceId={invoice.id} />
              ) : null}
            </>
          )}
          {reported ? (
            <p className="invoice-note">
              {onlineOffered
                ? 'Payment Reported: we are checking it. Once it is decided you can pay online or report another payment.'
                : 'Payment Reported: we are checking it. We will update this invoice once it is checked.'}
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
        </section>
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
                {attempt.mode === 'TEST' ? (
                  <StatusBadge tone="warning">{TEST_PAYMENT_LABEL}</StatusBadge>
                ) : null}
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
                {receipt.mode === 'TEST' ? (
                  <StatusBadge tone="warning">{TEST_PAYMENT_LABEL}</StatusBadge>
                ) : null}
                <a
                  className="invoice-link"
                  href={`/app/agency/${organizationId}/plan/invoices/receipts/${receipt.id}/pdf`}
                >
                  Download Receipt (PDF)
                  <span className="sr-only"> {receipt.number}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="billing-documents">
        <a
          className="btn btn-secondary"
          href={`/app/agency/${organizationId}/plan/invoices/${invoice.id}/pdf`}
        >
          Download Invoice (PDF)
          <span className="sr-only"> {invoice.invoiceRef}</span>
        </a>
      </div>
    </article>
  );
}
