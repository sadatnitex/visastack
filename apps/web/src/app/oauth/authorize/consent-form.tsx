'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { AiAccessChoices } from '../../../components/ai-access-choices';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  isFailure,
  useFocusInvalidField,
} from '../../../components/form-feedback';
import { StickyActionBar } from '../../../components/sticky-action-bar';
import {
  AI_CONNECTION_DURATIONS,
  type AiFileChoice,
  type AiFilesView,
  CONSENT_DEFAULTS,
  type ConsentInitial,
} from '../../../lib/ai-consent-choices';
import { AI_DURATION_LABELS, aiConsentSentence } from '../../../lib/ai-consent-labels';
import { type ConsentActionState, answerAiConsentAction } from './actions';

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
  /** "Original Files" (S20): what may be ticked, or absent while it cannot be offered. */
  readonly files?: AiFilesView;
  /** The files the person ticked before a fresh sign-in check (from a signed cookie, never a link). */
  readonly filesInitial?: readonly AiFileChoice[];
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
  files,
  filesInitial = [],
}: ConsentFormProps) {
  const [state, formAction, pending] = useActionState<ConsentActionState, FormData>(
    answerAiConsentAction,
    NO_RESULT,
  );
  // React resets a form after its action; the person's own choices come back with the answer.
  const shown = state.choices ?? initial;
  const shownFiles = state.files ?? filesInitial;
  // The sentence under the choices says what the app will be able to do, as the box is ticked.
  const [suggest, setSuggest] = useState(initial.suggestChanges);
  // After a refusal the box starts unticked again (it is never carried), and so does the sentence.
  useEffect(() => {
    if (state.choices) setSuggest(false);
  }, [state]);
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
        // A new key re-applies the starting values: what was submitted, after a refusal.
        key={state.choices ? JSON.stringify([state.choices, state.files ?? null]) : 'start'}
        appName={appName}
        cases={cases}
        initial={shown}
        durations={AI_CONNECTION_DURATIONS.map((duration) => ({
          value: duration,
          label: AI_DURATION_LABELS[duration],
        }))}
        defaultDuration={shown.duration}
        suggestionsAvailable={suggestionsAvailable}
        {...(files ? { files } : {})}
        filesInitial={shownFiles}
        {...(isFailure(state) && state.field ? { invalid: { field: state.field, messageId } } : {})}
      />

      <p className="card-body">{aiConsentSentence(suggestionsAvailable && suggest)}</p>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Connecting…" />
      {/* The answer stays in reach while the person reads the choices (WP-SB4). */}
      <StickyActionBar label={`Answer ${appName}`}>
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
      </StickyActionBar>
    </form>
  );
}
