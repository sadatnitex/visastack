'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appSharingInvitationsCatalog } from '../../../../i18n/app-sharing-invitations';
import { acceptSharingInvitationAction } from './actions';

export function AcceptSharingInvitationForm({ token }: { readonly token: string }) {
  const t = useT(appSharingInvitationsCatalog);
  const [state, action, pending] = useActionState(acceptSharingInvitationAction, {
    ok: true,
    message: '',
  });
  return (
    <form action={action} className="field-list">
      <input type="hidden" name="token" value={token} />
      <label>
        <input type="checkbox" name="confirm" value="true" required />{' '}
        {t.node(
          'appSharingInvitations.appSharingInvitationsAcceptAcceptForm.iHaveReviewedThePurposePermissions',
        )}
      </label>
      <SubmitButton pending={pending} idle="Accept Shared Access" busy="Accepting..." />
      <FormMessage result={state} />
    </form>
  );
}
