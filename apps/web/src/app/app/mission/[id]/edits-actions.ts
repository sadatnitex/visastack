'use server';

import { accountPrincipal, requireAccess, setChecklistWording } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';

/**
 * A traveller rewords one item of the checklist on their own case. It runs through the access gate
 * for the owner of this one case, and the service checks everything again. The words are display
 * only: nothing here changes what the case needs.
 */

const CASE_UNAVAILABLE = 'This case is not available to you.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveWordingAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const missionId = String(formData.get('missionId') ?? '');
  const packRequirementId = String(formData.get('packRequirementId') ?? '');
  // The Back to Original button sends an empty sentence, which puts the original back.
  const wording =
    formData.get('intent') === 'original' ? '' : String(formData.get('wording') ?? '');
  if (!UUID.test(missionId)) return { ok: false, message: CASE_UNAVAILABLE };
  if (!UUID.test(packRequirementId)) {
    return { ok: false, message: 'That item is not on this checklist.' };
  }
  try {
    const outcome = await withSession(async ({ db, accountId }) => {
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { missionId },
        { purpose: 'self' },
      );
      if (!proof.ok) return { ok: false, message: CASE_UNAVAILABLE } satisfies FormResult;
      const saved = await setChecklistWording(proof.value, {
        missionId,
        packRequirementId,
        wording,
      });
      if (!saved.ok) return { ok: false, message: saved.error.message } satisfies FormResult;
      return {
        ok: true,
        message: saved.value.wording === null ? 'Original wording is back.' : 'Wording saved.',
      } satisfies FormResult;
    });
    if (outcome.ok) revalidatePath(`/app/mission/${missionId}`);
    return outcome;
  } catch (error) {
    // Signing in again (a redirect) goes ahead; anything else is a failed try they can repeat.
    unstable_rethrow(error);
    reportServerError('checklistWording', error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
}
