'use server';

import { acceptOrganizationInvitation } from '@visastack/services';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../lib/session';

export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Accept a pending organization invitation (Commercial V1 Part 4 §5). */
export async function acceptInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawToken = String(formData.get('token') ?? '');
  if (rawToken.length === 0) return { ok: false, message: 'Missing invitation token.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    const accepted = await acceptOrganizationInvitation(db, {
      actorAccountId: accountId,
      actorEmail: email,
      rawToken,
    });
    if (!accepted.ok) return { organizationId: null, message: accepted.error.message };
    return { organizationId: accepted.value.organizationId, message: '' };
  });

  if (result.organizationId) redirect(`/app/agency/${result.organizationId}`);
  return { ok: false, message: result.message };
}
