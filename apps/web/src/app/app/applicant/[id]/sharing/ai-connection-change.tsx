'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { AiAccessChoices } from '../../../../../components/ai-access-choices';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  isFailure,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import type { ConsentInitial } from '../../../../../lib/ai-consent-choices';
import { aiChangeSentence } from '../../../../../lib/ai-consent-labels';
import { type AiConnectionActionState, changeAiAccessAction } from './ai-connection-actions';

export interface ChangeAccessFormProps {
  readonly applicantId: string;
  readonly connectionId: string;
  readonly appName: string;
  readonly cases: readonly { readonly id: string; readonly title: string }[];
  /** The connection's stored choices, or the person's own after a fresh sign-in check. */
  readonly initial: Omit<ConsentInitial, 'duration'>;
  readonly durations: readonly { readonly value: string; readonly label: string }[];
  readonly defaultDuration: string;
  /** Whether AI App Suggestions works right now (S21). */
  readonly suggestionsAvailable?: boolean;
}

/**
 * Change Access for one AI connection: the consent screen's own choices, starting from what the
 * app can read now. Saving takes effect on the app's next request.
 */
export function ChangeAccessForm({
  applicantId,
  connectionId,
  appName,
  cases,
  initial,
  durations,
  defaultDuration,
  suggestionsAvailable = false,
}: ChangeAccessFormProps) {
  const [state, formAction, pending] = useActionState<AiConnectionActionState, FormData>(
    changeAiAccessAction,
    NO_RESULT,
  );
  const messageId = `${useId()}-ai-change-message`;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  useEffect(() => {
    if (state.ok && state.refreshPath) window.location.assign(state.refreshPath);
  }, [state]);
  // The sentence under the choices follows the Suggest Changes box as it is ticked.
  const shown = state.choices ?? initial;
  const [suggest, setSuggest] = useState(shown.suggestChanges);
  useEffect(() => setSuggest(shown.suggestChanges), [shown.suggestChanges]);
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
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <AiAccessChoices
        // React resets a form after its action; starting again from what was submitted (a new key
        // re-applies the defaults) keeps the person's choices for the retry.
        key={state.choices ? JSON.stringify(state.choices) : 'stored'}
        appName={appName}
        cases={cases}
        initial={state.choices ?? initial}
        durations={durations}
        defaultDuration={state.choices?.duration ?? defaultDuration}
        suggestionsAvailable={suggestionsAvailable}
        suggestMode="change"
        {...(isFailure(state) && state.field ? { invalid: { field: state.field, messageId } } : {})}
      />
      <p className="card-body">{aiChangeSentence(appName, suggestionsAvailable && suggest)}</p>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving…" />
      <div className="page-actions">
        <SubmitButton pending={pending} idle="Save Changes" busy="Saving…" />
      </div>
    </form>
  );
}
