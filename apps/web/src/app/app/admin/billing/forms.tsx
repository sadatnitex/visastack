'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { saveBillingRulesAction } from './actions';

export interface BillingRulesFormProps {
  readonly dueDays: number;
  readonly overdueHandlingEnabled: boolean;
  readonly graceAfterDays: number | null;
  readonly suspendAfterDays: number | null;
}

/**
 * The billing rules: when an invoice falls due, and whether an unpaid one moves the agency to
 * Grace and then Suspended. Turning that on asks for a confirmation box after the server has said
 * how many agencies it moves today.
 */
export function BillingRulesForm({
  dueDays,
  overdueHandlingEnabled,
  graceAfterDays,
  suspendAfterDays,
}: BillingRulesFormProps) {
  const [state, formAction, pending] = useActionState(saveBillingRulesAction, NO_RESULT);
  const [on, setOn] = useState(overdueHandlingEnabled);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-message`;
  const switchingOn = on && !overdueHandlingEnabled;

  return (
    <form ref={form} action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-due`}>
          Payment Due After (Days)
        </label>
        <input
          id={`${id}-due`}
          name="dueDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          step={1}
          required
          className="input"
          defaultValue={dueDays}
          aria-describedby={`${id}-due-hint`}
          {...fieldProblem(state, 'dueDays', messageId)}
        />
        <p id={`${id}-due-hint`} className="muted u-fs-085">
          Counted from the day each billing period starts.
        </p>
      </div>

      <fieldset className="field-row">
        <legend className="field-label">Automatic Grace and Suspended</legend>
        <label>
          <input
            type="radio"
            name="overdueHandling"
            value="off"
            checked={!on}
            onChange={() => setOn(false)}
          />{' '}
          Off
        </label>
        <label>
          <input
            type="radio"
            name="overdueHandling"
            value="on"
            checked={on}
            onChange={() => setOn(true)}
          />{' '}
          On
        </label>
      </fieldset>

      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-grace`}>
          Move to Grace (Days After the Due Date)
        </label>
        <input
          id={`${id}-grace`}
          name="graceAfterDays"
          type="number"
          inputMode="numeric"
          min={0}
          max={364}
          step={1}
          className="input"
          defaultValue={graceAfterDays ?? ''}
          required={on}
          aria-required={on ? true : undefined}
          {...fieldProblem(state, 'graceAfterDays', messageId)}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-suspend`}>
          Suspend (Days After the Due Date)
        </label>
        <input
          id={`${id}-suspend`}
          name="suspendAfterDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          step={1}
          className="input"
          defaultValue={suspendAfterDays ?? ''}
          required={on}
          aria-required={on ? true : undefined}
          aria-describedby={`${id}-suspend-hint`}
          {...fieldProblem(state, 'suspendAfterDays', messageId)}
        />
        <p id={`${id}-suspend-hint`} className="muted u-fs-085">
          Later than Grace. Leave both empty while you have not decided.
        </p>
      </div>

      {switchingOn ? (
        <div className="field-row">
          <label>
            <input
              type="checkbox"
              name="confirmed"
              value="yes"
              {...fieldProblem(state, 'confirmed', messageId)}
            />{' '}
            I have seen how many agencies this moves today
          </label>
        </div>
      ) : null}

      <div className="page-actions">
        <SubmitButton pending={pending} idle="Save Billing Rules" busy="Saving…" />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
