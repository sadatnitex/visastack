import { CORRECTION_DETAIL_MAX, cleanOfficialUrl } from '@visastack/services';
import type { FormResult } from '../components/form-feedback';

/**
 * UMPE P11: the fields of Suggest a Checklist Correction, read from a form and checked before the
 * service checks them again, so each problem is shown beside its own field.
 */
export interface CorrectionFields {
  readonly packRequirementId: string | null;
  readonly category: string;
  readonly officialUrl: string;
  readonly detail: string;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

export function readCorrectionFields(formData: FormData): CorrectionFields | FormResult {
  const category = text(formData, 'category');
  if (category.length === 0) {
    return { ok: false, message: 'Choose what looks wrong.', field: 'category' };
  }
  const officialUrl = text(formData, 'officialUrl');
  const link = cleanOfficialUrl(officialUrl);
  if (link !== null && typeof link === 'object') {
    return { ok: false, message: link.error, field: 'officialUrl' };
  }
  // A browser sends each line break as two characters; count it as the one the person typed.
  const detail = text(formData, 'detail').replace(/\r\n?/g, '\n');
  if (detail.length > CORRECTION_DETAIL_MAX) {
    return { ok: false, message: 'Keep it under 1,000 characters.', field: 'detail' };
  }
  const item = text(formData, 'packRequirementId');
  if (item.length === 0 && category !== 'MISSING') {
    return {
      ok: false,
      message: 'Choose the item this is about, or choose Something Is Missing.',
      field: 'packRequirementId',
    };
  }
  return { packRequirementId: item.length > 0 ? item : null, category, officialUrl, detail };
}

export function isCorrectionFields(
  value: CorrectionFields | FormResult,
): value is CorrectionFields {
  return 'category' in value;
}

export const CORRECTION_SENT =
  'Thank you. Pack editors will check this against the official source. Your checklist stays as it is until a corrected version is published.';
export const CORRECTION_ALREADY_SENT =
  'You already sent this suggestion. Pack editors will check it against the official source.';
