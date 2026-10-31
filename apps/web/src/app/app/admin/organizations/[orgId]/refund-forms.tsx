'use client';

import { useActionState, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import {
  applyCreditAction,
  cancelRefundAction,
  checkRefundsAction,
  confirmUnsentRefundAction,
  recordManualRefundAction,
  requestRefundAction,
  retryRefundAction,
} from './refund-actions';
import { useRefundReport } from './refund-feedback';
import { REFUND_NO_REPLY, type RefundFormState } from './refund-state';

/**
 * The refund and credit forms of the admin organization page (Small Commercial V1 S18). Each one
 * names the payment it acts on, keeps what was typed when the server answers with a problem (the
 * fields are drawn again from the reply), points at the field at fault, and reports to the card
 * (`RefundFeedback`), so its result is still read out when the row it sat in is gone. Nothing here
 * runs service code: amounts are checked on the server, where the limits are known for certain.
 * Each form makes its own idempotency key when it is first drawn, and takes a fresh one from every
 * reply.
 */

type Action = (prev: RefundFormState, formData: FormData) => Promise<RefundFormState>;

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

/** `useActionState` with the reply also reported to the card. */
function useRefundAction(action: Action) {
  const report = useRefundReport();
  return useActionState<RefundFormState, FormData>(async (prev, formData) => {
    const reply = await action(prev, formData);
    report(reply);
    return reply;
  }, REFUND_NO_REPLY);
}

/**
 * A failure about the form stays with the form; a success, and anything about a refund line (a
 * refund written but not confirmed), is said once, by the card.
 */
function failureOnly(state: RefundFormState): RefundFormState {
  return state.ok || state.focusId !== undefined ? { ...state, message: '' } : state;
}

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined.length > 0 ? joined : undefined;
}

/** One typed value from a reply (a variable key, so it satisfies both the compiler and the linter). */
function typedValue(values: Readonly<Record<string, string>> | undefined, name: string): string {
  return values?.[name] ?? '';
}

type Source = { readonly kind: 'entry' | 'held'; readonly id: string };

function SourceFields({
  organizationId,
  source,
  idempotencyKey,
}: {
  readonly organizationId: string;
  readonly source: Source;
  readonly idempotencyKey: string;
}) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="sourceKind" value={source.kind} />
      <input type="hidden" name="sourceId" value={source.id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    </>
  );
}

function TextField({
  id,
  name,
  label,
  state,
  errorId,
  hint,
  type = 'text',
  inputMode,
  maxLength,
  min,
  max,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly state: RefundFormState;
  readonly errorId: string;
  readonly hint?: string;
  readonly type?: 'text' | 'date';
  readonly inputMode?: 'decimal';
  readonly maxLength?: number;
  readonly min?: string;
  readonly max?: string;
}) {
  const problem = fieldProblem(state, name, errorId);
  const hintId = hint ? `${id}-hint` : undefined;
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
        defaultValue={typedValue(state.values, name)}
        aria-invalid={problem['aria-invalid']}
        aria-describedby={describedBy(hintId, problem['aria-describedby'])}
        {...(inputMode ? { inputMode } : {})}
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

/** Asks the payment gateway to refund part or all of one payment. Needs a fresh sign-in check. */
export function RefundForm({
  organizationId,
  source,
  currency,
  limitText,
}: {
  readonly organizationId: string;
  readonly source: Source;
  readonly currency: string;
  /** The most that can be given back, as the page shows amounts ("BDT 1,500.00"). */
  readonly limitText: string;
}) {
  const [state, formAction, pending] = useRefundAction(requestRefundAction);
  const [firstKey] = useState(newKey);
  const id = `refund-${source.id}`;
  const errorId = `${id}-error`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-list form-narrow">
      <SourceFields
        organizationId={organizationId}
        source={source}
        idempotencyKey={state.nextKey ?? firstKey}
      />
      <div key={state.nextKey ?? firstKey} className="form-grid">
        <TextField
          id={`${id}-amount`}
          name="amount"
          label={`Amount to Refund (${currency})`}
          inputMode="decimal"
          hint={`Up to ${limitText}.`}
          state={state}
          errorId={errorId}
        />
        <TextField
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
          idle="Send Refund"
          busy="Sending"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={errorId} result={failureOnly(state)} />
      </div>
    </form>
  );
}

