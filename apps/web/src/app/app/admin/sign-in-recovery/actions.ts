'use server';

import {
  SIGN_IN_RECOVERY_REASON_MAX,
  SIGN_IN_RECOVERY_REFUSED,
  connectSignInToAccount,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';

const SIGN_IN_RECOVERY_PATH = '/app/admin/sign-in-recovery';

const DENIED: FormResult = {
  ok: false,
  message: 'Only a security admin or platform owner can connect a sign-in.',
};

const REFUSED: Record<string, string> = {
  [SIGN_IN_RECOVERY_REFUSED.alreadyConnected]:
    'This account already has a sign-in. Nothing was changed.',
  [SIGN_IN_RECOVERY_REFUSED.noAttempt]:
    'There is no recent sign-in to connect. Ask the person to create their sign-in again, then reload this page.',
  [SIGN_IN_RECOVERY_REFUSED.ambiguous]:
    'More than one new sign-in tried to reach this account, so it cannot be connected safely. Nothing was changed.',
  [SIGN_IN_RECOVERY_REFUSED.identityTaken]:
    'That sign-in already opens another account. Nothing was changed.',
  [SIGN_IN_RECOVERY_REFUSED.ownerOnly]:
    'This account holds a platform role, so only a platform owner can connect it.',
};

/**
 * Connect the confirmed new sign-in that recently tried to reach an older account. A confirmation
 * on the page and a reason come first, then a fresh sign-in check; the service re-checks every
 * rule against the live data and records the change.
 */
export async function connectSignInAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const accountId = String(formData.get('accountId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (formData.get('confirmed') !== 'yes') {
    return { ok: false, message: 'Confirm that you checked with the person first.' };
  }
  if (reason.length === 0) {
    return { ok: false, message: 'Say how you checked with the person.', field: 'reason' };
  }
  if (reason.length > SIGN_IN_RECOVERY_REASON_MAX) {
    return {
      ok: false,
      message: `Keep the reason under ${SIGN_IN_RECOVERY_REASON_MAX} characters.`,
      field: 'reason',
    };
  }

  return withSession(async ({ db, accountId: staffAccountId, email }) => {
    const owner = { accountId: staffAccountId, email, bootstrapEmails: bootstrapAdminEmails() };
    const staff = await staffPrincipal(db, owner, 'ACCOUNT_SIGN_IN_RECOVERY');
    if (!staff.ok) return DENIED;
    const input = { accountId, reason, owner };

    let result = await connectSignInToAccount(db, staff.value, {
      ...input,
      stepUpSatisfied: false,
    });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId: staffAccountId, action: 'ACCOUNT_SIGN_IN_RECOVERY', resourceId: accountId },
        SIGN_IN_RECOVERY_PATH,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies FormResult;
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      result = await connectSignInToAccount(db, staff.value, { ...input, stepUpSatisfied: true });
    }
    if (!result.ok) {
      const refused = REFUSED[result.error.message];
      if (refused) return { ok: false, message: refused };
      if (result.error.code === 'forbidden') return DENIED;
      return {
        ok: false,
        message: 'This sign-in could not be connected. Reload the page and try again.',
      };
    }
    revalidatePath(SIGN_IN_RECOVERY_PATH);
    return {
      ok: true,
      message:
        'Connected. The person can now sign in with their new password and reach their existing account.',
    };
  });
}
