'use client';

import { useActionState, useId } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
import { AGENCY_AI_CHOICE_LABEL, agencyAiTravellerNote } from '../../../../../lib/agency-ai';
import { setGrantAiAssistAction } from './grant-ai-actions';

/**
 * The traveller's own choice on one agency grant (S22): whether that agency's AI tools may read
 * what the grant shares. Starts from what is stored, never from the address; the grant id is in
 * the form body. Turning it on asks the person to confirm it is them.
 */
export function GrantAiChoice({
  applicantId,
  grantId,
  agencyName,
  allowed,
}: {
  readonly applicantId: string;
  readonly grantId: string;
  readonly agencyName: string;
  readonly allowed: boolean;
}) {
  const [state, formAction, pending] = useActionState(setGrantAiAssistAction, NO_RESULT);
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="grantId" value={grantId} />
      <fieldset className="fieldset">
        <legend className="field-label">AI Tools</legend>
        <div className="checks">
          <label className="check" htmlFor={`${id}-allow`}>
            <input
              id={`${id}-allow`}
              type="checkbox"
              name="allow"
              defaultChecked={allowed}
              aria-describedby={noteId}
            />
            <span>{AGENCY_AI_CHOICE_LABEL}</span>
          </label>
        </div>
        <small className="muted" id={noteId}>
          {agencyAiTravellerNote(agencyName)}
        </small>
      </fieldset>
      <FormMessage result={state} pending={pending} pendingText="Saving…" />
      <div>
        <SubmitButton
          pending={pending}
          idle="Save"
          busy="Saving…"
          className="btn btn-secondary"
          label={`Save AI Tools Choice for ${agencyName}`}
        />
      </div>
    </form>
  );
}
