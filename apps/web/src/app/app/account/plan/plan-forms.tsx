'use client';

import { useActionState, useId } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../components/form-feedback';
import { buyPlanAction, payPurchaseAction } from './actions';

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

/** Opens the payment page for a confirmed purchase. Stays usable while the page loads. */
export function PayPurchaseForm({ invoiceId }: { readonly invoiceId: string }) {
  const [state, formAction, pending] = useActionState(payPurchaseAction, NO_RESULT);
  const messageId = useId();
  return (
    <form action={formAction} className="field-stack">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <SubmitButton
        pending={pending}
        idle="Pay with bKash, Nagad, Rocket or Card"
        busy="Opening the Payment Page…"
      />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
