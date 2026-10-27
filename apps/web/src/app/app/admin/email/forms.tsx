'use client';

import { useActionState, useId } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../components/form-feedback';
import { resendEmailAction } from './actions';

/**
 * Send one failed email again. The accessible name says which email (its kind and date), since
 * a list of identical "Send Again" buttons would otherwise be impossible to tell apart.
 */
export function ResendEmailButton({
  notificationId,
  kind,
  date,
}: {
  readonly notificationId: string;
  readonly kind: string;
  readonly date: string;
}) {
  const [state, formAction, pending] = useActionState(resendEmailAction, NO_RESULT);
  const messageId = `${useId()}-message`;

  if (state.ok && state.message) {
    return <FormMessage id={messageId} result={state} />;
  }
  return (
    <form action={formAction} className="u-mt-050">
      <input type="hidden" name="notificationId" value={notificationId} />
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Sending again…" />
      <SubmitButton
        pending={pending}
        idle="Send Again"
        busy="Sending Again…"
        className="btn btn-secondary"
        label={`Send Again: ${kind} from ${date}`}
      />
    </form>
  );
}
