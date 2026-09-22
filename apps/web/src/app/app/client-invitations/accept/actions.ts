'use server';

import { acceptClientInvitation } from '@visastack/services';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../lib/session';

export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Accept a pending client invitation (Commercial V1 Part 4 §6, IAM-03). */
export async function acceptClientInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawToken = String(formData.get('token') ?? '');
  if (rawToken.length === 0) return { ok: false, message: 'Missing invitation token.' };

  const applicantSelection = String(formData.get('applicantSelection') ?? 'new');
  const newDisplayName = String(formData.get('newDisplayName') ?? '').trim();
  const applicantChoice =
    applicantSelection === 'new'
      ? ({
          kind: 'new',
          ...(newDisplayName.length > 0 ? { displayName: newDisplayName } : {}),
        } as const)
      : ({ kind: 'existing', applicantId: applicantSelection } as const);

  const result = await withSession(async ({ db, accountId }) => {
    const accepted = await acceptClientInvitation(db, {
      actorAccountId: accountId,
      rawToken,
      applicantChoice,
    });
    if (!accepted.ok) return { applicantId: null, message: accepted.error.message };
    return { applicantId: accepted.value.applicantId, message: '' };
  });

  if (result.applicantId) redirect(`/app/applicant/${result.applicantId}`);
  return { ok: false, message: result.message };
}
