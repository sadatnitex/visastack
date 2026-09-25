'use server';

import { decideAcknowledgement } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../../lib/step-up';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DECISIONS = ['ACKNOWLEDGED', 'REJECTED', 'CORRECTION_REQUESTED'] as const;
type Decision = (typeof DECISIONS)[number];

function isDecision(value: string): value is Decision {
  return (DECISIONS as readonly string[]).includes(value);
}

const DECISION_MESSAGES: Record<Decision, string> = {
  ACKNOWLEDGED: 'Prepared file acknowledged.',
  REJECTED: 'Marked as rejected.',
  CORRECTION_REQUESTED: 'Correction requested.',
};

/**
 * TRU-02 (master directive Part 7 §3): record the applicant's decision on a
 * prepared file (acknowledge, reject, or request a correction). Step-up
 * follows the same `tryEstablishStepUp`/redirect-on-stale pattern already
 * proven in `applicant/[id]/sharing/actions.ts` -- a fresh WorkOS session
 * mints a real, action/resource-bound assurance record; a stale one sends
 * the applicant through reauthentication and back to this same page,
 * `returnTo`, to try again.
 */
export async function decideAcknowledgementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const snapshotId = String(formData.get('snapshotId') ?? '');
  const expectedSnapshotChecksum = String(formData.get('expectedSnapshotChecksum') ?? '');
  const decisionRaw = String(formData.get('decision') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (
    missionId.length === 0 ||
    snapshotId.length === 0 ||
    expectedSnapshotChecksum.length === 0 ||
    !isDecision(decisionRaw)
  ) {
    return { ok: false, message: 'Missing snapshot or decision.' };
  }
  const decision = decisionRaw;
  if (decision !== 'ACKNOWLEDGED' && reason.length === 0) {
    return { ok: false, message: 'A reason is required to reject or request a correction.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'MISSION_ACKNOWLEDGEMENT', resourceId: missionId },
      `/app/mission/${missionId}/snapshots/${snapshotId}`,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const decided = await decideAcknowledgement(db, {
      actorAccountId: accountId,
      missionId,
      snapshotId,
      expectedSnapshotChecksum,
      decision,
      stepUpSatisfied: true,
      ...(reason.length > 0 ? { reason } : {}),
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return { ok: true, message: DECISION_MESSAGES[decision] } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}/snapshots/${snapshotId}`);
  return result;
}
