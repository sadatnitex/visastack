'use client';

import { useActionState, useRef } from 'react';
import {
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import {
  applyCreditAction,
  cancelRefundAction,
  checkRefundsAction,
  recordManualRefundAction,
  requestRefundAction,
  retryRefundAction,
} from './refund-actions';

/**
 * The refund and credit forms of the admin organization page (Small Commercial V1 S18). Each one
 * names the payment it acts on, keeps what was typed when the server answers with a problem, and
 * points at the field at fault. Nothing here runs service code: amounts are checked again on the
 * server, which is the only place the limits are known for certain.
 */

type Source = { readonly kind: 'entry' | 'held'; readonly id: string };

function SourceFields({
  organizationId,
  source,
  currency,
  idempotencyKey,
}: {
  readonly organizationId: string;
  readonly source: Source;
  readonly currency: string;
  readonly idempotencyKey: string;
}) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="sourceKind" value={source.kind} />
      <input type="hidden" name="sourceId" value={source.id} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    </>
  );
}

function AmountField({
  id,
  state,
  label,
  currency,
  limit,
}: {
  readonly id: string;
  readonly state: FormResult;
  readonly label: string;
  readonly currency: string;
  /** The most that can be given back, as decimal text, shown under the field. */
  readonly limit: string;
}) {
  const problem = fieldProblem(state, 'amount', `${id}-error`);
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={`${id}-amount`}>
        {label} ({currency})
      </label>
      <input
        id={`${id}-amount`}
        name="amount"
        type="text"
        inputMode="decimal"
        required
        className="input"
        defaultValue={limit}
        aria-invalid={problem['aria-invalid']}
        aria-describedby={[`${id}-amount-hint`, problem['aria-describedby']]
          .filter(Boolean)
          .join(' ')}
      />
      <p id={`${id}-amount-hint`} className="muted u-fs-085">
        Up to {currency} {limit}.
      </p>
    </div>
  );
}

function ReasonField({ id, state }: { readonly id: string; readonly state: FormResult }) {
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={`${id}-reason`}>
        Reason
      </label>
      <input
        id={`${id}-reason`}
        name="reason"
        type="text"
        required
        maxLength={500}
        className="input"
        {...fieldProblem(state, 'reason', `${id}-error`)}
      />
    </div>
  );
}

/** Asks the payment gateway to refund part or all of one payment. Needs a fresh sign-in check. */
export function RefundForm({
  organizationId,
  source,
  currency,
  limit,
  idempotencyKey,
}: {
  readonly organizationId: string;
  readonly source: Source;
  readonly currency: string;
  readonly limit: string;
  readonly idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(requestRefundAction, NO_RESULT);
  const id = `refund-${source.id}`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-list">
      <SourceFields
        organizationId={organizationId}
        source={source}
        currency={currency}
        idempotencyKey={idempotencyKey}
      />
      <AmountField
        id={id}
        state={state}
        label="Amount to Refund"
        currency={currency}
        limit={limit}
      />
      <ReasonField id={id} state={state} />
      <div>
        <SubmitButton
          pending={pending}
          idle="Send Refund"
          busy="Sending"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={`${id}-error`} result={state} />
      </div>
    </form>
  );
}

