'use server';

import { INVITATION_TOKEN_PATTERN } from '../../lib/invitation-token';
import { signOutCurrentUser } from '../../lib/sign-out';
import { invitationReturnPath, isInvitationKind } from './accept-paths';

/**
 * "Not you?" on the invitation page: sign out of the account in use, then go to sign-in with this
 * invitation as the place to return to. The return address is rebuilt from the kind and a
 * well-formed link only, never taken as written; anything else signs out to the landing page.
 * Signing out accepts and changes nothing about the invitation.
 */
export async function switchInvitationAccountAction(formData: FormData): Promise<void> {
  const kind = formData.get('kind');
  const token = formData.get('token');
  if (
    !isInvitationKind(kind) ||
    typeof token !== 'string' ||
    !INVITATION_TOKEN_PATTERN.test(token)
  ) {
    await signOutCurrentUser();
    return;
  }
  await signOutCurrentUser(`/auth/sign-in?next=${invitationReturnPath(kind, token)}`);
}
