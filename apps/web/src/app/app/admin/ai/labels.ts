import type { FormResult } from '../../../../components/form-feedback';

/** What the platform owner typed for one feature, sent back with every reply so nothing is lost. */
export interface AiFeatureValues {
  readonly enabled: boolean;
  readonly dailyLimit: string;
}

export interface AiFeatureFormState extends FormResult {
  readonly values?: AiFeatureValues;
}

/** What turning a feature off does, in the page's own words. */
export const WHAT_OFF_DOES =
  'Turning a feature off stops only new use of it. It never removes anything people already have: suggestions waiting for them stay there to accept or skip, and drafts stay readable, copyable and deletable. Everything else in VisaStack keeps working.';

export const LIMIT_NOTE =
  'Leave Daily Limit per Person empty to use the plan’s limit. A number here can only lower it, never raise it above the plan.';

/** "15 a day (the plan’s limit)" or "5 a day (lowered from the plan’s 15)". */
export function limitLine(adminLimit: number | null, planLimit: number | null): string {
  if (planLimit === null && adminLimit === null) return 'No daily limit';
  if (adminLimit === null || (planLimit !== null && adminLimit >= planLimit)) {
    return `${planLimit} a day (the plan’s limit)`;
  }
  return planLimit === null
    ? `${adminLimit} a day`
    : `${adminLimit} a day (lowered from the plan’s ${planLimit})`;
}
