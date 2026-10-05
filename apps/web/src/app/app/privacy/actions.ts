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
import { getI18n } from '../../../lib/locale';
import { errorText } from '../../../lib/localize-error';
import { withSession } from '../../../lib/session';
import { tryEstablishStepUp } from '../../../lib/step-up';

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
  const i18n = await getI18n();
  const reason = String(formData.get('reason') ?? '').trim();
  const result = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ACCOUNT_DELETION_REQUEST', resourceId: accountId },
      '/app/privacy',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: i18n.t('error.stepUpNotConfigured') } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const req = await requestAccountDeletion(db, {
      actorAccountId: accountId,
      accountId,
      ...(reason.length > 0 ? { reason } : {}),
    });
    if (!req.ok) return { ok: false, message: errorText(i18n, req.error) } satisfies ActionState;
    return {
      ok: true,
      message: i18n.t('privacy.deletion.scheduled', {
        when: i18n.date(req.value.scheduledFor, 'long'),
      }),
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
  const i18n = await getI18n();
  const result = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ACCOUNT_EXPORT_LARGE', resourceId: accountId },
      '/app/privacy',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: i18n.t('error.stepUpNotConfigured') } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    await enqueueAccountExportJob(db, accountId);
    return { ok: true, message: i18n.t('privacy.large.started') } satisfies ActionState;
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
  const i18n = await getI18n();
  const result = await withSession(async ({ db, accountId }) => {
    const cancelled = await cancelAccountDeletion(db, { actorAccountId: accountId, accountId });
    if (!cancelled.ok) {
      return { ok: false, message: errorText(i18n, cancelled.error) } satisfies ActionState;
    }
    return { ok: true, message: i18n.t('privacy.deletion.cancelled') } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/privacy');
  return result;
}
