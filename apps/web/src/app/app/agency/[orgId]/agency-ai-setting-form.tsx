'use client';

import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  isFailure,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { agencyAiStatement } from '../../../../lib/agency-ai';
import { setAgencyAiSettingAction } from './ai-actions';

/**
 * Turns "AI Connections for This Agency" on (after the statement is confirmed) or off (S22).
 * Owners and admins only; the page shows everyone else a plain line instead.
 */
export function AgencyAiSettingForm({
  organizationId,
  organizationName,
  enabled,
}: {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly enabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAgencyAiSettingAction, NO_RESULT);
  const id = useId();
  const statementId = `${id}-statement`;
  const messageId = `${id}-message`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  const invalid = isFailure(state) && state.field === 'confirm';
  return (
    <form ref={formRef} action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      {enabled ? null : (
        <fieldset className="fieldset">
          <legend className="field-label">Statement</legend>
          <p className="card-body" id={statementId}>
            {agencyAiStatement(organizationName)}
          </p>
          <div className="checks">
            <label className="check" htmlFor={`${id}-confirm`}>
              <input
                id={`${id}-confirm`}
                type="checkbox"
                name="confirm"
                aria-describedby={invalid ? `${statementId} ${messageId}` : statementId}
                aria-invalid={invalid || undefined}
              />
              <span>I Confirm This Statement for {organizationName}</span>
            </label>
          </div>
        </fieldset>
      )}
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving…" />
      <div>
        <SubmitButton
          pending={pending}
          idle={enabled ? 'Turn Off' : 'Turn On'}
          busy="Saving…"
          className={`btn ${enabled ? 'btn-secondary' : 'btn-primary'}`}
        />
      </div>
    </form>
  );
}
