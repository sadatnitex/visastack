'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { acceptSharingInvitationAction } from './actions';

export function AcceptSharingInvitationForm({ token }: { readonly token: string }) {
  const [state, action, pending] = useActionState(acceptSharingInvitationAction, {
    ok: true,
    message: '',
  });
  return (
    <form action={action} className="field-list">
      <input type="hidden" name="token" value={token} />
      <label>
        <input type="checkbox" name="confirm" value="true" required /> I have reviewed the purpose,
        permissions, document scope and expiry and agree to this access.
      </label>
      <SubmitButton pending={pending} idle="Accept shared access" busy="Accepting..." />
      <FormMessage result={state} />
    </form>
  );
}
