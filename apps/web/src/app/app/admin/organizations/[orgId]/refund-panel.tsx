import {
  DUPLICATE_REFERENCE_CODE,
  NEEDS_CHECK_CODE,
  NO_OPEN_INVOICE_FOR_CREDIT,
  type OrganizationRefundWork,
  REFUNDS_UNAVAILABLE,
  REFUND_WORK_LIMIT,
  RETRY_REFUSED_CODE,
  type RefundRequestView,
} from '@visastack/services';
import { StatusBadge } from '../../../../../components/ui';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import {
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  holdReasonLabel,
  receiptKindLabel,
} from '../../../../../lib/invoice-labels';
import { REFUNDS_IN_PANEL } from '../../../../../lib/refund-gateway';
import { formatPrice } from '../../../../../lib/usage-format';
import { LazyDisclosure, RefundFeedback } from './refund-feedback';
import {
  ApplyCreditForm,
  CancelRefundForm,
  CheckRefundsButton,
  ConfirmUnsentRefundForm,
  ManualRefundForm,
  RefundForm,
  RetryRefundButton,
} from './refund-forms';

/**
 * The Refunds and Credits card of the admin organization page (Small Commercial V1 S18): money
 * the gateway confirmed that was held for a check (apply it to the next invoice, or refund it),
 * counted payments that can still give something back, and every refund with where it stands.
 * Forms are drawn only when their disclosure is opened.
 */

const FAILURE_WORDS: Readonly<Record<string, string>> = {
  provider_cancelled: 'The payment gateway cancelled it.',
  provider_refused: 'The payment gateway refused it.',
  invalid_request: 'The payment gateway could not take it.',
};

function failureWords(code: string | null): string {
  return code !== null && Object.hasOwn(FAILURE_WORDS, code)
    ? (FAILURE_WORDS[code] ?? 'It did not go through.')
    : 'It did not go through.';
}

