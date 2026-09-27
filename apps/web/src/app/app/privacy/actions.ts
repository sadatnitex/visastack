'use server';

import {
  cancelAccountDeletion,
  enqueueAccountExportJob,
  requestAccountDeletion,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { triggerAccountExportWorker } from '../../../lib/jobs';
import { withSession } from '../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../lib/step-up';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Open a reversible deletion request (7-day grace window) for the signed-in
 * account. Step-up gated (master directive §7 "PR 5" — "account deletion
 * confirmation"): this is the exact moment the deletion clock starts, so it
 * requires a genuine, recent WorkOS reauthentication, not just an existing
 * session. Cancelling a pending request is not gated — undoing a dangerous
 * action needs no extra proof.
 */
export async function requestDeletionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  const result = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ACCOUNT_DELETION_REQUEST', resourceId: accountId },
      '/app/privacy',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
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

/**
 * Requests a large export (PRV-04, master directive Part 7 §14 "Large
 * export") -- the async job that bundles real original document bytes
 * alongside the existing JSON/CSV metadata, unlike the synchronous
 * `/app/privacy/export` route above. Step-up gated for the same reason that
 * route already is: a bulk export containing actual document images is at
 * least as attractive a silent-exfiltration target as metadata alone, if
 * not more so. `enqueueAccountExportJob` is itself idempotent (an in-flight
 * or still-valid job is returned unchanged), so a double-click or repeat
 * request never queues duplicate work. The worker is kicked immediately via
 * `after()` for near-instant turnaround in the common case --
 * `/api/jobs/process-account-exports` is the durability backstop if that
 * doesn't run, exactly like every other opportunistically-triggered worker
 * in this codebase.
 */
export async function requestLargeExportAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ACCOUNT_EXPORT_LARGE', resourceId: accountId },
      '/app/privacy',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    await enqueueAccountExportJob(db, accountId);
    return {
      ok: true,
      message: 'Preparing your export. This can take a few minutes.',
    } satisfies ActionState;
  });
  if (result.ok) {
    after(() => triggerAccountExportWorker());
    revalidatePath('/app/privacy');
  }
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