/** Records a refund already made outside VisaStack, with its reference and day. Needs a fresh sign-in check. */
export function ManualRefundForm({
  organizationId,
  source,
  currency,
  limitText,
  earliestDate,
  latestDate,
}: {
  readonly organizationId: string;
  readonly source: Source;
  readonly currency: string;
  readonly limitText: string;
  /** The day the money came in (YYYY-MM-DD): a refund cannot be earlier. */
  readonly earliestDate: string;
  /** Today in Bangladesh (YYYY-MM-DD): a refund cannot be later. */
  readonly latestDate: string;
}) {
  const [state, formAction, pending] = useRefundAction(recordManualRefundAction);
  const [firstKey] = useState(newKey);
  const id = `manual-refund-${source.id}`;
  const errorId = `${id}-error`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-list form-narrow">
      <SourceFields
        organizationId={organizationId}
        source={source}
        idempotencyKey={state.nextKey ?? firstKey}
      />
      <div key={state.nextKey ?? firstKey} className="form-grid">
        <TextField
          id={`${id}-amount`}
          name="amount"
          label={`Amount Refunded (${currency})`}
          inputMode="decimal"
          hint={`Up to ${limitText}.`}
          state={state}
          errorId={errorId}
        />
        <TextField
          id={`${id}-reference`}
          name="reference"
          label="Refund Reference"
          maxLength={120}
          hint="The bank transfer id, or the refund reference shown in the payment gateway's merchant panel."
          state={state}
          errorId={errorId}
        />
        <TextField
          id={`${id}-day`}
          name="refundedOn"
          label="Day Refunded"
          type="date"
          min={earliestDate}
          max={latestDate}
          state={state}
          errorId={errorId}
        />
        <TextField
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
  const [state, formAction, pending] = useRefundAction(applyCreditAction);
  const id = `credit-${paymentAttemptId}`;
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="paymentAttemptId" value={paymentAttemptId} />
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-target`}>
          Apply To
        </label>
        <select
          key={state.nextKey ?? 'first'}
          id={`${id}-target`}
          name="targetInvoiceId"
          className="input"
          defaultValue={typedValue(state.values, 'targetInvoiceId')}
        >
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
        <FormMessage id={`${id}-error`} result={failureOnly(state)} />
      </div>
    </form>
  );
}

/** Asks the payment gateway about this agency's sent refunds now. */
export function CheckRefundsButton({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useRefundAction(checkRefundsAction);
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
        result={failureOnly(state)}
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
  const [state, formAction, pending] = useRefundAction(retryRefundAction);
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
      <FormMessage result={failureOnly(state)} />
    </form>
  );
}

/** "It Went Through": a refund found made in the merchant panel, recorded with its reference and day. */
export function ConfirmUnsentRefundForm({
  organizationId,
  refundRequestId,
  currency,
  earliestDate,
  latestDate,
}: {
  readonly organizationId: string;
  readonly refundRequestId: string;
  readonly currency: string;
  /** The day the refund was asked for (YYYY-MM-DD). */
  readonly earliestDate: string;
  readonly latestDate: string;
}) {
  const [state, formAction, pending] = useRefundAction(confirmUnsentRefundAction);
  const id = `went-through-${refundRequestId}`;
  const errorId = `${id}-error`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="refundRequestId" value={refundRequestId} />
      <div key={state.nextKey ?? 'first'} className="form-grid">
        <TextField
          id={`${id}-amount`}
          name="amount"
          label={`Amount in the Panel (${currency})`}
          inputMode="decimal"
          hint="Type the amount exactly as the merchant panel shows it. It must match this refund."
          state={state}
          errorId={errorId}
        />
        <TextField
          id={`${id}-reference`}
          name="reference"
          label="Refund Reference in the Panel"
          maxLength={120}
          state={state}
          errorId={errorId}
        />
        <TextField
          id={`${id}-day`}
          name="refundedOn"
          label="Day Refunded"
          type="date"
          min={earliestDate}
          max={latestDate}
          state={state}
          errorId={errorId}
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Record as Refunded"
          busy="Recording"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={errorId} result={failureOnly(state)} />
      </div>
    </form>
  );
}

/** "It Did Not Go Through": cancels a refund the merchant panel does not show, with a reason. */
export function CancelRefundForm({
  organizationId,
  refundRequestId,
}: {
  readonly organizationId: string;
  readonly refundRequestId: string;
}) {
  const [state, formAction, pending] = useRefundAction(cancelRefundAction);
  const id = `cancel-refund-${refundRequestId}`;
  const errorId = `${id}-error`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="refundRequestId" value={refundRequestId} />
      <div key={state.nextKey ?? 'first'} className="form-grid">
        <TextField
          id={`${id}-reason`}
          name="reason"
          label="Why It Did Not Go Through"
          maxLength={500}
          hint="Only when the payment gateway's merchant panel shows no such refund."
          state={state}
          errorId={errorId}
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Cancel Refund"
          busy="Cancelling"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={errorId} result={failureOnly(state)} />
      </div>
    </form>
  );
}
