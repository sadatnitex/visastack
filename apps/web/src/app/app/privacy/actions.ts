'use server';

import { cancelAccountDeletion, requestAccountDeletion } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Open a reversible deletion request (7-day grace window) for the signed-in account. */
export async function requestDeletionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  const result = await withSession(async ({ db, accountId }) => {
    const req = await requestAccountDeletion(db, {
      actorAccountId: accountId,
      accountId,
      ...(reason.length > 0 ? { reason } : {}),
    });
    if (!req.ok) return { ok: false, message: req.error.message } satisfies ActionState;
    const when = req.value.scheduledFor.toLocaleDateString();
    return {
      ok: true,
      message: `Deletion scheduled for ${when}. You can cancel any time before then.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/privacy');
  return result;
}

/** Cancel the pending deletion request during the grace window. */
export async function cancelDeletionAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await withSession(async ({ db, accountId }) => {
    const cancelled = await cancelAccountDeletion(db, { actorAccountId: accountId, accountId });
    if (!cancelled.ok) return { ok: false, message: cancelled.error.message } satisfies ActionState;
    return { ok: true, message: 'Deletion request cancelled.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/privacy');
  return result;
}