/** A day as a date field takes it (YYYY-MM-DD), in Bangladesh time. */
function dayField(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function RefundLine({
  organizationId,
  request,
  gatewayAvailable,
  latestDate,
}: {
  readonly organizationId: string;
  readonly request: RefundRequestView;
  readonly gatewayAvailable: boolean;
  readonly latestDate: string;
}) {
  const unconfirmed = request.method === 'PROVIDER' && request.status === 'REQUESTED';
  const needsCheck =
    request.status === 'SUBMITTED' &&
    (request.failureCode === NEEDS_CHECK_CODE || request.failureCode === DUPLICATE_REFERENCE_CODE);
  return (
    <li
      id={`refund-line-${request.id}`}
      tabIndex={-1}
      className="invoice-list-item invoice-list-item-block"
    >
      <span className="row-key">{request.invoiceRef}</span>
      <span>
        {formatPrice(request.amountMinorUnits, request.currency)}
        {request.fromHeldPayment ? ' from a payment that needed a check' : ''}.{' '}
        {request.method === 'MANUAL'
          ? `Made outside VisaStack, reference ${request.reference ?? ''}${request.refundedOn ? `, refunded on ${formatDateOnly(request.refundedOn)}` : ''}; recorded on ${formatTimestampDate(request.createdAt)}.`
          : `Through the payment gateway, asked on ${formatTimestampDate(request.createdAt)}${request.refundedOn ? `, refunded on ${formatDateOnly(request.refundedOn)}` : ''}.`}
      </span>
      <StatusBadge tone={needsCheck ? 'danger' : REFUND_STATUS_TONES[request.status]}>
        {needsCheck ? 'Needs a Check' : REFUND_STATUS_LABELS[request.status]}
      </StatusBadge>
      <span className="muted u-fs-085">Reason: {request.reason}</span>
      {request.status === 'FAILED' ? (
        <span className="muted u-fs-085">{failureWords(request.failureCode)}</span>
      ) : null}
      {needsCheck ? (
        <p className="invoice-note">
          {request.failureCode === DUPLICATE_REFERENCE_CODE
            ? 'The payment gateway says this refund was made, but its refund reference is already recorded for another refund, so it was not counted again.'
            : 'The payment gateway says this refund was made, but the invoice no longer holds that much money, so it was not taken off.'}{' '}
          Look at the invoice and the gateway's merchant panel before doing anything else.
        </p>
      ) : null}
      {unconfirmed ? (
        <>
          <p className="invoice-note">
            {request.failureCode === RETRY_REFUSED_CODE
              ? 'The payment gateway answered "failed" to the second send, which can mean the first send already went through. The amount stays blocked.'
              : 'We could not confirm the refund was sent. The amount stays blocked until you decide.'}{' '}
            Check the payment gateway's merchant panel for this refund. If it is there, choose It
            Went Through and enter its reference and day. If it is not, choose It Did Not Go Through
            {gatewayAvailable ? ', or send it again' : ''}.
          </p>
          {gatewayAvailable && request.failureCode !== RETRY_REFUSED_CODE ? (
            <div className="invoice-action-row">
              <RetryRefundButton organizationId={organizationId} refundRequestId={request.id} />
            </div>
          ) : null}
          <LazyDisclosure title={`It Went Through (${request.invoiceRef})`}>
            <ConfirmUnsentRefundForm
              organizationId={organizationId}
              refundRequestId={request.id}
              currency={request.currency}
              earliestDate={dayField(request.createdAt)}
              latestDate={latestDate}
            />
          </LazyDisclosure>
          <LazyDisclosure title={`It Did Not Go Through (${request.invoiceRef})`}>
            <CancelRefundForm organizationId={organizationId} refundRequestId={request.id} />
          </LazyDisclosure>
        </>
      ) : null}
    </li>
  );
}

/** The page note, Newer and Older Payments, and the search by invoice reference (plain links and a GET form). */
function RefundPaging({
  organizationId,
  work,
}: {
  readonly organizationId: string;
  readonly work: OrganizationRefundWork;
}) {
  const search = work.invoiceRef ?? '';
  const query = search.length > 0 ? `&refundInvoice=${encodeURIComponent(search)}` : '';
  const first = (work.page - 1) * REFUND_WORK_LIMIT + 1;
  const cut = [
    work.moreEntries ? 'payments that can be refunded' : null,
    work.moreHeld ? 'payments needing a check' : null,
  ].filter((part): part is string => part !== null);
  return (
    <div className="u-mb-100">
      {work.page > 1 || cut.length > 0 ? (
        <p className="muted u-fs-085">
          {work.page > 1
            ? `Showing older payments, from number ${first}, newest first${search ? ` on invoices matching ${search}` : ''}.`
            : `Showing the ${REFUND_WORK_LIMIT} most recent ${cut.join(' and the 25 most recent ')}${search ? ` on invoices matching ${search}` : ''}.`}
        </p>
      ) : search ? (
        <p className="muted u-fs-085">Showing payments on invoices matching {search}.</p>
      ) : null}
      <div className="invoice-action-row">
        {work.page > 1 ? (
          <a
            className="invoice-link"
            href={`/app/admin/organizations/${organizationId}?refundPage=${work.page - 1}${query}#refunds-title`}
          >
            Newer Payments
          </a>
        ) : null}
        {work.moreEntries || work.moreHeld ? (
          <a
            className="invoice-link"
            href={`/app/admin/organizations/${organizationId}?refundPage=${work.page + 1}${query}#refunds-title`}
          >
            Older Payments
          </a>
        ) : null}
      </div>
      <form
        method="get"
        action={`/app/admin/organizations/${organizationId}`}
        className="field-list"
      >
        <div className="field-row">
          <label className="field-label" htmlFor="refund-invoice-search">
            Find Payments by Invoice Reference
          </label>
          <input
            id="refund-invoice-search"
            name="refundInvoice"
            type="search"
            maxLength={60}
            defaultValue={search}
            className="input"
          />
        </div>
        <div>
          <button type="submit" className="btn btn-secondary u-btn-sm">
            Find Payments
          </button>
        </div>
      </form>
    </div>
  );
}

export function RefundsCard({
  organizationId,
  work,
  gatewayAvailable,
  checkAvailable,
  latestDate,
  problem,
}: {
  readonly organizationId: string;
  /** Undefined when the owner's refund scope could not be made (`problem` says why). */
  readonly work: OrganizationRefundWork | undefined;
  /** True when refunds may be sent to the payment gateway here (switched on and set up). */
  readonly gatewayAvailable: boolean;
  /** True when sent refunds can be checked with the payment gateway here. */
  readonly checkAvailable: boolean;
  /** Today in Bangladesh (YYYY-MM-DD): the latest day a refund can have been made. */
  readonly latestDate: string;
  readonly problem?: string;
}) {
  return (
    <article className="card u-mb-150" aria-labelledby="refunds-title">
      <p className="card-kicker">Commerce</p>
      <h2 className="card-title" id="refunds-title">
        Refunds and Credits
      </h2>
      {!work ? (
        <p className="card-body">{problem ?? 'Refunds cannot be shown right now.'}</p>
      ) : !work.available ? (
        <p className="card-body">{REFUNDS_UNAVAILABLE}</p>
      ) : (
        <RefundFeedback>
          <p className="card-body u-mb-100">
            A refund through the payment gateway counts only once the gateway confirms it. A refund
            made another way is recorded here with its reference. Every refund and credit asks you
            to confirm it is you.
          </p>
          {gatewayAvailable ? null : <p className="card-body u-mb-100">{REFUNDS_IN_PANEL}</p>}
          <RefundPaging organizationId={organizationId} work={work} />

          <h3 className="invoice-subhead">Payments Needing a Check</h3>
          {work.held.length === 0 ? (
            <p className="card-body u-mb-100">No payment needs a check.</p>
          ) : (
            <ul className="invoice-list u-mb-100">
              {work.held.map((held) => {
                const targets = work.creditTargets
                  .filter((target) => target.currency === held.currency)
                  .map((target) => ({
                    id: target.id,
                    label: `${target.invoiceRef}, ${formatPrice(target.outstandingMinorUnits, target.currency)} owed, due ${formatDateOnly(target.dueDate)}`,
                  }));
                const limitText = formatPrice(held.remainingMinorUnits, held.currency);
                return (
                  <li key={held.id} className="invoice-list-item invoice-list-item-block">
                    <span className="row-key">{held.invoiceRef}</span>
                    <span>
                      {formatPrice(held.amountMinorUnits, held.currency)} paid online on{' '}
                      {formatTimestampDate(held.createdAt)}. {holdReasonLabel(held.reasonCode)}
                    </span>
                    <span className="muted u-fs-085">
                      {limitText} is left to apply or refund
                      {held.creditedMinorUnits > 0
                        ? `; ${formatPrice(held.creditedMinorUnits, held.currency)} was applied as a credit`
                        : ''}
                      .
                    </span>
                    {held.verified && held.creditedMinorUnits === 0 ? (
                      <LazyDisclosure title={`Apply to Next Invoice (${held.invoiceRef})`}>
                        {targets.length > 0 ? (
                          <ApplyCreditForm
                            organizationId={organizationId}
                            paymentAttemptId={held.id}
                            targets={targets}
                          />
                        ) : (
                          <p className="card-body">{NO_OPEN_INVOICE_FOR_CREDIT}</p>
                        )}
                      </LazyDisclosure>
                    ) : null}
                    {held.viaGateway && gatewayAvailable ? (
                      <LazyDisclosure title={`Refund (${held.invoiceRef})`}>
                        <RefundForm
                          organizationId={organizationId}
                          source={{ kind: 'held', id: held.id }}
                          currency={held.currency}
                          limitText={limitText}
                        />
                      </LazyDisclosure>
                    ) : null}
                    <LazyDisclosure
                      title={`Record a Refund Made Outside VisaStack (${held.invoiceRef})`}
                    >
                      <ManualRefundForm
                        organizationId={organizationId}
                        source={{ kind: 'held', id: held.id }}
                        currency={held.currency}
                        limitText={limitText}
                        earliestDate={dayField(held.paidOn)}
                        latestDate={latestDate}
                      />
                    </LazyDisclosure>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="invoice-subhead">Payments That Can Be Refunded</h3>
          {work.entries.length === 0 ? (
            <p className="card-body u-mb-100">No counted payment can be refunded.</p>
          ) : (
            <ul className="invoice-list u-mb-100">
              {work.entries.map((entry) => {
                const limitText = formatPrice(entry.refundableMinorUnits, entry.currency);
                return (
                  <li key={entry.id} className="invoice-list-item invoice-list-item-block">
                    <span className="row-key">{entry.invoiceRef}</span>
                    <span>
                      {receiptKindLabel(entry.kind)},{' '}
                      {formatPrice(entry.amountMinorUnits, entry.currency)} on{' '}
                      {formatTimestampDate(entry.createdAt)}. Reference {entry.reference}.
                    </span>
                    <span className="muted u-fs-085">Up to {limitText} can be refunded.</span>
                    {entry.viaGateway && gatewayAvailable ? (
                      <LazyDisclosure title={`Refund (${entry.invoiceRef})`}>
                        <RefundForm
                          organizationId={organizationId}
                          source={{ kind: 'entry', id: entry.id }}
                          currency={entry.currency}
                          limitText={limitText}
                        />
                      </LazyDisclosure>
                    ) : null}
                    <LazyDisclosure
                      title={`Record a Refund Made Outside VisaStack (${entry.invoiceRef})`}
                    >
                      <ManualRefundForm
                        organizationId={organizationId}
                        source={{ kind: 'entry', id: entry.id }}
                        currency={entry.currency}
                        limitText={limitText}
                        earliestDate={dayField(entry.paidOn)}
                        latestDate={latestDate}
                      />
                    </LazyDisclosure>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="invoice-subhead">Refunds</h3>
          {checkAvailable && work.requests.some((r) => r.status === 'SUBMITTED') ? (
            <div className="invoice-action-row u-mb-100">
              <CheckRefundsButton organizationId={organizationId} />
            </div>
          ) : null}
          {work.requests.length === 0 ? (
            <p className="card-body">No refunds yet.</p>
          ) : (
            <ul className="invoice-list">
              {work.requests.map((request) => (
                <RefundLine
                  key={request.id}
                  organizationId={organizationId}
                  request={request}
                  gatewayAvailable={gatewayAvailable}
                  latestDate={latestDate}
                />
              ))}
            </ul>
          )}
        </RefundFeedback>
      )}
    </article>
  );
}
