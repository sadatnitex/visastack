'use client';

import { useActionState } from 'react';
import { type ActionState, acceptInvitationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function AcceptInvitationForm({ token }: { readonly token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Joining…' : 'Accept and join'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
