'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import { AiAccessChoices } from '../../../../../components/ai-access-choices';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  isFailure,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import type { ConsentInitial } from '../../../../../lib/ai-consent-choices';
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
  return (
    <form ref={formRef} action={formAction} className="field-list">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <AiAccessChoices
        appName={appName}
        cases={cases}
        initial={initial}
        durations={durations}
        defaultDuration={defaultDuration}
        {...(isFailure(state) && state.field ? { invalid: { field: state.field, messageId } } : {})}
      />
      <p className="card-body">
        {appName} can read only what you choose here. It cannot change anything in VisaStack.
      </p>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving…" />
      <div className="page-actions">
        <SubmitButton pending={pending} idle="Save Changes" busy="Saving…" />
      </div>
    </form>
  );
}
