'use client';

import { useActionState, useId } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { type ActionState, reviewCorrectionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Mark In Review, Dismiss or Accept for Draft, with an optional note. Records the decision only. */
export function CorrectionDecisionForm({
  correctionId,
  status,
  itemName,
}: {
  readonly correctionId: string;
  readonly status: 'RECEIVED' | 'IN_REVIEW';
  readonly itemName: string;
}) {
  const [state, formAction, pending] = useActionState(reviewCorrectionAction, INITIAL);
  const noteId = `${useId()}-note`;
  return (
    <form action={formAction} className="field-list u-mt-050">
      <input type="hidden" name="correctionId" value={correctionId} />
      <div className="field-row">
        <label className="field-label" htmlFor={noteId}>
          Review Note (Optional)
        </label>
        <input id={noteId} name="note" type="text" maxLength={1000} className="input" />
      </div>
      <div className="action-bar-end">
        {status === 'RECEIVED' ? (
          <SubmitButton
            pending={pending}
            idle="Mark in Review"
            busy="Saving…"
            className="btn btn-secondary"
            name="decision"
            value="IN_REVIEW"
            label={`Mark in Review: ${itemName}`}
          />
        ) : null}
        <SubmitButton
          pending={pending}
          idle="Dismiss"
          busy="Saving…"
          className="btn btn-secondary"
          name="decision"
          value="DISMISSED"
          label={`Dismiss: ${itemName}`}
        />
        <SubmitButton
          pending={pending}
          idle="Accept for Draft"
          busy="Saving…"
          className="btn btn-primary"
          name="decision"
          value="ACCEPTED_FOR_DRAFT"
          label={`Accept for Draft: ${itemName}`}
        />
      </div>
      <FormMessage result={state} />
    </form>
  );
}
