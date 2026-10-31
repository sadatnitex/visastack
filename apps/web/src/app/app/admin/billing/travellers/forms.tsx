'use client';

import { useActionState, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import { useRefundReport } from '../../organizations/[orgId]/refund-feedback';
import { REFUND_NO_REPLY, type RefundFormState } from '../../organizations/[orgId]/refund-state';
import { recordTravellerRefundAction } from './actions';

/**
 * The Record Refund form of Traveller Billing (ADR 0025 D8, T6b). A traveller's refund is always
 * all that is left of one payment, so nothing about the amount is typed: the form shows the exact
 * amount and carries it, hidden, with the payment's id and its own idempotency key (made when the
 * form is first drawn, and fresh from every reply). Before anything is sent it asks the owner to
 * confirm, naming the amount and the purchase reference, and saying when the payment is past the
 * 7 days the traveller was promised. Its result is also reported to the page (`RefundFeedback`),
 * so it is still read out when the row it sat in is gone.
 */

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined.length > 0 ? joined : undefined;
}

/** One typed value from a reply (a variable key, so it satisfies both the compiler and the linter). */
function typedValue(values: Readonly<Record<string, string>> | undefined, name: string): string {
  return values?.[name] ?? '';
}

/** A success is said once, by the page; a failure stays with the form. */
function failureOnly(state: RefundFormState): RefundFormState {
  return state.ok ? { ...state, message: '' } : state;
}

/** What the owner is asked before the refund is recorded. */
function refundConfirmText({
  amountText,
  invoiceRef,
  outsideWindow,
  testPayment,
}: {
  readonly amountText: string;
  readonly invoiceRef: string;
  readonly outsideWindow: boolean;
  readonly testPayment: boolean;
}): string {
  return [
    `Record a refund of ${amountText} for ${invoiceRef}?`,
    testPayment ? 'This is a test payment.' : null,
    outsideWindow
      ? 'This payment is more than 7 days old. Record the refund only if it was made in the gateway panel.'
      : null,
    'This cannot be undone.',
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

function Field({
  id,
  name,
  label,
  state,
  errorId,
  hint,
  type = 'text',
  maxLength,
  min,
  max,
  initial = '',
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly state: RefundFormState;
  readonly errorId: string;
  readonly hint?: string;
  readonly type?: 'text' | 'date';
  readonly maxLength?: number;
  readonly min?: string;
  readonly max?: string;
  /** Shown until the owner types something else. */
  readonly initial?: string;
}) {
  const problem = fieldProblem(state, name, errorId);
  const hintId = hint ? `${id}-hint` : undefined;
  const typed = typedValue(state.values, name);
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required
        className="input"
        defaultValue={typed.length > 0 ? typed : initial}
        aria-invalid={problem['aria-invalid']}
        aria-describedby={describedBy(hintId, problem['aria-describedby'])}
        {...(maxLength ? { maxLength } : {})}
        {...(min ? { min } : {})}
        {...(max ? { max } : {})}
      />
      {hint ? (
        <p id={hintId} className="muted u-fs-085">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Records a traveller's refund made in the gateway panel. Needs a fresh sign-in check. */
export function TravellerRefundForm({
  formId,
  source,
  invoiceRef,
  amountMinorUnits,
  amountText,
  earliestDate,
  latestDate,
  outsideWindow,
  testPayment,
}: {
  /** A page-unique id for this form's fields, never the payment's own id (the page never shows it). */
  readonly formId: string;
  readonly source: { readonly kind: 'entry' | 'held'; readonly id: string };
  readonly invoiceRef: string;
  /** All that is left of the payment: exactly what will be recorded. */
  readonly amountMinorUnits: number;
  /** The same amount as the page shows it ("BDT 1,500.00"). */
  readonly amountText: string;
  /** The day the money came in (YYYY-MM-DD): a refund cannot be earlier. */
  readonly earliestDate: string;
  /** Today in Bangladesh (YYYY-MM-DD): a refund cannot be later, and the day it starts on. */
  readonly latestDate: string;
  /** The payment is past the 7 days the traveller was promised. */
  readonly outsideWindow: boolean;
  readonly testPayment: boolean;
}) {
  const report = useRefundReport();
  const [state, formAction, pending] = useActionState<RefundFormState, FormData>(
    async (prev, formData) => {
      const answer = await recordTravellerRefundAction(prev, formData);
      report(answer);
      return answer;
    },
    REFUND_NO_REPLY,
  );
  const [firstKey] = useState(newKey);
  const key = state.nextKey ?? firstKey;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  const id = formId;
  const errorId = `${id}-error`;
  const amountId = `${id}-amount`;
  return (
    <form
      ref={formRef}
      action={formAction}
      className="field-list form-narrow"
      aria-describedby={amountId}
      onSubmit={(event) => {
        // A refund recorded here cannot be taken back, so a slip of the finger is caught first.
        if (
          !window.confirm(refundConfirmText({ amountText, invoiceRef, outsideWindow, testPayment }))
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="sourceKind" value={source.kind} />
      <input type="hidden" name="sourceId" value={source.id} />
      <input type="hidden" name="expectedAmountMinorUnits" value={String(amountMinorUnits)} />
      <input type="hidden" name="invoiceRef" value={invoiceRef} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <p id={amountId} className="card-body">
        This records a refund of {amountText}, all that is left of this payment.
        {outsideWindow
          ? ' This payment is more than 7 days old. Record the refund only if it was made in the gateway panel.'
          : ''}
      </p>
      <div key={key} className="form-grid">
        <Field
          id={`${id}-reference`}
          name="reference"
          label="Refund Reference"
          maxLength={120}
          hint="The refund reference shown in the payment gateway's merchant panel."
          state={state}
          errorId={errorId}
        />
        <Field
          id={`${id}-day`}
          name="refundedOn"
          label="Refunded On"
          type="date"
          min={earliestDate}
          max={latestDate}
          initial={latestDate}
          state={state}
          errorId={errorId}
        />
        <Field
          id={`${id}-reason`}
          name="reason"
          label="Reason"
          maxLength={500}
          state={state}
          errorId={errorId}
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Record Refund"
          busy="Recording"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={errorId} result={failureOnly(state)} />
      </div>
    </form>
  );
}
