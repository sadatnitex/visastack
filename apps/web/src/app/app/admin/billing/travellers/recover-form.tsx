'use client';

import { useActionState, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import { recoverTravellerPaymentAction } from './recover-action';
import { RECOVER_NO_REPLY, type RecoverFormState } from './recover-state';

/**
 * Recover a Payment (owner decision, 2 Nov 2026): a traveller's purchase lost in a restore from
 * backup, recovered from the payment gateway's own record. The owner types the traveller's full
 * code from the restore report, chooses the plan and gives the gateway's transaction id; the
 * amount is never typed, the gateway's record says it. Before anything is sent it asks the owner
 * to confirm. Needs a fresh sign-in check.
 */

const ID = 'recover-payment';

function typedValue(values: Readonly<Record<string, string>> | undefined, name: string): string {
  return values?.[name] ?? '';
}

export function RecoverPaymentForm({
  plans,
}: {
  readonly plans: readonly { readonly key: string; readonly name: string }[];
}) {
  const [state, formAction, pending] = useActionState<RecoverFormState, FormData>(
    recoverTravellerPaymentAction,
    RECOVER_NO_REPLY,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  const messageId = `${ID}-message`;
  const field = (name: string, hintId?: string) =>
    hintId ? fieldProblem(state, name, messageId, hintId) : fieldProblem(state, name, messageId);
  return (
    <form
      ref={formRef}
      action={formAction}
      className="field-list form-narrow"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Recover this payment? First check in the merchant panel that it is this traveller's payment. VisaStack then asks the payment gateway what was paid and records exactly that, with a receipt.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <div key={state.ok && state.message ? state.message : 'form'} className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor={`${ID}-code`}>
            Traveller Code
          </label>
          <input
            id={`${ID}-code`}
            name="code"
            type="text"
            required
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            className="input"
            defaultValue={typedValue(state.values, 'code')}
            {...field('code', `${ID}-code-hint`)}
          />
          <p id={`${ID}-code-hint`} className="muted u-fs-085">
            The traveller's account id from the restore report, with or without dashes.
          </p>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${ID}-plan`}>
            Plan They Paid For
          </label>
          <select
            id={`${ID}-plan`}
            name="planKey"
            required
            className="input"
            defaultValue={typedValue(state.values, 'planKey')}
            {...field('planKey')}
          >
            <option value="">Choose a Plan</option>
            {plans.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {`${plan.name} (${plan.key})`}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${ID}-transaction`}>
            Transaction Id
          </label>
          <input
            id={`${ID}-transaction`}
            name="transactionId"
            type="text"
            required
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            className="input"
            defaultValue={typedValue(state.values, 'transactionId')}
            {...field('transactionId', `${ID}-transaction-hint`)}
          />
          <p id={`${ID}-transaction-hint`} className="muted u-fs-085">
            From the payment gateway's merchant records. It starts with VSP.
          </p>
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Recover Payment"
          busy="Recovering"
          className="btn btn-secondary u-btn-sm"
        />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}
