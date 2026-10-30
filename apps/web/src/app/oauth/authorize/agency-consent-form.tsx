'use client';

import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  isFailure,
  useFocusInvalidField,
} from '../../../components/form-feedback';
import {
  AGENCY_AI_DURATIONS,
  AGENCY_AI_DURATION_LABELS,
  agencyAiConsentSentence,
} from '../../../lib/agency-ai';
import { answerAgencyAiConsentAction } from './agency-actions';

export interface AgencyConsentFormProps {
  /** The checked request, carried so the answer can be checked again on the server. */
  readonly request: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly resource: string;
    readonly state: string | null;
  };
  readonly agency: { readonly id: string; readonly name: string };
}

/**
 * An agency owner or admin connects an AI app for the agency (S22). What it may read is not
 * chosen here: each traveller decides that on their own grant to the agency. Only how long it may
 * read is chosen, at most 30 days.
 */
export function AgencyConsentForm({ request, agency }: AgencyConsentFormProps) {
  const [state, formAction, pending] = useActionState(answerAgencyAiConsentAction, NO_RESULT);
  const id = useId();
  const messageId = `${id}-message`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  const invalid = isFailure(state) && state.field === 'duration';
  return (
    <form ref={formRef} action={formAction} className="field-list">
      <input type="hidden" name="client_id" value={request.clientId} />
      <input type="hidden" name="redirect_uri" value={request.redirectUri} />
      <input type="hidden" name="code_challenge" value={request.codeChallenge} />
      <input type="hidden" name="resource" value={request.resource} />
      {request.state !== null ? <input type="hidden" name="state" value={request.state} /> : null}
      <input type="hidden" name="agency" value={agency.id} />
      <p className="card-body">{agencyAiConsentSentence(agency.name)}</p>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-duration`}>
          How Long
        </label>
        <select
          id={`${id}-duration`}
          name="duration"
          className="input"
          defaultValue="30d"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? messageId : undefined}
        >
          {AGENCY_AI_DURATIONS.map((duration) => (
            <option key={duration} value={duration}>
              {AGENCY_AI_DURATION_LABELS[duration]}
            </option>
          ))}
        </select>
      </div>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Connecting…" />
      <div className="page-actions">
        <SubmitButton
          pending={pending}
          name="decision"
          value="allow"
          idle="Allow Access"
          busy="Connecting…"
        />
        <SubmitButton
          pending={pending}
          name="decision"
          value="deny"
          idle="Do Not Allow"
          busy="Do Not Allow"
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}
