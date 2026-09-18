'use client';

import { useActionState } from 'react';
import { type ActionState, revokeInvitationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function InvitationRevokeButton({
  organizationId,
  invitationId,
}: {
  readonly organizationId: string;
  readonly invitationId: string;
}) {
  const [state, formAction, pending] = useActionState(revokeInvitationAction, INITIAL);
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}
    >
      <form action={formAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="invitationId" value={invitationId} />
        <button
          type="submit"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
          disabled={pending}
        >
          {pending ? 'Revoking…' : 'Revoke'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
