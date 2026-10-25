'use server';

import {
  DOCUMENT_PROTECTION_REASON_MAX,
  DOCUMENT_PROTECTION_REASON_REQUIRED,
  type DocumentProtectionScope,
  setDocumentProtection,
  staffPrincipal,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';

const DOCUMENT_PROTECTION_PATH = '/app/admin/document-protection';

const SCOPES: readonly DocumentProtectionScope[] = ['CATEGORY', 'DOCUMENT_TYPE', 'UNKNOWN_TYPE'];
const CHOICES = ['on', 'off', 'default'] as const;
type Choice = (typeof CHOICES)[number];

const DENIED: FormResult = {
  ok: false,
  message: 'Only a security admin or platform owner can change document protection.',
};

const CONFIRM_FIRST: FormResult = {
  ok: false,
  message: 'Confirm that you want to turn this protection off.',
};

/** Owner decision 2026-10-25: removing protection always needs a reason. */
const REASON_FIRST: FormResult = {
  ok: false,
  message: DOCUMENT_PROTECTION_REASON_REQUIRED,
  field: 'reason',
};

const DONE: Record<Choice, string> = {
  on: 'Saved. Travellers and agencies now confirm it is them before opening these documents.',
  off: 'Saved. These documents now open without a fresh sign-in check.',
  default: 'Saved. This switch is back to the standard setting.',
};

/**
 * Turn one document protection switch on or off, or back to the standard
 * setting. Removing protection must be confirmed on the page, needs a reason,
 * and then a fresh sign-in check (the same re-check the other admin pages
 * use); the service decides when a change removes protection, against the
 * live state, and records every change.
 */
export async function setDocumentProtectionAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const scope = String(formData.get('scope') ?? '') as DocumentProtectionScope;
  const key = String(formData.get('key') ?? '').trim();
  const choice = String(formData.get('choice') ?? '') as Choice;
  const reason = String(formData.get('reason') ?? '').trim();
  if (!SCOPES.includes(scope) || key.length === 0 || !CHOICES.includes(choice)) {
    return { ok: false, message: 'That switch could not be found. Reload the page and try again.' };
  }
  if (reason.length > DOCUMENT_PROTECTION_REASON_MAX) {
    return {
      ok: false,
      message: `Keep the reason under ${DOCUMENT_PROTECTION_REASON_MAX} characters.`,
      field: 'reason',
    };
  }
  const removalConfirmed = formData.get('confirmed') === 'yes';
  // Turning off always removes protection. Going back to a standard setting
  // may too; the service checks that against the live state and refuses an
  // unconfirmed removal the same way.
  if (choice === 'off' && !removalConfirmed) return CONFIRM_FIRST;
  if (choice === 'off' && reason.length === 0) return REASON_FIRST;
  const restricted = choice === 'default' ? null : choice === 'on';

  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'DOCUMENT_PROTECTION_MANAGE',
    );
    if (!staff.ok) return DENIED;
    const input = { scope, key, restricted, removalConfirmed, ...(reason ? { reason } : {}) };

    let result = await setDocumentProtection(db, staff.value, { ...input, stepUpSatisfied: false });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'DOCUMENT_PROTECTION_CHANGE', resourceId: `${scope}:${key}` },
        DOCUMENT_PROTECTION_PATH,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies FormResult;
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      result = await setDocumentProtection(db, staff.value, { ...input, stepUpSatisfied: true });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return DENIED;
      // Going back to a standard setting that is off is a removal too.
      if (result.error.message === DOCUMENT_PROTECTION_REASON_REQUIRED) return REASON_FIRST;
      return {
        ok: false,
        message: 'This change could not be saved. Reload the page and try again.',
      };
    }
    if (result.value.confirmationRequired) return CONFIRM_FIRST;
    if (!result.value.changed) {
      return { ok: true, message: 'Nothing to change. This switch already works this way.' };
    }
    revalidatePath(DOCUMENT_PROTECTION_PATH);
    return { ok: true, message: DONE[choice] };
  });
}
