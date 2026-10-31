'use client';

import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import { billingStatusLabel } from '../../../../../lib/labels';
import {
  type ActionState,
  activatePlanAction,
  approveClaimAction,
  cancelScheduledDowngradeAction,
  createInvoiceAction,
  endSubscriptionAction,
  grantOverrideAction,
  openBillingAccountAction,
  recordInvoicePaymentAction,
  rejectClaimAction,
  revokeOverrideAction,
  scheduleDowngradeAction,
  transitionBillingStatusAction,
  voidInvoiceAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** A hint id, joined with the form message's id while the problem is about this field. */
function describedBy(
  hintId: string,
  problem: { 'aria-invalid'?: true; 'aria-describedby'?: string },
): { 'aria-describedby': string; 'aria-invalid'?: true } {
  return {
    'aria-describedby': [hintId, problem['aria-describedby']].filter(Boolean).join(' '),
    ...(problem['aria-invalid'] ? { 'aria-invalid': true as const } : {}),
  };
}

function StatusMessage({ state }: { readonly state: ActionState }) {
  return <FormMessage result={state} />;
}

/** A one-click destructive/administrative action, gated by a mandatory reason typed into a browser prompt -- the same pattern `RevokeRoleButton`/`RevokeInvitationButton` already use. */
function ReasonPromptButton({
  action,
  hiddenFields,
  promptText,
  confirmedLabel,
  pendingLabel,
  tone = 'btn-secondary',
}: {
  readonly action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  readonly hiddenFields: Readonly<Record<string, string>>;
  readonly promptText: string;
  readonly confirmedLabel: string;
  readonly pendingLabel: string;
  readonly tone?: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form
      action={formAction}
      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
      onSubmit={(e) => {
        const form = e.currentTarget;
        const reason = window.prompt(promptText);
        if (!reason || reason.trim().length === 0) {
          e.preventDefault();
          return;
        }
        (form.elements.namedItem('reason') as HTMLInputElement).value = reason.trim();
      }}
    >
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="reason" value="" />
      <SubmitButton
        pending={pending}
        idle={confirmedLabel}
        busy={pendingLabel}
        className={`btn ${tone}`}
        style={{ padding: '0.3rem 0.85rem', fontSize: 'var(--text-small)' }}
      />
      <StatusMessage state={state} />
    </form>
  );
}

interface PlanOption {
  readonly id: string;
  readonly name: string;
}

/** Manually activate a plan for this organization, immediately ending whatever is currently active. */
export function ActivatePlanForm({
  organizationId,
  plans,
}: {
  readonly organizationId: string;
  readonly plans: readonly PlanOption[];
}) {
  const [state, formAction, pending] = useActionState(activatePlanAction, INITIAL);
  return (
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="activate-planId">
            Plan
          </label>
          {plans.length === 0 ? (
            <p className="muted u-fs-085">No active plans in the catalog yet.</p>
          ) : (
            <select id="activate-planId" name="planId" required className="input" defaultValue="">
              <option value="" disabled>
                Choose a plan…
              </option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="activate-reason">
            Reason
          </label>
          <input
            id="activate-reason"
            name="reason"
            type="text"
            required
            className="input"
            placeholder="Why this plan is being assigned"
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Activate Plan"
          busy="Activating…"
          className="btn btn-primary"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

export function EndSubscriptionButton({ organizationId }: { readonly organizationId: string }) {
  return (
    <ReasonPromptButton
      action={endSubscriptionAction}
      hiddenFields={{ organizationId }}
      promptText="Reason for ending this subscription?"
      confirmedLabel="End Subscription"
      pendingLabel="Ending…"
      tone="btn-danger"
    />
  );
}

/** Schedule a future, warned downgrade -- refused by the service unless the target plan is a downgrade on every dimension from the org's current plan. */
export function ScheduleDowngradeForm({
  organizationId,
  plans,
}: {
  readonly organizationId: string;
  readonly plans: readonly PlanOption[];
}) {
  const [state, formAction, pending] = useActionState(scheduleDowngradeAction, INITIAL);
  return (
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="downgrade-toPlanId">
            Target Plan
          </label>
          {plans.length === 0 ? (
            <p className="muted u-fs-085">No active plans in the catalog yet.</p>
          ) : (
            <select
              id="downgrade-toPlanId"
              name="toPlanId"
              required
              className="input"
              defaultValue=""
            >
              <option value="" disabled>
                Choose a plan…
              </option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="downgrade-effectiveAt">
            Effective Date (Optional -- Defaults to 14 Days Out)
          </label>
          <input id="downgrade-effectiveAt" name="effectiveAt" type="date" className="input" />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="downgrade-reason">
            Reason
          </label>
          <input
            id="downgrade-reason"
            name="reason"
            type="text"
            required
            className="input"
            placeholder="Why this downgrade is being scheduled"
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Schedule Downgrade"
          busy="Scheduling…"
          className="btn btn-primary"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

export function CancelDowngradeButton({
  organizationId,
  downgradeId,
}: {
  readonly organizationId: string;
  readonly downgradeId: string;
}) {
  return (
    <ReasonPromptButton
      action={cancelScheduledDowngradeAction}
      hiddenFields={{ organizationId, downgradeId }}
      promptText="Reason for cancelling this scheduled downgrade?"
      confirmedLabel="Cancel Downgrade"
      pendingLabel="Cancelling…"
    />
  );
}

export function OpenBillingAccountForm({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(openBillingAccountAction, INITIAL);
  return (
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="open-initialStatus">
            Starting Status
          </label>
          <select
            id="open-initialStatus"
            name="initialStatus"
            className="input"
            defaultValue="TRIAL"
          >
            <option value="TRIAL">Trial</option>
            <option value="ACTIVE">Active (Terms Already Agreed)</option>
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="open-reason">
            Reason
          </label>
          <input
            id="open-reason"
            name="reason"
            type="text"
            required
            className="input"
            placeholder="Why this billing account is being opened"
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Open Billing Account"
          busy="Opening…"
          className="btn btn-primary"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

export function TransitionBillingStatusForm({
  organizationId,
  legalStatuses,
}: {
  readonly organizationId: string;
  readonly legalStatuses: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(transitionBillingStatusAction, INITIAL);
  if (legalStatuses.length === 0) return null;
  return (
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="transition-toStatus">
            New Status
          </label>
          <select
            id="transition-toStatus"
            name="toStatus"
            required
            className="input"
            defaultValue=""
          >
            <option value="" disabled>
              Choose a status…
            </option>
            {legalStatuses.map((s) => (
              <option key={s} value={s}>
                {billingStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="transition-reason">
            Reason
          </label>
          <input
            id="transition-reason"
            name="reason"
            type="text"
            required
            className="input"
            placeholder="Why this status is changing"
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Change Status"
          busy="Changing…"
          className="btn btn-primary"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

export function CreateInvoiceForm({
  organizationId,
  plans,
}: {
  readonly organizationId: string;
  readonly plans: readonly PlanOption[];
}) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <fieldset className="form-section">
        <legend>What Is Billed</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="invoice-planId">
              Plan Billed
            </label>
            {plans.length === 0 ? (
              <p className="muted u-fs-085">No active plans in the catalog yet.</p>
            ) : (
              <select id="invoice-planId" name="planId" required className="input" defaultValue="">
                <option value="" disabled>
                  Choose a plan…
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="invoice-ref">
              Invoice Reference
            </label>
            <input
              id="invoice-ref"
              name="invoiceRef"
              type="text"
              required
              className="input"
              placeholder="e.g. INV-2026-014"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="invoice-currency">
              Currency
            </label>
            <input
              id="invoice-currency"
              name="currency"
              type="text"
              required
              minLength={3}
              maxLength={3}
              autoCapitalize="characters"
              className="input"
              placeholder="BDT"
              {...describedBy('invoice-currency-hint', fieldProblem(state, 'currency', messageId))}
            />
            <p className="field-hint" id="invoice-currency-hint">
              The three-letter currency code, for example BDT.
            </p>
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="invoice-amount">
              Invoiced Amount
            </label>
            <input
              id="invoice-amount"
              name="invoicedAmount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              className="input"
              placeholder="2,500.00"
              {...describedBy(
                'invoice-amount-hint',
                fieldProblem(state, 'invoicedAmount', messageId),
              )}
            />
            <p className="field-hint" id="invoice-amount-hint">
              In the currency above, for example 2500.00 or 2,500.00.
            </p>
          </div>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Dates</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="invoice-periodStart">
              Period Start
            </label>
            <input
              id="invoice-periodStart"
              name="periodStart"
              type="date"
              required
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="invoice-periodLastDay">
              Last Day of the Period
            </label>
            <input
              id="invoice-periodLastDay"
              name="periodLastDay"
              type="date"
              required
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="invoice-dueDate">
              Due Date
            </label>
            <input id="invoice-dueDate" name="dueDate" type="date" required className="input" />
          </div>
        </div>
      </fieldset>
      <div>
        <SubmitButton
          pending={pending}
          idle="Create Invoice"
          busy="Creating…"
          className="btn btn-primary"
        />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

export function RecordPaymentForm({
  organizationId,
  invoiceId,
  currency,
  idempotencyKey,
}: {
  readonly organizationId: string;
  readonly invoiceId: string;
  /** The invoice's currency. The person types the currency they received; it must match. */
  readonly currency: string;
  /** Made on the server each time the page is drawn, one per intended payment: sending this form twice (a double click, a repeated send) records the money once. A fresh page brings a fresh key. */
  readonly idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(recordInvoicePaymentAction, INITIAL);
  const confirmCurrency = /^[A-Za-z]{3}$/.test(currency.trim());
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useFocusInvalidField(formRef, state);
  return (
    <form
      ref={formRef}
      action={formAction}
      className="field-list form-compact"
      style={{ marginTop: '0.5rem' }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor={`payment-amount-${invoiceId}`}>
            Payment Amount
          </label>
          <input
            id={`payment-amount-${invoiceId}`}
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
            className="input"
            placeholder="2,500.00"
            {...describedBy(
              `payment-amount-hint-${invoiceId}`,
              fieldProblem(state, 'amount', messageId),
            )}
          />
          <p className="field-hint" id={`payment-amount-hint-${invoiceId}`}>
            In {currency.trim().toUpperCase() || 'the invoice currency'}, for example 2500.00 or
            2,500.00.
          </p>
        </div>
        {confirmCurrency ? (
          <div className="field-row">
            <label className="field-label" htmlFor={`payment-currency-${invoiceId}`}>
              Currency Received
            </label>
            <input
              id={`payment-currency-${invoiceId}`}
              name="currency"
              type="text"
              required
              minLength={3}
              maxLength={3}
              autoCapitalize="characters"
              placeholder={`e.g. ${currency.trim().toUpperCase()}`}
              className="input"
              {...fieldProblem(state, 'currency', messageId)}
            />
          </div>
        ) : null}
        <div className="field-row">
          <label className="field-label" htmlFor={`payment-date-${invoiceId}`}>
            Collected Date
          </label>
          <input
            id={`payment-date-${invoiceId}`}
            name="collectedDate"
            type="date"
            required
            className="input"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`payment-ref-${invoiceId}`}>
            Payment Reference
          </label>
          <input
            id={`payment-ref-${invoiceId}`}
            name="paymentReference"
            type="text"
            required
            className="input"
            placeholder="e.g. bank transfer id"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`payment-reason-${invoiceId}`}>
            Reason
          </label>
          <input
            id={`payment-reason-${invoiceId}`}
            name="reason"
            type="text"
            required
            className="input"
            placeholder="How this payment was confirmed"
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Record Payment"
          busy="Recording…"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

export function VoidInvoiceButton({
  organizationId,
  invoiceId,
}: {
  readonly organizationId: string;
  readonly invoiceId: string;
}) {
  return (
    <ReasonPromptButton
      action={voidInvoiceAction}
      hiddenFields={{ organizationId, invoiceId }}
      promptText="Why are you cancelling this invoice? Nothing will be owed on it."
      confirmedLabel="Cancel Invoice"
      pendingLabel="Cancelling…"
      tone="btn-danger"
    />
  );
}

export function GrantOverrideForm({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(grantOverrideAction, INITIAL);
  return (
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="override-durationDays">
            Duration (Days, Max 30)
          </label>
          <input
            id="override-durationDays"
            name="durationDays"
            type="number"
            min="1"
            max="30"
            required
            className="input"
            placeholder="e.g. 7"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="override-reason">
            Reason
          </label>
          <input
            id="override-reason"
            name="reason"
            type="text"
            required
            className="input"
            placeholder="Why this bypass is being granted"
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Grant Override"
          busy="Granting…"
          className="btn btn-primary"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

export function RevokeOverrideButton({
  organizationId,
  overrideId,
}: {
  readonly organizationId: string;
  readonly overrideId: string;
}) {
  return (
    <ReasonPromptButton
      action={revokeOverrideAction}
      hiddenFields={{ organizationId, overrideId }}
      promptText="Reason for revoking this override?"
      confirmedLabel="Revoke"
      pendingLabel="Revoking…"
    />
  );
}

/** Confirms a payment the agency reported (S12): records it once in the ledger and issues the receipt. Needs a fresh sign-in check. */
export function ApproveClaimButton({
  organizationId,
  claimId,
}: {
  readonly organizationId: string;
  readonly claimId: string;
}) {
  const [state, formAction, pending] = useActionState(approveClaimAction, INITIAL);
  return (
    <form
      action={formAction}
      className="invoice-action"
      onSubmit={(event) => {
        // Recording money cannot be undone from here, so a slip of the finger is caught first.
        if (
          !window.confirm(
            'Confirm this payment? It is recorded against the invoice and a receipt is issued.',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="claimId" value={claimId} />
      <SubmitButton pending={pending} idle="Confirm Payment" busy="Confirming" />
      <StatusMessage state={state} />
    </form>
  );
}

/** Rejects a reported payment with a reason the agency will read. Records no money. */
export function RejectClaimButton({
  organizationId,
  claimId,
}: {
  readonly organizationId: string;
  readonly claimId: string;
}) {
  return (
    <ReasonPromptButton
      action={rejectClaimAction}
      hiddenFields={{ organizationId, claimId }}
      promptText="Reason for not accepting this payment report? The agency will read it."
      confirmedLabel="Reject Report"
      pendingLabel="Rejecting…"
    />
  );
}
