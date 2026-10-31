'use client';

import { useActionState, useId } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../components/form-feedback';
import { type PayPurchaseState, buyPlanAction, payPurchaseAction } from './actions';

const NO_PAY_RESULT: PayPurchaseState = NO_RESULT;

/** "Get {plan}": starts the purchase; nothing is charged until the person pays on the next step. */
export function BuyPlanForm({
  planId,
  planName,
}: { readonly planId: string; readonly planName: string }) {
  const [state, formAction, pending] = useActionState(buyPlanAction, NO_RESULT);
  const messageId = useId();
  return (
    <form action={formAction} className="field-stack">
      <input type="hidden" name="planId" value={planId} />
      <SubmitButton pending={pending} idle={`Get ${planName}`} busy="Getting It Ready…" />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

/**
 * Opens the payment page for a confirmed purchase. After a payment started minutes ago it offers
 * Start Another Payment, for a page that did not open or was closed (ADR 0025 section 12.3).
 */
export function PayPurchaseForm({ invoiceId }: { readonly invoiceId: string }) {
  const [state, formAction, pending] = useActionState(payPurchaseAction, NO_PAY_RESULT);
  const messageId = useId();
  return (
    <form action={formAction} className="field-stack">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="page-actions">
        <SubmitButton
          pending={pending}
          idle="Pay with bKash, Nagad, Rocket or Card"
          busy="Opening the Payment Page…"
        />
        {state.recent ? (
          <SubmitButton
            pending={pending}
            idle="Start Another Payment"
            busy="Opening the Payment Page…"
            className="btn btn-secondary"
            name="startAnother"
            value="yes"
          />
        ) : null}
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
