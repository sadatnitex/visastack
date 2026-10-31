import {
  TEST_PAYMENT_LABEL,
  formatBillingDate,
  formatBillingDateTime,
  formatCoveredPeriod,
  formatMoney,
} from '@visastack/core';
import {
  PERSON_REFUNDS_UNAVAILABLE,
  PERSON_REFUND_WINDOW_DAYS,
  type RefundStatus,
  type TravellerBilling,
  type TravellerBillingResult,
  type TravellerNeedsCheckItem,
  getTravellerBilling,
  listTravellerNeedsCheck,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, StatusBadge } from '../../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import {
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  holdReasonLabel,
  receiptKindLabel,
} from '../../../../../lib/invoice-labels';
import { withSession } from '../../../../../lib/session';
import { AdminRestricted } from '../../admin-restricted';
import { LazyDisclosure, RefundFeedback } from '../../organizations/[orgId]/refund-feedback';
import { TravellerRefundForm } from './forms';

/**
 * Traveller Billing (ADR 0025, T6b): the platform owner's view of one traveller's own purchases,
 * payments, held payments and refunds, found by the reference code their invoices carry or by a
 * purchase reference, with the traveller payments that need a check, and a form to record each
 * full refund made in the gateway panel. Platform owner only (`BILLING_REFUND_MANAGE`).
 *
 * A traveller is only ever shown by a reference code: this page never shows a name, an email or
 * an account id, and the services it reads return none. Payment ids travel only inside the hidden
 * fields of a refund form.
 */

export const metadata: Metadata = { title: 'Traveller Billing' };

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_FIELD = 'traveller-code';
const CODE_ERROR = 'traveller-code-error';
const NOT_FOUND = 'No traveller has that reference code or purchase reference.';
const CONFIRMING = 'Still confirming with the payment gateway after 30 minutes.';

