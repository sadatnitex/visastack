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
  'Turning a feature off stops only new use of it. It never removes anything people already have: suggestions waiting for them stay there to accept or skip, earlier readings and explanations stay readable, and drafts stay readable, copyable and deletable. Where its button was, people see one short sentence instead. Everything else in VisaStack keeps working.';

/** How the switches combine (S28), and when a day's count starts again. */
export const PRECEDENCE_NOTE =
  'A feature works for a person only when the platform can run it, it is on here, the person’s plan includes it and today’s limit is not used up. A limit here can only lower the plan’s. Each use is counted per UTC day, so limits start again at 6 AM Bangladesh time.';

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
