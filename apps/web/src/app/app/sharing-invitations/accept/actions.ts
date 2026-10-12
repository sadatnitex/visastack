'use server';

import { acceptSharingInvitation } from '@visastack/services';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../lib/session';

const sharingInvitationFlag = 'PERSONAL_SHARING_INVITATIONS_ENABLED';

export async function acceptSharingInvitationAction(
  _previous: { readonly ok: boolean; readonly message: string },
  form: FormData,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  if (process.env[sharingInvitationFlag] !== 'true')
    return { ok: false, message: 'Sharing invitations are temporarily unavailable.' };
  if (form.get('confirm') !== 'true')
    return { ok: false, message: 'Review and confirm the access before accepting.' };
  const result = await withSession(({ db, accountId }) =>
    acceptSharingInvitation(db, {
      actorAccountId: accountId,
      rawToken: String(form.get('token') ?? ''),
    }),
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  redirect(`/app/shared/${result.value}`);
}
