'use client';

import { REMOVAL_DECLINE_CODES } from '@visastack/services';
import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { decideRemovalAction } from './actions';
import { DECLINE_LABELS } from './labels';

/**
 * Approve, or decline with a reason, one removal request. Approve is not offered while a legal
 * hold covers the document (the server refuses it too). Both ask for a fresh sign-in check.
 */
export function DecideRemovalForm({
  requestId,
  documentCode,
  legalHold,
}: {
  readonly requestId: string;
  readonly documentCode: string;
  readonly legalHold: boolean;
}) {
  const [state, formAction, pending] = useActionState(decideRemovalAction, NO_RESULT);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = useId();
  const selectId = useId();
  const hintId = useId();

  return (
    <form ref={form} action={formAction} className="lc-removal-decide">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="lc-removal-decline">
        <label htmlFor={selectId}>Reason to Decline</label>
        <select
          id={selectId}
          name="decisionCode"
          defaultValue={legalHold ? 'LEGAL_HOLD' : ''}
          {...fieldProblem(state, 'decisionCode', messageId, hintId)}
        >
          <option value="">Choose a Reason</option>
          {REMOVAL_DECLINE_CODES.map((code) => (
            <option key={code} value={code}>
              {DECLINE_LABELS[code]}
            </option>
          ))}
        </select>
        <p id={hintId} className="muted u-fs-085">
          Only needed to decline. The person is told this reason in plain words.
        </p>
      </div>
      <div className="lc-removal-buttons">
        {legalHold ? null : (
          <SubmitButton
            pending={pending}
            name="decision"
            value="APPROVE"
            idle={`Approve Removal of ${documentCode}`}
            busy="Saving"
          />
        )}
        <SubmitButton
          pending={pending}
          className="btn btn-secondary"
          name="decision"
          value="DECLINE"
          idle="Decline"
          busy="Saving"
        />
      </div>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving" />
    </form>
  );
}
