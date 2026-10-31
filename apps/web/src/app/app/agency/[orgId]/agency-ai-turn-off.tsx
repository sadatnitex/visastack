'use client';

import { useActionState, useEffect, useRef } from 'react';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  isFailure,
} from '../../../../components/form-feedback';
import { turnOffAgencyAiConnectionAction } from './ai-actions';

/**
 * Turn Off for one of the agency's AI connections (S22). The connection id is in the form body.
 * It stays mounted when the page reloads the connection as ended (the row keeps its key), so the
 * polite status "Turned off" is announced from an `<output>` that never goes away, and focus moves
 * to it instead of falling back to the page.
 */
export function AgencyAiTurnOff({
  organizationId,
  connectionId,
  appLabel,
  live,
}: {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly appLabel: string;
  /** False once the connection has ended: only the status is shown then. */
  readonly live: boolean;
}) {
  const [state, formAction, pending] = useActionState(turnOffAgencyAiConnectionAction, NO_RESULT);
  const done = state.ok && state.message.length > 0;
  const status = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (done) status.current?.focus();
  }, [done]);
  return (
    <div>
      {live && !done ? (
        <form action={formAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="connectionId" value={connectionId} />
          <SubmitButton
            pending={pending}
            idle="Turn Off"
            busy="Turning off…"
            className="btn btn-secondary"
            label={`Turn Off ${appLabel}`}
          />
        </form>
      ) : null}
      <output ref={status} tabIndex={-1} className="field-msg field-msg-ok">
        {done ? state.message : live ? '' : 'Ended'}
      </output>
      <FormMessage
        result={isFailure(state) ? state : NO_RESULT}
        pending={pending}
        pendingText="Turning off…"
      />
    </div>
  );
}
