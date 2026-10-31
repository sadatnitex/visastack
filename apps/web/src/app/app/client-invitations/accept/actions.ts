'use server';

import {
  GRANT_AI_ASSIST_STEP_UP_ACTION,
  acceptClientInvitation,
  accountPrincipal,
  requireAccess,
  setGrantAiAssist,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../lib/session';
import { establishStepUpProof } from '../../../../lib/step-up';

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

  // S22: the traveller may also let this agency's AI tools read what they share, unticked by
  // default. It needs a fresh identity check (decision D2): a recent sign-in passes at once; an
  // older one is sent to confirm it is them and lands on Sharing, where they tick it again.
  const allowAgencyAi = formData.get('allowAgencyAi') === 'on';

  const result = await withSession(async ({ db, accountId }) => {
    const accepted = await acceptClientInvitation(db, {
      actorAccountId: accountId,
      rawToken,
      applicantChoice,
    });
    if (!accepted.ok) return { applicantId: null, message: accepted.error.message, next: null };
    const { applicantId, grantId } = accepted.value;
    if (!allowAgencyAi) return { applicantId, message: '', next: null };
    const sharing = `/app/applicant/${applicantId}/sharing`;
    const stepUp = await establishStepUpProof(
      { accountId, action: GRANT_AI_ASSIST_STEP_UP_ACTION, resourceId: applicantId },
      sharing,
    );
    if (stepUp.kind !== 'proof') {
      return {
        applicantId,
        message: '',
        next: stepUp.kind === 'reauth_required' ? stepUp.reauthUrl : sharing,
      };
    }
    const owner = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'owner_sharing' },
    );
    const allowed = owner.ok
      ? await setGrantAiAssist(owner.value, { grantId, allow: true, stepUp: stepUp.proof })
      : null;
    // Not saved (for example the update is not in place yet): Sharing shows where it stands.
    return { applicantId, message: '', next: allowed?.ok ? null : sharing };
  });

  if (result.next) redirect(result.next);
  if (result.applicantId) redirect(`/app/applicant/${result.applicantId}`);
  return { ok: false, message: result.message };
}
