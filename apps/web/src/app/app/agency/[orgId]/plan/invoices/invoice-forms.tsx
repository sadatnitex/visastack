'use client';

import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../../components/form-feedback';
import { CLAIM_METHOD_LABELS } from '../../../../../../lib/invoice-labels';
import {
  type ClaimValues,
  type InvoiceActionState,
  checkPaymentAction,
  startPaymentAction,
  submitClaimAction,
} from './actions';

const INITIAL: InvoiceActionState = { ok: true, message: '' };

/** "Pay Online": sends the person to the payment page for the whole balance of one invoice. */
export function PayOnlineButton({
  organizationId,
  invoiceId,
}: {
  readonly organizationId: string;
  readonly invoiceId: string;
}) {
  const [state, formAction, pending] = useActionState(startPaymentAction, INITIAL);
  return (
    <form action={formAction} className="invoice-action">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <SubmitButton pending={pending} idle="Pay Online" busy="Opening the Payment Page" />
      <FormMessage result={state} pending={pending} pendingText="Opening the payment page." />
    </form>
  );
}

/** Shown while a payment started a few minutes ago may still be open: check it, or start another on purpose. */
export function RecentPaymentChoices({
  organizationId,
  invoiceId,
  startedAt,
}: {
  readonly organizationId: string;
  readonly invoiceId: string;
  /** When the payment was started, already formatted for the reader. */
  readonly startedAt: string;
}) {
  const [checkState, checkAction, checking] = useActionState(checkPaymentAction, INITIAL);
  const [startState, startAction, starting] = useActionState(startPaymentAction, INITIAL);
  return (
    <div className="invoice-recent">
      <p className="invoice-note">
        A payment for this invoice was started at {startedAt}. Check it before paying again.
      </p>
      <div className="invoice-action-row">
        <form action={checkAction} className="invoice-action">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <SubmitButton
            pending={checking}
            idle="Check Status"
            busy="Checking"
            className="btn btn-primary"
          />
          <FormMessage result={checkState} pending={checking} pendingText="Checking the payment." />
        </form>
        <form action={startAction} className="invoice-action">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="startAnother" value="yes" />
          <SubmitButton
            pending={starting}
            idle="Start Another Payment"
            busy="Opening the Payment Page"
            className="btn btn-secondary"
          />
          <FormMessage
            result={startState}
            pending={starting}
            pendingText="Opening the payment page."
          />
        </form>
      </div>
    </div>
  );
}

/** "Check Status" on its own, for an invoice whose payment page was opened a while ago. */
export function CheckStatusButton({
  organizationId,
  invoiceId,
}: {
  readonly organizationId: string;
  readonly invoiceId: string;
}) {
  const [state, formAction, pending] = useActionState(checkPaymentAction, INITIAL);
  return (
    <form action={formAction} className="invoice-action">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <SubmitButton
        pending={pending}
        idle="Check Status"
        busy="Checking"
        className="btn btn-secondary"
      />
      <FormMessage result={state} pending={pending} pendingText="Checking the payment." />
    </form>
  );
}

/**
 * "I Paid Another Way": the report form. It records nothing; the invoice shows a waiting report
 * until VisaStack confirms it. The optional file is the proof (a bank slip or a screenshot).
 */
export function ClaimForm({
  organizationId,
  invoiceId,
  currency,
  balance,
  latestDate,
}: {
  readonly organizationId: string;
  readonly invoiceId: string;
  readonly currency: string;
  /** What the invoice still owes, as plain digits in the invoice currency (for example 1250.50). */
  readonly balance: string;
  /** The latest date that can be chosen (YYYY-MM-DD): the newest day anywhere on earth, so nobody is blocked from choosing their own today. */
  readonly latestDate: string;
}) {
  const [state, formAction, pending] = useActionState(submitClaimAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  const base = useId();
  useFocusInvalidField(formRef, state);
  // When a report is refused the page gives back what was typed (never the file), because a form
  // action clears an uncontrolled form once it finishes.
  const kept: Partial<ClaimValues> = state.values ?? {};
  return (
    <details className="invoice-claim" open={state.values !== undefined ? true : undefined}>
      <summary className="invoice-claim-summary">I Paid Another Way</summary>
      <form ref={formRef} action={formAction} className="field-list invoice-claim-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="currency" value={currency} />
        <p className="invoice-note">
          Tell us about a payment you already made by bank transfer, bKash or cheque. Nothing is
          counted until VisaStack confirms it.
        </p>
        <div className="field-row">
          <label className="field-label" htmlFor={`${base}-method`}>
            How You Paid
          </label>
          {/* The key makes the list start again from what was kept: a list does not take a new default by itself. */}
          <select
            key={kept.method ?? 'first'}
            id={`${base}-method`}
            name="method"
            className="input"
            required
            defaultValue={kept.method ?? 'BANK_TRANSFER'}
            {...fieldProblem(state, 'method', messageId)}
          >
            {Object.entries(CLAIM_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${base}-reference`}>
            Payment Reference
          </label>
          <input
            id={`${base}-reference`}
            name="reference"
            type="text"
            className="input"
            required
            maxLength={120}
            autoComplete="off"
            defaultValue={kept.reference ?? ''}
            {...fieldProblem(state, 'reference', messageId)}
          />
          <p className="invoice-hint">A transfer id, bKash transaction id or cheque number.</p>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${base}-amount`}>
            {`Amount Paid (${currency})`}
          </label>
          <input
            id={`${base}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            className="input"
            required
            defaultValue={kept.amount ?? balance}
            autoComplete="off"
            {...fieldProblem(state, 'amount', messageId)}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${base}-paid-on`}>
            Date Paid
          </label>
          <input
            id={`${base}-paid-on`}
            name="paidOn"
            type="date"
            className="input"
            required
            max={latestDate}
            defaultValue={kept.paidOn ?? ''}
            {...fieldProblem(state, 'paidOn', messageId)}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${base}-note`}>
            Note (Optional)
          </label>
          <textarea
            id={`${base}-note`}
            name="note"
            className="input"
            rows={2}
            maxLength={500}
            defaultValue={kept.note ?? ''}
            {...fieldProblem(state, 'note', messageId)}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${base}-proof`}>
            Proof of Payment (Optional)
          </label>
          <input
            id={`${base}-proof`}
            name="proof"
            type="file"
            className="input"
            accept="application/pdf,image/jpeg,image/png"
            {...fieldProblem(state, 'proof', messageId)}
          />
          <p className="invoice-hint">
            A photo or screenshot (JPEG or PNG) or a PDF, under 4 MB. Only your owners and admins
            and VisaStack staff can open it. If you report again after an error, choose the file
            again.
          </p>
        </div>
        <SubmitButton pending={pending} idle="Report This Payment" busy="Sending Your Report" />
        <FormMessage
          id={messageId}
          result={state}
          pending={pending}
          pendingText="Sending your report."
        />
      </form>
    </details>
  );
}
