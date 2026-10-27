'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useLatestResultArea } from '../../../../components/latest-result';
import { type ActionState, revokeClientInvitationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function ClientInvitationRevokeButton({
  organizationId,
  invitationId,
}: {
  readonly organizationId: string;
  readonly invitationId: string;
}) {
  // Inside a Team or Clients panel the panel says what happened, once, for the latest action.
  const area = useLatestResultArea<ActionState>();
  const [state, formAction, pending] = useActionState(
    area ? area.track(revokeClientInvitationAction) : revokeClientInvitationAction,
    INITIAL,
  );
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}
    >
      <form action={formAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="invitationId" value={invitationId} />
        <SubmitButton
          pending={pending}
          idle="Revoke"
          busy="Revoking…"
          className="btn btn-secondary u-btn-sm"
        />
      </form>
      {area ? null : <FormMessage result={state} />}
    </div>
  );
}
