'use server';

import { PERMISSION_ACTIONS, type PermissionAction } from '@visastack/core';
import {
  STEP_UP_ACTIONS,
  accountPrincipal,
  createGrant,
  createSharingInvitation,
  expandGrantScope,
  getAccountByEmail,
  pauseGrant,
  removeCaseException,
  requireAccess,
  resumeGrant,
  revokeGrant,
  revokeSharingInvitation,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { resolveBaseUrl } from '../../../../../lib/base-url';
import { triggerNotificationWorker } from '../../../../../lib/jobs';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { withSession } from '../../../../../lib/session';
import {
  STEP_UP_NOT_CONFIGURED_MESSAGE,
  establishStepUpProof,
  tryEstablishStepUp,
} from '../../../../../lib/step-up';

/** Result surfaced back to the client for inline feedback. */
const sharingInvitationFlag = 'PERSONAL_SHARING_INVITATIONS_ENABLED';

export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly invitationUrl?: string;
  readonly refreshPath?: string;
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
    const invitationsEnabled = process.env[sharingInvitationFlag] === 'true';
    if (!recipient && !invitationsEnabled) {
      return {
        ok: false,
        message: 'No VisaStack account found for that email. They must sign in once first.',
      } satisfies ActionState;
    }
    if (recipient?.id === accountId) {
      return { ok: false, message: 'You cannot share with yourself.' } satisfies ActionState;
    }
    let stepUpSatisfied = false;
    if (isSensitive) {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'SHARE', resourceId: applicantId },
        `/app/applicant/${applicantId}/sharing`,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      stepUpSatisfied = true;
    }
    if (invitationsEnabled) {
      const encryption = createKeyManagementPort();
      if (!encryption)
        return { ok: false, message: 'Invitations are temporarily unavailable. Try again later.' };
      const invitation = await createSharingInvitation(db, {
        actorAccountId: accountId,
        applicantId,
        email: recipientEmail,
        actions,
        purpose,
        stepUpSatisfied,
        encryption,
        ...(categories.length ? { categories } : {}),
        ...(documentIds.length ? { documentIds } : {}),
        ...(expiryAt ? { expiryAt } : {}),
      });
      if (!invitation.ok) return { ok: false, message: invitation.error.message };
      return {
        ok: true,
        message:
          'Invitation created. Email queued. They can create an account or sign in, then review and accept. You can also share the link below.',
        invitationUrl: `${resolveBaseUrl()}/invitation?kind=sharing&token=${invitation.value.rawToken}`,
      };
    }
    if (!recipient) return { ok: false, message: 'Recipient account unavailable.' };
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

  if (result.ok) {
    if (!result.invitationUrl) revalidatePath(`/app/applicant/${applicantId}/sharing`);
    if (result.invitationUrl)
      after(() =>
        triggerNotificationWorker({ limit: 4, timeBudgetMs: 5000 }).then(() => undefined),
      );
  }
  return result;
}

/** Revoke, pause, or resume a grant (applicant owner). */
export async function updateGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
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
  // A full page request refreshes the dynamic grant list after the result reaches
  // the client. Never derive that destination from the hidden route identifier.
  return {
    ok: true,
    message: 'Access updated.',
    refreshPath: `/app/applicant/${result.value.applicantId}/sharing`,
  };
}

/**
 * Widen a category grant's scope to specific, newly matching documents the
 * owner just confirmed (PRD SHR-01: "expanding scope requires a displayed
 * confirmation"). `documentId` values come only from the checkboxes the
 * owner was actually shown on this page, never a freeform list.
 */
export async function expandGrantScopeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const grantId = String(formData.get('grantId') ?? '');
  const documentIds = formData.getAll('documentId').map(String);
  if (documentIds.length === 0) {
    return { ok: false, message: 'Select at least one document to include.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const expanded = await expandGrantScope(db, {
      actorAccountId: accountId,
      grantId,
      documentIds,
    });
    if (!expanded.ok) return { ok: false, message: expanded.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `${documentIds.length} document${documentIds.length === 1 ? '' : 's'} added to this grant.`,
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return result;
}

export async function revokeSharingInvitationAction(formData: FormData): Promise<void> {
  if (process.env[sharingInvitationFlag] !== 'true') return;
  const id = String(formData.get('invitationId') ?? '');
  const result = await withSession(({ db, accountId }) =>
    revokeSharingInvitation(db, accountId, id),
  );
  const applicantId = String(formData.get('applicantId') ?? '');
  if (!result.ok)
    redirect(
      `/app/applicant/${encodeURIComponent(applicantId)}/sharing?error=${encodeURIComponent(result.error.message)}`,
    );
  revalidatePath(`/app/applicant/${applicantId}/sharing`);
}

/**
 * "Allow This Case": removes one per-case sharing exception, so the all-cases
 * access covers this case again. Checked through the central access gate on
 * the case itself (owner only). A fresh sign-in is asked for only when the
 * access hands out downloads of originals, profile export or re-sharing, the
 * same rule as creating it. The recipient is not told.
 */
export async function allowCaseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const grantId = String(formData.get('grantId') ?? '');
  if (missionId.length === 0 || grantId.length === 0) {
    return { ok: false, message: 'Choose the case to allow.' };
  }
  const returnTo = `/app/applicant/${applicantId}/sharing`;

  const result = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { missionId },
      { purpose: 'owner_case_sharing' },
    );
    if (!access.ok || access.value.applicant.id !== applicantId) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    let removed = await removeCaseException(access.value, { grantId });
    if (!removed.ok && removed.error.code === 'step_up_required') {
      const stepUp = await establishStepUpProof(
        { accountId, action: 'SHARE', resourceId: applicantId },
        returnTo,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      removed = await removeCaseException(access.value, { grantId, stepUp: stepUp.proof });
    }
    if (!removed.ok) return { ok: false, message: removed.error.message } satisfies ActionState;
    return {
      ok: true,
      message: 'This case is shared again.',
      refreshPath: returnTo,
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(returnTo);
  return result;
}
