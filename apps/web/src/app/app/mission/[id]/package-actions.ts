'use server';

import {
  type PackageChoiceInput,
  confirmPackageHandoff,
  markPackageChangeReviewed,
  recordPackageChoice,
} from '@visastack/services';
import type { FormResult } from '../../../../components/form-feedback';
import { refusalText } from '../../../../lib/service-error-message';
import { UUID, withCaseProof } from './with-case-proof';

type ActionState = FormResult;

/**
 * UMPE P4: the trip package's three actions on the case page (choose a copy or leave an item
 * out, mark the change as reviewed, confirm Prepared for Handoff). Each runs through the access
 * gate for the owner of this one case; the service checks everything again.
 */

/** One choice value from the form: a copy (`d:<id>` or `f:<id>`), `missing`, `exclude` or `clear`. */
function readChoice(missionId: string, formData: FormData): PackageChoiceInput | string {
  const packRequirementId = String(formData.get('packRequirementId') ?? '');
  const value = String(formData.get('choice') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!UUID.test(packRequirementId)) return 'This item is not on the checklist.';
  if (value === 'missing') {
    return { missionId, packRequirementId, choice: 'LEAVE_MISSING', reason };
  }
  if (value === 'clear') return { missionId, packRequirementId, choice: 'CLEAR' };
  if (value === 'exclude') {
    if (reason.length === 0) return 'Say in a few words why you are leaving this out.';
    return { missionId, packRequirementId, choice: 'EXCLUDE', reason };
  }
  const [kind, id] = value.split(':');
  if (!id || !UUID.test(id)) return 'Choose what to use for this item.';
  if (kind === 'd')
    return { missionId, packRequirementId, choice: 'USE_COPY', documentVersionId: id };
  if (kind === 'f') return { missionId, packRequirementId, choice: 'USE_COPY', factVersionId: id };
  return 'Choose what to use for this item.';
}

export async function recordPackageChoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const input = readChoice(missionId, formData);
  if (typeof input === 'string') {
    return {
      ok: false,
      message: input,
      ...(input.startsWith('Say') ? { field: 'reason' } : { field: 'choice' }),
    };
  }
  return withCaseProof(missionId, 'packageAction', async (proof) => {
    const saved = await recordPackageChoice(proof, input);
    if (!saved.ok) return { ok: false, message: await refusalText(saved.error) };
    return { ok: true, message: 'Choice saved. Your package is up to date.' };
  });
}

export async function markPackageChangeReviewedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  return withCaseProof(missionId, 'packageAction', async (proof) => {
    const reviewed = await markPackageChangeReviewed(proof, missionId);
    if (!reviewed.ok) return { ok: false, message: await refusalText(reviewed.error) };
    return { ok: true, message: 'Marked as reviewed.' };
  });
}

export async function confirmPackageHandoffAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  if (formData.get('outsideStepsSeen') !== 'yes') {
    return {
      ok: false,
      message: 'Confirm that you have read the steps outside VisaStack.',
      field: 'outsideStepsSeen',
    };
  }
  return withCaseProof(missionId, 'packageAction', async (proof) => {
    const confirmed = await confirmPackageHandoff(proof, { missionId, outsideStepsSeen: true });
    if (!confirmed.ok) return { ok: false, message: await refusalText(confirmed.error) };
    return {
      ok: true,
      message: 'Prepared for Handoff. Nothing has been sent to anyone.',
    };
  });
}