/** A day as a date field takes it (YYYY-MM-DD), in Bangladesh time. */
function dayField(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function refundStatusLabel(status: string): string {
  return Object.hasOwn(REFUND_STATUS_LABELS, status)
    ? REFUND_STATUS_LABELS[status as RefundStatus]
    : 'Unknown';
}

function refundStatusTone(status: string) {
  return Object.hasOwn(REFUND_STATUS_TONES, status)
    ? REFUND_STATUS_TONES[status as RefundStatus]
    : 'neutral';
}

function lookupHref(item: TravellerNeedsCheckItem): string {
  // A purchase reference names exactly one traveller; a short code can be shared.
  const code = item.invoiceRef.length > 0 ? item.invoiceRef : item.shortCode;
  return `/app/admin/billing/travellers?code=${encodeURIComponent(code)}`;
}

function NeedsCheck({ items }: { readonly items: readonly TravellerNeedsCheckItem[] }) {
  return (
    <article className="card u-mb-150" aria-labelledby="needs-check-title">
      <h2 className="card-title" id="needs-check-title">
        Needs a Check
      </h2>
      <p className="card-body u-mb-100">
        Traveller payments held for a check that still have money left, and payments still
        confirming after 30 minutes.
      </p>
      {items.length === 0 ? (
        <p className="card-body">No traveller payment needs a check.</p>
      ) : (
        <table className="data-table">
          <caption className="sr-only">Traveller Payments That Need a Check</caption>
          <thead>
            <tr>
              <th scope="col">Reference Code</th>
              <th scope="col">Purchase</th>
              <th scope="col">Amount</th>
              <th scope="col">Why</th>
              <th scope="col">Since</th>
              <th scope="col">Look Up</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.invoiceRef}-${index}`}>
                <th scope="row" className="cell-main">
                  {item.shortCode}
                </th>
                <td data-label="Purchase">{item.invoiceRef}</td>
                <td data-label="Amount">{formatMoney(item.amountMinorUnits, item.currency)}</td>
                <td data-label="Why">
                  {item.kind === 'held' ? holdReasonLabel(item.reasonCode) : CONFIRMING}
                </td>
                <td data-label="Since">{formatBillingDateTime(item.since)}</td>
                <td data-label="Look Up">
                  <Link href={lookupHref(item)} className="invoice-link">
                    Look Up {item.invoiceRef}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

function FindTraveller({ code, problem }: { readonly code: string; readonly problem?: string }) {
  return (
    <article className="card u-mb-150" aria-labelledby="find-traveller-title">
      <h2 className="card-title" id="find-traveller-title">
        Find a Traveller
      </h2>
      <form method="get" action="/app/admin/billing/travellers" className="field-list form-narrow">
        <div className="field-row">
          <label className="field-label" htmlFor={CODE_FIELD}>
            Reference Code or Purchase Reference
          </label>
          <input
            id={CODE_FIELD}
            name="code"
            type="search"
            required
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            defaultValue={code}
            className="input"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${CODE_FIELD}-hint ${CODE_ERROR}` : `${CODE_FIELD}-hint`}
          />
          <p id={`${CODE_FIELD}-hint`} className="muted u-fs-085">
            The code on the traveller's invoices (for example A1B2C3D4), or a purchase reference
            (for example TP-A1B2C3D4-3).
          </p>
          {problem ? (
            <p id={CODE_ERROR} className="field-msg field-msg-err">
              {problem}
            </p>
          ) : null}
        </div>
        <div>
          <button type="submit" className="btn btn-secondary u-btn-sm">
            Find Traveller
          </button>
        </div>
      </form>
    </article>
  );
}

function Purchases({
  person,
  shown,
}: { readonly person: TravellerBilling; readonly shown: string }) {
  if (person.invoices.length === 0) return <p className="card-body u-mb-100">No purchases.</p>;
  return (
    <table className="data-table u-mb-100">
      <caption className="sr-only">Purchases of {shown}</caption>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Plan</th>
          <th scope="col">Period</th>
          <th scope="col">Amount</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {person.invoices.map((invoice, index) => (
          <tr key={`${invoice.invoiceRef}-${index}`}>
            <th scope="row" className="cell-main">
              {invoice.invoiceRef}
            </th>
            <td data-label="Plan">
              {invoice.planName}
              {invoice.renewal ? ' (renewal)' : ''}
            </td>
            <td data-label="Period">
              {formatCoveredPeriod(invoice.periodStart, invoice.periodEnd)}
            </td>
            <td data-label="Amount">{formatMoney(invoice.amountMinorUnits, invoice.currency)}</td>
            <td data-label="Status">{invoice.statusLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModeBadge({ mode }: { readonly mode: 'TEST' | 'LIVE' }) {
  return mode === 'TEST' ? (
    <StatusBadge tone="warning">{TEST_PAYMENT_LABEL}</StatusBadge>
  ) : (
    <StatusBadge tone="neutral">Live</StatusBadge>
  );
}

function Payments({
  person,
  shown,
  now,
}: {
  readonly person: TravellerBilling;
  readonly shown: string;
  readonly now: Date;
}) {
  if (person.payments.length === 0) return <p className="card-body u-mb-100">No payments.</p>;
  return (
    <table className="data-table u-mb-100">
      <caption className="sr-only">Payments of {shown}</caption>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Kind</th>
          <th scope="col">Test or Live</th>
          <th scope="col">Amount</th>
          <th scope="col">Paid On</th>
          <th scope="col">Can Still Go Back</th>
          <th scope="col">7 Days End</th>
        </tr>
      </thead>
      <tbody>
        {person.payments.map((payment, index) => {
          const outside = now.getTime() > payment.refundWindowEndsAt.getTime();
          return (
            <tr key={`${payment.invoiceRef}-${index}`}>
              <th scope="row" className="cell-main">
                {payment.invoiceRef}
              </th>
              <td data-label="Kind">{receiptKindLabel(payment.kind)}</td>
              <td data-label="Test or Live">
                <ModeBadge mode={payment.mode} />
              </td>
              <td data-label="Amount">{formatMoney(payment.amountMinorUnits, payment.currency)}</td>
              <td data-label="Paid On">{formatBillingDate(payment.collectedDate)}</td>
              <td data-label="Can Still Go Back">
                {payment.refundableMinorUnits > 0
                  ? formatMoney(payment.refundableMinorUnits, payment.currency)
                  : 'Nothing'}
              </td>
              <td data-label="7 Days End">
                {formatBillingDateTime(payment.refundWindowEndsAt)}
                {outside ? (
                  <>
                    {' '}
                    <StatusBadge tone="warning">Outside 7 Days</StatusBadge>
                  </>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Held({ person, shown }: { readonly person: TravellerBilling; readonly shown: string }) {
  if (person.held.length === 0) return <p className="card-body u-mb-100">No held payments.</p>;
  return (
    <table className="data-table u-mb-100">
      <caption className="sr-only">Held Payments of {shown}</caption>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Why It Was Held</th>
          <th scope="col">Amount</th>
          <th scope="col">Left</th>
          <th scope="col">Since</th>
        </tr>
      </thead>
      <tbody>
        {person.held.map((held, index) => (
          <tr key={`${held.invoiceRef}-${index}`}>
            <th scope="row" className="cell-main">
              {held.invoiceRef}
            </th>
            <td data-label="Why It Was Held">{holdReasonLabel(held.reasonCode)}</td>
            <td data-label="Amount">{formatMoney(held.amountMinorUnits, held.currency)}</td>
            <td data-label="Left">
              {held.remainingMinorUnits > 0
                ? formatMoney(held.remainingMinorUnits, held.currency)
                : 'Nothing'}
            </td>
            <td data-label="Since">{formatBillingDateTime(held.since)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Refunds({ person, shown }: { readonly person: TravellerBilling; readonly shown: string }) {
  if (person.refunds.length === 0) return <p className="card-body u-mb-100">No refunds yet.</p>;
  return (
    <table className="data-table u-mb-100">
      <caption className="sr-only">Refunds Made to {shown}</caption>
      <thead>
        <tr>
          <th scope="col">Purchase</th>
          <th scope="col">Refund Reference</th>
          <th scope="col">Amount</th>
          <th scope="col">Status</th>
          <th scope="col">Refunded On</th>
        </tr>
      </thead>
      <tbody>
        {person.refunds.map((refund, index) => (
          <tr key={`${refund.invoiceRef}-${index}`}>
            <th scope="row" className="cell-main">
              {refund.invoiceRef}
            </th>
            <td data-label="Refund Reference">{refund.reference ?? 'None'}</td>
            <td data-label="Amount">{formatMoney(refund.amountMinorUnits, refund.currency)}</td>
            <td data-label="Status">
              <StatusBadge tone={refundStatusTone(refund.status)}>
                {refundStatusLabel(refund.status)}
              </StatusBadge>
            </td>
            <td data-label="Refunded On">
              {refund.refundedOn ? formatBillingDate(refund.refundedOn) : 'Not Yet'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One Record Refund form for each payment, and each held payment, with something left. */
function RefundForms({
  person,
  now,
  latestDate,
}: {
  readonly person: TravellerBilling;
  readonly now: Date;
  readonly latestDate: string;
}) {
  const forms = [
    ...person.payments
      .filter((payment) => payment.refundableMinorUnits > 0)
      .map((payment, index) => ({
        formId: `traveller-refund-${person.code}-payment-${index}`,
        source: { kind: 'entry' as const, id: payment.id },
        invoiceRef: payment.invoiceRef,
        amountMinorUnits: payment.refundableMinorUnits,
        amountText: formatMoney(payment.refundableMinorUnits, payment.currency),
        earliestDate: dayField(payment.collectedDate),
        outsideWindow: now.getTime() > payment.refundWindowEndsAt.getTime(),
        testPayment: payment.mode === 'TEST',
        title: `Record Refund (${payment.invoiceRef}${payment.mode === 'TEST' ? `, ${TEST_PAYMENT_LABEL}` : ''})`,
      })),
    ...person.held
      .filter((held) => held.remainingMinorUnits > 0)
      .map((held, index) => ({
        formId: `traveller-refund-${person.code}-held-${index}`,
        source: { kind: 'held' as const, id: held.id },
        invoiceRef: held.invoiceRef,
        amountMinorUnits: held.remainingMinorUnits,
        amountText: formatMoney(held.remainingMinorUnits, held.currency),
        earliestDate: dayField(held.since),
        outsideWindow: now.getTime() - held.since.getTime() > PERSON_REFUND_WINDOW_DAYS * DAY_MS,
        testPayment: false,
        title: `Record Refund (${held.invoiceRef}, Held Payment)`,
      })),
  ];
  if (forms.length === 0) {
    return <p className="card-body">Nothing is left to refund for this traveller.</p>;
  }
  return (
    <>
      {forms.map(({ title, ...form }) => (
        <LazyDisclosure key={form.formId} title={title}>
          <TravellerRefundForm {...form} latestDate={latestDate} />
        </LazyDisclosure>
      ))}
    </>
  );
}

function Person({
  person,
  shared,
  refundsAvailable,
  now,
  latestDate,
}: {
  readonly person: TravellerBilling;
  /** Several people share the short code, so the longer one tells them apart. */
  readonly shared: boolean;
  readonly refundsAvailable: boolean;
  readonly now: Date;
  readonly latestDate: string;
}) {
  const shown = shared ? person.code : person.shortCode;
  const titleId = `traveller-${person.code}-title`;
  return (
    <article className="card u-mb-150" aria-labelledby={titleId}>
      <p className="card-kicker">Traveller</p>
      <h2 className="card-title" id={titleId}>
        Reference Code {shown}
      </h2>
      {shared ? (
        <p className="muted u-fs-085 u-mb-100">
          Another traveller shares the short code {person.shortCode}, so this one is shown by its
          longer code.
        </p>
      ) : null}

      <h3 className="invoice-subhead">Plan</h3>
      {person.plan ? (
        <div className="rows rows-grid u-mb-100">
          <div className="row">
            <span className="row-key">Plan</span>
            <span>{person.plan.planName}</span>
          </div>
          <div className="row">
            <span className="row-key">Renewing</span>
            <span>{person.plan.renews ? 'Yes' : 'No'}</span>
          </div>
          <div className="row">
            <span className="row-key">Paid Until</span>
            <span>
              {person.plan.paidUntil
                ? formatBillingDateTime(person.plan.paidUntil)
                : 'Not paid now'}
            </span>
          </div>
        </div>
      ) : (
        <p className="card-body u-mb-100">No plan now.</p>
      )}

      <h3 className="invoice-subhead">Purchases</h3>
      <Purchases person={person} shown={shown} />

      <h3 className="invoice-subhead">Payments</h3>
      <Payments person={person} shown={shown} now={now} />

      <h3 className="invoice-subhead">Held Payments</h3>
      <Held person={person} shown={shown} />

      <h3 className="invoice-subhead">Refunds Made</h3>
      <Refunds person={person} shown={shown} />

      {refundsAvailable ? (
        <>
          <h3 className="invoice-subhead">Record a Refund</h3>
          <p className="card-body u-mb-100">
            Make the refund in the payment gateway's merchant panel first, then record it here with
            the panel's refund reference. A refund is always all that is left of the payment.
            Refunding the period that covers today ends the traveller's plan at once. Every refund
            asks you to confirm it is you.
          </p>
          <RefundForms person={person} now={now} latestDate={latestDate} />
        </>
      ) : null}
    </article>
  );
}

function Results({
  result,
  now,
  latestDate,
}: {
  readonly result: TravellerBillingResult;
  readonly now: Date;
  readonly latestDate: string;
}) {
  const shared = result.people.length > 1;
  return (
    <>
      {result.refundsAvailable ? null : (
        <output className="notice notice-warn u-mb-150">{PERSON_REFUNDS_UNAVAILABLE}</output>
      )}
      {result.people.length === 0 ? (
        <p className="card-body">{NOT_FOUND}</p>
      ) : (
        <RefundFeedback>
          {result.people.map((person) => (
            <Person
              key={person.code}
              person={person}
              shared={shared}
              refundsAvailable={result.refundsAvailable}
              now={now}
              latestDate={latestDate}
            />
          ))}
        </RefundFeedback>
      )}
    </>
  );
}

function firstOf(value: string | readonly string[] | undefined): string {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === 'string' ? one.trim().slice(0, 64) : '';
}

/** The platform owner looks up a traveller's own billing and records their full refunds. */
export default async function TravellerBillingPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly code?: string | readonly string[] }>;
}) {
  const code = firstOf((await searchParams)?.code);
  const now = new Date();
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_REFUND_MANAGE',
    );
    if (!staff.ok) return { kind: 'restricted' as const };
    const needs = await listTravellerNeedsCheck(db, staff.value, { now });
    if (!needs.ok) return { kind: 'restricted' as const };
    if (code.length === 0) return { kind: 'ready' as const, needs: needs.value, found: null };
    const found = await getTravellerBilling(db, staff.value, { code, now });
    if (!found.ok && found.error.code === 'forbidden') return { kind: 'restricted' as const };
    return {
      kind: 'ready' as const,
      needs: needs.value,
      found: found.ok
        ? { ok: true as const, value: found.value }
        : { ok: false as const, message: found.error.message },
    };
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin/settings', label: 'Settings' }}
        eyebrow="Platform Settings"
        title="Traveller Billing"
        description="A traveller's own purchases, payments and refunds, found by the reference code on their invoices. A traveller is shown only by that code."
      />
      {data.kind === 'restricted' ? (
        <AdminRestricted />
      ) : (
        <>
          <NeedsCheck items={data.needs} />
          <FindTraveller
            code={code}
            {...(data.found && !data.found.ok ? { problem: data.found.message } : {})}
          />
          {data.found?.ok ? (
            <Results result={data.found.value} now={now} latestDate={dayField(now)} />
          ) : null}
        </>
      )}
    </section>
  );
}
