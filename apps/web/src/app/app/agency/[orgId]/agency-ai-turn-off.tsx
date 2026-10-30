'use client';

import { useActionState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../components/form-feedback';
import { turnOffAgencyAiConnectionAction } from './ai-actions';

/** Turn Off for one of the agency's AI connections (S22). The connection id is in the form body. */
export function AgencyAiTurnOff({
  organizationId,
  connectionId,
  appLabel,
}: {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly appLabel: string;
}) {
  const [state, formAction, pending] = useActionState(turnOffAgencyAiConnectionAction, NO_RESULT);
  return (
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
      <FormMessage result={state} pending={pending} pendingText="Turning off…" />
    </form>
  );
}
