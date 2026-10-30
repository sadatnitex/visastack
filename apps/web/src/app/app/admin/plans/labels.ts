import { AI_FEATURES, AI_FEATURE_KEYS, type AiFeatureKey } from '@visastack/core/ai-features';
import {
  CAPACITY_ENTITLEMENTS,
  CAPACITY_KEYS,
  type CapacityKey,
  aiEntitlementKey,
} from '@visastack/core/entitlements';
import type { FormResult } from '../../../../components/form-feedback';

/**
 * Words and field names of the Plans page (S29), shared by the page, its forms and its actions.
 * Browser-safe: no service code.
 */

/** One megabyte as Storage is typed on this page (the same unit Plan and Usage shows). */
export const BYTES_PER_MB = 1024 * 1024;

/** The form field of each capacity limit and each AI feature. */
export const limitField = (key: CapacityKey): string => `limit.${key}`;
export const featureOnField = (feature: AiFeatureKey): string => `on.${feature}`;
export const featureLimitField = (feature: AiFeatureKey): string =>
  `limit.${aiEntitlementKey(feature)}`;

/** Every field a plan form sends, so a reply can carry back exactly what was typed. */
export function planFieldNames(): string[] {
  return [
    'name',
    'periodDays',
    'price',
    'currency',
    ...CAPACITY_KEYS.map(limitField),
    ...AI_FEATURE_KEYS.flatMap((f) => [featureOnField(f), featureLimitField(f)]),
  ];
}

/** The label of each capacity field, in the vocabulary's names. */
export function capacityLabel(key: CapacityKey): string {
  return key === 'storage_bytes' ? 'Storage (MB)' : CAPACITY_ENTITLEMENTS[key].name;
}

export const UNLIMITED_HINT = 'Leave empty for Unlimited.';

/**
 * The limits the Plans page edits. Team Members and Invitations is not among them: it always
 * follows Team Members (round 2), and its key stays internal.
 */
export const EDITABLE_CAPACITY_KEYS: readonly CapacityKey[] = CAPACITY_KEYS.filter(
  (key) => key !== 'invitations',
);

/** Traveller Free's limits are not enforced on travellers, so the page does not offer them. */
export const TRAVELLER_LIMITS_NOTE =
  'Travellers have no plan limits to set: their uploads follow the platform storage rules.';

/** Agencies have no AI features of their own yet (S22, S28). */
export const AGENCY_AI_NOTE =
  'AI features for agencies come in a later update. Traveller AI limits are set on Traveller Free.';

/** Said in the card once a plan is retired. */
export const RETIRED_LINE = 'Retired. Nobody new can be put on this plan.';
export const AI_ALLOWANCE_HINT =
  'Shown on Plan and Usage for now; it does not stop any work yet. Leave empty for Unlimited.';
export const AI_LIMIT_HINT =
  'Uses per person per day, from 1 to 1000, while the feature is on. Leave it empty for no plan limit: the daily limit set on the AI Features page still applies. A limit typed for a feature that is off is not kept.';

/** S29 plan decision: a price change never touches a period already under way. */
export const PRICE_CHANGE_NOTE =
  "Applies from each agency's next billing period. Invoices already made keep their amounts.";

export const PERIOD_LOCKED_NOTE =
  'The billing period is fixed now that an agency has been on this plan.';

export const RETIRE_NOTE =
  'Retiring a plan means nobody new can be put on it. Agencies already on it keep it, with its limits and price.';

/** What the owner typed (field name to text), sent back with every reply so nothing is lost. */
export type PlanFormValues = Readonly<Record<string, string>>;

export interface PlanFormState extends FormResult {
  readonly values?: PlanFormValues;
  /**
   * Set when the price changed and the change must be confirmed before saving: the price now
   * (null for none) and the new one, as people read them.
   */
  readonly pricePreview?: { readonly before: string | null; readonly after: string };
}

export interface RetireFormState extends FormResult {
  /** Set after the first press: how many agencies keep the plan. */
  readonly agenciesKeepingIt?: number;
  /** Set when scheduled plan changes to it must be cancelled first: why, in plain words. */
  readonly waiting?: string;
  /** Set once the plan is retired. */
  readonly retired?: true;
}

/** "3 Agencies" or "1 Traveller", for the list. */
export function onItWords(count: number, audience: 'AGENCY' | 'TRAVELLER'): string {
  const noun = audience === 'TRAVELLER' ? 'Traveller' : 'Agency';
  if (count === 1) return `1 ${noun}`;
  return `${count} ${audience === 'TRAVELLER' ? 'Travellers' : 'Agencies'}`;
}

/** What one AI feature looks like in the list: "On, 15 a Day" or "Off". */
export function aiFeatureSummary(rule: {
  readonly included: boolean;
  readonly limit: number | null;
}): string {
  if (!rule.included) return 'Off';
  return rule.limit === null ? 'On' : `On, ${rule.limit} a Day`;
}

/** The AI feature names, for the forms. */
export function aiFeatureName(feature: AiFeatureKey): string {
  return AI_FEATURES[feature].name;
}
