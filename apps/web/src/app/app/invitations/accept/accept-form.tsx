'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, acceptInvitationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function AcceptInvitationForm({ token }: { readonly token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <SubmitButton
        pending={pending}
        idle="Accept and join"
        busy="Joining…"
        className="btn btn-primary"
      />
      <FormMessage result={state} />
    </form>
  );
}