/** Records a refund already made outside VisaStack, with its reference and day. Needs a fresh sign-in check. */
export function ManualRefundForm({
  organizationId,
  source,
  currency,
  limit,
  idempotencyKey,
  latestDate,
}: {
  readonly organizationId: string;
  readonly source: Source;
  readonly currency: string;
  readonly limit: string;
  readonly idempotencyKey: string;
  /** The latest day a refund can have been made (YYYY-MM-DD). */
  readonly latestDate: string;
}) {
  const [state, formAction, pending] = useActionState(recordManualRefundAction, NO_RESULT);
  const id = `manual-refund-${source.id}`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-list">
      <SourceFields
        organizationId={organizationId}
        source={source}
        currency={currency}
        idempotencyKey={idempotencyKey}
      />
      <AmountField
        id={id}
        state={state}
        label="Amount Refunded"
        currency={currency}
        limit={limit}
      />
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-reference`}>
          Refund Reference
        </label>
        <input
          id={`${id}-reference`}
          name="reference"
          type="text"
          required
          maxLength={120}
          className="input"
          aria-invalid={fieldProblem(state, 'reference', `${id}-error`)['aria-invalid']}
          aria-describedby={[
            `${id}-reference-hint`,
            fieldProblem(state, 'reference', `${id}-error`)['aria-describedby'],
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <p id={`${id}-reference-hint`} className="muted u-fs-085">
          The bank transfer id, or the refund reference shown in the payment gateway's panel.
        </p>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-day`}>
          Day Refunded
        </label>
        <input
          id={`${id}-day`}
          name="refundedOn"
          type="date"
          required
          max={latestDate}
          className="input"
          {...fieldProblem(state, 'refundedOn', `${id}-error`)}
        />
      </div>
      <ReasonField id={id} state={state} />
      <div>
        <SubmitButton
          pending={pending}
          idle="Record Refund"
          busy="Recording"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={`${id}-error`} result={state} />
      </div>
    </form>
  );
}

/** Counts held money towards an open invoice of the same agency. Needs a fresh sign-in check. */
export function ApplyCreditForm({
  organizationId,
  paymentAttemptId,
  targets,
}: {
  readonly organizationId: string;
  readonly paymentAttemptId: string;
  /** Open invoices in the same currency, the one due first first. */
  readonly targets: readonly { readonly id: string; readonly label: string }[];
}) {
  const [state, formAction, pending] = useActionState(applyCreditAction, NO_RESULT);
  const id = `credit-${paymentAttemptId}`;
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="paymentAttemptId" value={paymentAttemptId} />
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-target`}>
          Apply To
        </label>
        <select id={`${id}-target`} name="targetInvoiceId" className="input" defaultValue="">
          <option value="">The Open Invoice Due First</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Apply to Next Invoice"
          busy="Applying"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={`${id}-error`} result={state} />
      </div>
    </form>
  );
}

/** Asks the payment gateway about this agency's sent refunds now. */
export function CheckRefundsButton({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(checkRefundsAction, NO_RESULT);
  return (
    <form action={formAction} className="invoice-action">
      <input type="hidden" name="organizationId" value={organizationId} />
      <SubmitButton
        pending={pending}
        idle="Check Now"
        busy="Checking"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage
        result={state}
        pending={pending}
        pendingText="Asking the payment gateway about sent refunds."
      />
    </form>
  );
}

/** Sends again, with the same refund id, a refund whose sending could not be confirmed. */
export function RetryRefundButton({
  organizationId,
  refundRequestId,
}: {
  readonly organizationId: string;
  readonly refundRequestId: string;
}) {
  const [state, formAction, pending] = useActionState(retryRefundAction, NO_RESULT);
  return (
    <form action={formAction} className="invoice-action">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="refundRequestId" value={refundRequestId} />
      <SubmitButton
        pending={pending}
        idle="Send Again"
        busy="Sending"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

/** Cancels a refund that never reached the gateway, with a reason. */
export function CancelRefundForm({
  organizationId,
  refundRequestId,
}: {
  readonly organizationId: string;
  readonly refundRequestId: string;
}) {
  const [state, formAction, pending] = useActionState(cancelRefundAction, NO_RESULT);
  const id = `cancel-refund-${refundRequestId}`;
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="refundRequestId" value={refundRequestId} />
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-reason`}>
          Why Cancel
        </label>
        <input
          id={`${id}-reason`}
          name="reason"
          type="text"
          required
          maxLength={500}
          className="input"
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="muted u-fs-085">
          Only when the payment gateway's panel shows no such refund.
        </p>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Cancel Refund"
          busy="Cancelling"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={`${id}-error`} result={state} />
      </div>
    </form>
  );
}
