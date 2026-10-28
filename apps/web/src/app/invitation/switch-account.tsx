'use client';

import { useFormStatus } from 'react-dom';
import { SubmitButton } from '../../components/form-feedback';
import type { InvitationKind } from './accept-paths';
import { switchInvitationAccountAction } from './actions';

function SwitchButton() {
  const { pending } = useFormStatus();
  return (
    <SubmitButton
      pending={pending}
      className="invitation-switch-button"
      idle="Sign In with the Invited Email Address"
      busy="Signing Out…"
    />
  );
}

/**
 * For a visitor who is already signed in, perhaps with another account: one quiet line that signs
 * them out and brings them back to sign in for this invitation.
 */
export function SwitchInvitationAccount({
  kind,
  token,
}: {
  readonly kind: InvitationKind;
  readonly token: string;
}) {
  return (
    <form action={switchInvitationAccountAction} className="invitation-switch">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="token" value={token} />
      <span>Not you?</span> <SwitchButton />
    </form>
  );
}
