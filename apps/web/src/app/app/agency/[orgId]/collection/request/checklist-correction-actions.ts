'use server';

import { agencyCollectionPrincipal, suggestAgencyChecklistCorrection } from '@visastack/services';
import { unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../../../components/form-feedback';
import {
  CORRECTION_ALREADY_SENT,
  CORRECTION_SENT,
  isCorrectionFields,
  readCorrectionFields,
} from '../../../../../../lib/checklist-correction-input';
import { reportServerError } from '../../../../../../lib/server-error';
import { withSession } from '../../../../../../lib/session';

const NOT_AVAILABLE = 'This request is not available. Reload the page and try again.';

/**
 * UMPE P11: an agency owner or admin suggests a correction on the official checklist one of their
 * requests follows. Re-checks, live, that the person may act for this agency; the service checks
 * the request is this agency's and the item is on its official checklist. Nothing on the request,
 * its issued revisions or the checklist changes.
 */
export async function suggestAgencyCorrectionAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const fields = readCorrectionFields(formData);
  if (!isCorrectionFields(fields)) return fields;
  try {
    return await withSession(async ({ db, accountId }) => {
      const scope = await agencyCollectionPrincipal(db, accountId, organizationId);
      if (!scope.ok) return { ok: false, message: NOT_AVAILABLE } satisfies FormResult;
      const sent = await suggestAgencyChecklistCorrection(db, scope.value, {
        requestId,
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
    unstable_rethrow(error);
    reportServerError('suggestAgencyCorrection', error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
}
