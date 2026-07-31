'use server';

import { PERMISSION_ACTIONS, type PermissionAction } from '@visastack/core';
import {
  STEP_UP_ACTIONS,
  createGrant,
  getAccountByEmail,
  pauseGrant,
  resumeGrant,
  revokeGrant,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../../lib/session';
import { establishStepUp } from '../../../../../lib/step-up';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

function isPermissionAction(value: string): value is PermissionAction {
  return (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

/** Create a pending, purpose-bound grant to an existing VisaStack user by email. */
export async function createGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const recipientEmail = String(formData.get('recipientEmail') ?? '')
    .trim()
    .toLowerCase();
  const purpose = String(formData.get('purpose') ?? '').trim();
  const actions = formData.getAll('action').map(String).filter(isPermissionAction);
  const categories = formData.getAll('category').map(String);
  const documentIds = formData.getAll('documentId').map(String);
  const expiryDaysRaw = String(formData.get('expiryDays') ?? '').trim();

  if (recipientEmail.length === 0) return { ok: false, message: 'Enter a recipient email.' };
  if (purpose.length === 0) return { ok: false, message: 'Describe the purpose of this access.' };
  if (actions.length === 0) return { ok: false, message: 'Select at least one permission.' };

  let expiryAt: Date | undefined;
  if (expiryDaysRaw.length > 0) {
    const days = Number(expiryDaysRaw);
    if (!Number.isFinite(days) || days <= 0) {
      return { ok: false, message: 'Expiry must be a positive number of days.' };
    }
    expiryAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  // Handing out a STEP_UP_ACTIONS action (DOWNLOAD_ORIGINAL/EXPORT_PROFILE/
  // SHARE) is itself the sensitive act (master directive §7 "PR 5") — an
  // ordinary view/preview/comment-only grant never prompts for reauth.
  const isSensitive = actions.some((action) => STEP_UP_ACTIONS.includes(action));

  const result = await withSession(async ({ db, accountId }) => {
    const recipient = await getAccountByEmail(db, recipientEmail);
    if (!recipient) {
      return {
        ok: false,
        message: 'No VisaStack account found for that email. They must sign in once first.',
      } satisfies ActionState;
    }
    if (recipient.id === accountId) {
      return { ok: false, message: 'You cannot share with yourself.' } satisfies ActionState;
    }
    let stepUpSatisfied = false;
    if (isSensitive) {
      const stepUp = await establishStepUp(
        { accountId, action: 'SHARE', resourceId: applicantId },
        `/app/applicant/${applicantId}/sharing`,
      );
      if (!stepUp.satisfied) redirect(stepUp.reauthUrl);
      stepUpSatisfied = true;
    }
    const created = await createGrant(db, {
      actorAccountId: accountId,
      applicantId,
      recipientAccountId: recipient.id,
      actions,
      purpose,
      stepUpSatisfied,
      ...(categories.length > 0 ? { categories } : {}),
      ...(documentIds.length > 0 ? { documentIds } : {}),
      ...(expiryAt ? { expiryAt } : {}),
    });
    if (!created.ok) return { ok: false, message: created.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Access shared with ${recipientEmail}. It becomes active once they accept.`,
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return result;
}

const OP_LABELS: Record<string, string> = {
  revoke: 'revoked',
  pause: 'paused',
  resume: 'resumed',
};

/** Revoke, pause, or resume a grant (applicant owner). */
export async function updateGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const grantId = String(formData.get('grantId') ?? '');
  const op = String(formData.get('op') ?? '');
  if (grantId.length === 0) return { ok: false, message: 'Missing grant id.' };

  const result = await withSession(async ({ db, accountId }) => {
    const input = { actorAccountId: accountId, grantId };
    if (op === 'revoke') return revokeGrant(db, input);
    if (op === 'pause') return pauseGrant(db, input);
    if (op === 'resume') return resumeGrant(db, input);
    return { ok: false, error: { message: 'Unknown operation.' } } as const;
  });

  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return { ok: true, message: `Access ${OP_LABELS[op] ?? 'updated'}.` };
}
