'use server';

import {
  accountPrincipal,
  requireAccess,
  suggestCaseChecklistCorrection,
} from '@visastack/services';
import { unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import {
  CORRECTION_ALREADY_SENT,
  CORRECTION_SENT,
  isCorrectionFields,
  readCorrectionFields,
} from '../../../../lib/checklist-correction-input';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_UNAVAILABLE = 'This case is not available to you.';

/**
 * UMPE P11: Suggest a Checklist Correction from a line of the traveller's own case checklist. Only
 * the case owner, through the access gate; the service checks the item belongs to the case's own
 * checklist version. Nothing on the case or the checklist changes.
 */
export async function suggestCaseCorrectionAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const missionId = String(formData.get('missionId') ?? '');
  if (!UUID.test(missionId)) return { ok: false, message: CASE_UNAVAILABLE };
  const fields = readCorrectionFields(formData);
  if (!isCorrectionFields(fields)) return fields;
  try {
    return await withSession(async ({ db, accountId }) => {
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { missionId },
        { purpose: 'self' },
      );
      if (!proof.ok) return { ok: false, message: CASE_UNAVAILABLE } satisfies FormResult;
      const sent = await suggestCaseChecklistCorrection(proof.value, {
        missionId,
        packRequirementId: fields.packRequirementId,
        category: fields.category,
        officialUrl: fields.officialUrl,
        detail: fields.detail,
      });
      if (!sent.ok) return { ok: false, message: sent.error.message } satisfies FormResult;
      return {
        ok: true,
        message: sent.value.duplicate ? CORRECTION_ALREADY_SENT : CORRECTION_SENT,
      } satisfies FormResult;
    });
  } catch (error) {
    // Signing in again (a redirect) goes ahead; anything else is a failed try they can repeat.
    unstable_rethrow(error);
    reportServerError('suggestCaseCorrection', error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
}
