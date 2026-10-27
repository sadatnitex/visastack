'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, revokeClientInvitationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function ClientInvitationRevokeButton({
  organizationId,
  invitationId,
}: {
  readonly organizationId: string;
  readonly invitationId: string;
}) {
  const [state, formAction, pending] = useActionState(revokeClientInvitationAction, INITIAL);
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
      <FormMessage result={state} />
    </div>
  );
}
