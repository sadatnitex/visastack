'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { AiAccessChoices } from '../../../components/ai-access-choices';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  isFailure,
  useFocusInvalidField,
} from '../../../components/form-feedback';
import {
  AI_CONNECTION_DURATIONS,
  CONSENT_DEFAULTS,
  type ConsentInitial,
} from '../../../lib/ai-consent-choices';
import { AI_DURATION_LABELS, aiConsentSentence } from '../../../lib/ai-consent-labels';
import { answerAiConsentAction } from './actions';

export interface ConsentFormProps {
  /** The checked request, carried so the answer can be checked again on the server. */
  readonly request: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly resource: string;
    readonly state: string | null;
  };
  readonly appName: string;
  readonly record: { readonly id: string; readonly name: string };
  readonly cases: readonly { readonly id: string; readonly title: string }[];
  /** The choices to start from: the safe defaults, or the person's own after a sign-in check. */
  readonly initial?: ConsentInitial;
  /** Whether AI App Suggestions works right now (S21). */
  readonly suggestionsAvailable?: boolean;
}

/**
 * What the person lets their own AI app read. Nothing is preselected beyond the safe defaults in
 * ADR 0021 section 5; sensitive parts carry a warning and stay off until chosen.
 */
export function ConsentForm({
  request,
  appName,
  record,
  cases,
  initial = CONSENT_DEFAULTS,
  suggestionsAvailable = false,
}: ConsentFormProps) {
  const [state, formAction, pending] = useActionState(answerAiConsentAction, NO_RESULT);
  // The sentence under the choices says what the app will be able to do, as the box is ticked.
  const [suggest, setSuggest] = useState(initial.suggestChanges);
  const messageId = `${useId()}-ai-consent-message`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  return (
    <form
      ref={formRef}
      action={formAction}
      className="field-list"
      onChange={(event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.name === 'suggest_changes') {
          setSuggest(target.checked);
        }
      }}
    >
      <input type="hidden" name="client_id" value={request.clientId} />
      <input type="hidden" name="redirect_uri" value={request.redirectUri} />
      <input type="hidden" name="code_challenge" value={request.codeChallenge} />
      <input type="hidden" name="resource" value={request.resource} />
      {request.state !== null ? <input type="hidden" name="state" value={request.state} /> : null}
      <input type="hidden" name="record" value={record.id} />

      <AiAccessChoices
        appName={appName}
        cases={cases}
        initial={initial}
        durations={AI_CONNECTION_DURATIONS.map((duration) => ({
          value: duration,
          label: AI_DURATION_LABELS[duration],
        }))}
        defaultDuration={initial.duration}
        suggestionsAvailable={suggestionsAvailable}
        {...(isFailure(state) && state.field ? { invalid: { field: state.field, messageId } } : {})}
      />

      <p className="card-body">{aiConsentSentence(suggestionsAvailable && suggest)}</p>
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
