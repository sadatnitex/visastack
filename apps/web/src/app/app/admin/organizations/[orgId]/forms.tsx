'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import {
  type ActionState,
  activatePlanAction,
  cancelScheduledDowngradeAction,
  createInvoiceAction,
  endSubscriptionAction,
  grantOverrideAction,
  openBillingAccountAction,
  recordInvoicePaymentAction,
  revokeOverrideAction,
  scheduleDowngradeAction,
  transitionBillingStatusAction,
  voidInvoiceAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

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
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
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
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
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
      <div>
        <SubmitButton
          pending={pending}
          idle="Activate plan"
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
      confirmedLabel="End subscription"
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
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="downgrade-toPlanId">
          Target plan
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
          Effective date (optional -- defaults to 14 days out)
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
      <div>
        <SubmitButton
          pending={pending}
          idle="Schedule downgrade"
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
      confirmedLabel="Cancel downgrade"
      pendingLabel="Cancelling…"
    />
  );
}

export function OpenBillingAccountForm({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(openBillingAccountAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="open-initialStatus">
          Starting status
        </label>
        <select id="open-initialStatus" name="initialStatus" className="input" defaultValue="TRIAL">
          <option value="TRIAL">Trial</option>
          <option value="ACTIVE">Active (terms already agreed)</option>
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
      <div>
        <SubmitButton
          pending={pending}
          idle="Open billing account"
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
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="transition-toStatus">
          New status
        </label>
        <select id="transition-toStatus" name="toStatus" required className="input" defaultValue="">
          <option value="" disabled>
            Choose a status…
          </option>
          {legalStatuses.map((s) => (
            <option key={s} value={s}>
              {s}
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
      <div>
        <SubmitButton
          pending={pending}
          idle="Change status"
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
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="invoice-planId">
          Plan billed
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
          Invoice reference
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
        <label className="field-label" htmlFor="invoice-amount">
          Invoiced amount (minor units, e.g. cents)
        </label>
        <input
          id="invoice-amount"
          name="invoicedAmountMinorUnits"
          type="number"
          min="1"
          required
          className="input"
          placeholder="e.g. 150000 for $1,500.00"
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
          maxLength={3}
          className="input"
          placeholder="USD"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="invoice-periodStart">
          Period start
        </label>
        <input id="invoice-periodStart" name="periodStart" type="date" required className="input" />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="invoice-periodEnd">
          Period end
        </label>
        <input id="invoice-periodEnd" name="periodEnd" type="date" required className="input" />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="invoice-dueDate">
          Due date
        </label>
        <input id="invoice-dueDate" name="dueDate" type="date" required className="input" />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Create invoice"
          busy="Creating…"
          className="btn btn-primary"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

export function RecordPaymentForm({
  organizationId,
  invoiceId,
}: {
  readonly organizationId: string;
  readonly invoiceId: string;
}) {
  const [state, formAction, pending] = useActionState(recordInvoicePaymentAction, INITIAL);
  return (
    <form
      action={formAction}
      className="field-list"
      style={{ maxWidth: '22rem', marginTop: '0.5rem' }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="field-row">
        <label className="field-label" htmlFor={`payment-amount-${invoiceId}`}>
          Payment amount (minor units)
        </label>
        <input
          id={`payment-amount-${invoiceId}`}
          name="amountMinorUnits"
          type="number"
          min="1"
          required
          className="input"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`payment-date-${invoiceId}`}>
          Collected date
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
          Payment reference
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
      <div>
        <SubmitButton
          pending={pending}
          idle="Record payment"
          busy="Recording…"
          className="btn btn-secondary u-btn-sm"
        />
        <StatusMessage state={state} />
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
      promptText="Reason for voiding this invoice?"
      confirmedLabel="Void"
      pendingLabel="Voiding…"
      tone="btn-danger"
    />
  );
}

export function GrantOverrideForm({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(grantOverrideAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="override-durationDays">
          Duration (days, max 30)
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
      <div>
        <SubmitButton
          pending={pending}
          idle="Grant override"
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
