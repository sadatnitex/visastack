import { randomUUID } from 'node:crypto';
import {
  NO_OPEN_INVOICE_FOR_CREDIT,
  type OrganizationRefundWork,
  REFUNDS_UNAVAILABLE,
  type RefundRequestView,
  formatAmountForCurrency,
} from '@visastack/services';
import type { ReactNode } from 'react';
import { StatusBadge } from '../../../../../components/ui';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import {
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  holdReasonLabel,
  receiptKindLabel,
} from '../../../../../lib/invoice-labels';
import { formatPrice } from '../../../../../lib/usage-format';
import {
  ApplyCreditForm,
  CancelRefundForm,
  CheckRefundsButton,
  ManualRefundForm,
  RefundForm,
  RetryRefundButton,
} from './refund-forms';

/**
 * The Refunds and Credits card of the admin organization page (Small Commercial V1 S18): money
 * the gateway confirmed that was held for a check (apply it to the next invoice, or refund it),
 * counted payments that can still give something back, and every refund with where it stands.
 */

/** Decimal text for a form field ("1500.00"), in the currency's own number of places. */
function decimal(minorUnits: number, currency: string): string {
  return formatAmountForCurrency(minorUnits, currency).slice(currency.length).trim();
}

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

function Disclosure({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <details className="disclosure u-mt-100">
      <summary>
        <span className="disclosure-title">{title}</span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

function RefundLine({
  organizationId,
  request,
  gatewayAvailable,
}: {
  readonly organizationId: string;
  readonly request: RefundRequestView;
  readonly gatewayAvailable: boolean;
}) {
  const unconfirmed = request.method === 'PROVIDER' && request.status === 'REQUESTED';
  return (
    <li className="invoice-list-item invoice-list-item-block">
      <span className="row-key">{request.invoiceRef}</span>
      <span>
        {formatPrice(request.amountMinorUnits, request.currency)}
        {request.fromHeldPayment ? ' from a payment that needed a check' : ''}, asked on{' '}
        {formatTimestampDate(request.createdAt)}.{' '}
        {request.method === 'MANUAL'
          ? `Made outside VisaStack, reference ${request.reference ?? ''}.`
          : 'Through the payment gateway.'}
      </span>
      <StatusBadge tone={REFUND_STATUS_TONES[request.status]}>
        {REFUND_STATUS_LABELS[request.status]}
      </StatusBadge>
      <span className="muted u-fs-085">Reason: {request.reason}</span>
      {request.status === 'FAILED' ? (
        <span className="muted u-fs-085">{failureWords(request.failureCode)}</span>
      ) : null}
      {unconfirmed ? (
        <>
          <p className="invoice-note">
            We could not confirm the refund was sent. Check the payment gateway's merchant panel
            before doing anything else. If the refund is there, wait for it to be confirmed here. If
            it is not, send it again or cancel it.
          </p>
          <div className="invoice-action-row">
            {gatewayAvailable ? (
              <RetryRefundButton organizationId={organizationId} refundRequestId={request.id} />
            ) : null}
          </div>
          <Disclosure title="Cancel This Refund">
            <CancelRefundForm organizationId={organizationId} refundRequestId={request.id} />
          </Disclosure>
        </>
      ) : null}
    </li>
  );
}

export function RefundsCard({
  organizationId,
  work,
  gatewayAvailable,
  latestDate,
  problem,
}: {
  readonly organizationId: string;
  /** Undefined when the owner's refund scope could not be made (`problem` says why). */
  readonly work: OrganizationRefundWork | undefined;
  /** True when the payment gateway can be asked to refund in this deployment. */
  readonly gatewayAvailable: boolean;
  /** Today in Bangladesh (YYYY-MM-DD): the latest day a refund can have been made. */
  readonly latestDate: string;
  readonly problem?: string;
}) {
  return (
    <article className="card u-mb-150">
      <p className="card-kicker">Commerce</p>
      <h2 className="card-title">Refunds and Credits</h2>
      {!work ? (
        <p className="card-body">{problem ?? 'Refunds cannot be shown right now.'}</p>
      ) : !work.available ? (
        <p className="card-body">{REFUNDS_UNAVAILABLE}</p>
      ) : (
        <>
          <p className="card-body u-mb-100">
            A refund through the payment gateway counts only once the gateway confirms it. A refund
            made another way is recorded here with its reference. Every action asks you to confirm
            it is you.
          </p>

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
                const limit = decimal(held.remainingMinorUnits, held.currency);
                return (
                  <li key={held.id} className="invoice-list-item invoice-list-item-block">
                    <span className="row-key">{held.invoiceRef}</span>
                    <span>
                      {formatPrice(held.amountMinorUnits, held.currency)} paid online on{' '}
                      {formatTimestampDate(held.createdAt)}. {holdReasonLabel(held.reasonCode)}
                    </span>
                    <span className="muted u-fs-085">
                      {formatPrice(held.remainingMinorUnits, held.currency)} is left to apply or
                      refund
                      {held.creditedMinorUnits > 0
                        ? `; ${formatPrice(held.creditedMinorUnits, held.currency)} was applied as a credit`
                        : ''}
                      .
                    </span>
                    {held.remainingMinorUnits > 0 &&
                    held.verified &&
                    held.creditedMinorUnits === 0 ? (
                      <Disclosure title="Apply to Next Invoice">
                        {targets.length > 0 ? (
                          <ApplyCreditForm
                            organizationId={organizationId}
                            paymentAttemptId={held.id}
                            targets={targets}
                          />
                        ) : (
                          <p className="card-body">{NO_OPEN_INVOICE_FOR_CREDIT}</p>
                        )}
                      </Disclosure>
                    ) : null}
                    {held.remainingMinorUnits > 0 && held.viaGateway && gatewayAvailable ? (
                      <Disclosure title="Refund">
                        <RefundForm
                          organizationId={organizationId}
                          source={{ kind: 'held', id: held.id }}
                          currency={held.currency}
                          limit={limit}
                          idempotencyKey={randomUUID()}
                        />
                      </Disclosure>
                    ) : null}
                    {held.remainingMinorUnits > 0 ? (
                      <Disclosure title="Record a Refund Made Outside VisaStack">
                        <ManualRefundForm
                          organizationId={organizationId}
                          source={{ kind: 'held', id: held.id }}
                          currency={held.currency}
                          limit={limit}
                          idempotencyKey={randomUUID()}
                          latestDate={latestDate}
                        />
                      </Disclosure>
                    ) : null}
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
                const limit = decimal(entry.refundableMinorUnits, entry.currency);
                return (
                  <li key={entry.id} className="invoice-list-item invoice-list-item-block">
                    <span className="row-key">{entry.invoiceRef}</span>
                    <span>
                      {receiptKindLabel(entry.kind)},{' '}
                      {formatPrice(entry.amountMinorUnits, entry.currency)} on{' '}
                      {formatTimestampDate(entry.createdAt)}. Reference {entry.reference}.
                    </span>
                    <span className="muted u-fs-085">
                      Up to {formatPrice(entry.refundableMinorUnits, entry.currency)} can be
                      refunded.
                    </span>
                    {entry.viaGateway && gatewayAvailable ? (
                      <Disclosure title="Refund">
                        <RefundForm
                          organizationId={organizationId}
                          source={{ kind: 'entry', id: entry.id }}
                          currency={entry.currency}
                          limit={limit}
                          idempotencyKey={randomUUID()}
                        />
                      </Disclosure>
                    ) : null}
                    <Disclosure title="Record a Refund Made Outside VisaStack">
                      <ManualRefundForm
                        organizationId={organizationId}
                        source={{ kind: 'entry', id: entry.id }}
                        currency={entry.currency}
                        limit={limit}
                        idempotencyKey={randomUUID()}
                        latestDate={latestDate}
                      />
                    </Disclosure>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="invoice-subhead">Refunds</h3>
          {gatewayAvailable && work.requests.some((r) => r.status === 'SUBMITTED') ? (
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
                />
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
