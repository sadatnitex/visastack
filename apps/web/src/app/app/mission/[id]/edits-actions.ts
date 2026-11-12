'use server';

import { setChecklistWording, tidyWording } from '@visastack/services';
import type { FormResult } from '../../../../components/form-feedback';
import { refusalText } from '../../../../lib/service-error-message';
import { UUID, withCaseProof } from './with-case-proof';

/**
 * A traveller rewords one item of the checklist on their own case. It runs through the access gate
 * for the owner of this one case, and the service checks everything again. The words are display
 * only: nothing here changes what the case needs.
 */

export async function saveWordingAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const missionId = String(formData.get('missionId') ?? '');
  const packRequirementId = String(formData.get('packRequirementId') ?? '');
  if (!UUID.test(packRequirementId)) {
    return { ok: false, message: 'That item is not on this checklist.' };
  }
  // Back to Original sends no sentence. So does typing the original just as it is shown, which only
  // this page can tell (the service does not know how an item is named on screen).
  const typed = tidyWording(String(formData.get('wording') ?? ''));
  const shownOriginal = tidyWording(String(formData.get('original') ?? ''));
  const wording =
    formData.get('intent') === 'original' || (shownOriginal !== '' && typed === shownOriginal)
      ? ''
      : typed;
  return withCaseProof(missionId, 'checklistWording', async (proof) => {
    const saved = await setChecklistWording(proof, { missionId, packRequirementId, wording });
    if (!saved.ok) return { ok: false, message: await refusalText(saved.error) };
    return {
      ok: true,
      message: saved.value.wording === null ? 'Original wording is back.' : 'Wording saved.',
    };
  });
}
