import { AI_FEATURES, AI_FEATURE_KEYS, type AiFeatureKey } from '@visastack/core/ai-features';
import {
  CAPACITY_ENTITLEMENTS,
  CAPACITY_KEYS,
  type CapacityKey,
  TRAVELLER_STORAGE_ENTITLEMENTS,
  TRAVELLER_STORAGE_KEYS,
  type TravellerStorageKey,
  aiEntitlementKey,
} from '@visastack/core/entitlements';
import type { FormResult } from '../../../../components/form-feedback';

/**
 * Words and field names of the Plans page (S29), shared by the page, its forms and its actions.
 * Browser-safe: no service code.
 */

/** One megabyte as Storage is typed on this page (the same unit Plan and Usage shows). */
export const BYTES_PER_MB = 1024 * 1024;

/** The form field of each capacity limit, traveller storage rule and AI feature. */
export const limitField = (key: CapacityKey | TravellerStorageKey): string => `limit.${key}`;
export const featureOnField = (feature: AiFeatureKey): string => `on.${feature}`;
export const featureLimitField = (feature: AiFeatureKey): string =>
  `limit.${aiEntitlementKey(feature)}`;

/**
 * The Storage the form showed, in whole MB (S29 round 3). Storage is shown rounded, so a saved
 * plan's Storage is written only when the typed value differs from it: saving other fields never
 * moves a limit that is not a whole number of MB.
 */
export const shownField = (key: 'storage_bytes' | TravellerStorageKey): string => `shown.${key}`;
export const STORAGE_SHOWN_FIELD = shownField('storage_bytes');

/** Which kind of plan a form edits: its fields and words differ (ADR 0025). */
export type PlanKind = 'agency' | 'traveller_free' | 'traveller';

/** Every storage field whose shown value guards against rounding, by plan kind. */
export function storageKeysOf(kind: PlanKind): readonly ('storage_bytes' | TravellerStorageKey)[] {
  if (kind === 'agency') return ['storage_bytes'];
  return kind === 'traveller' ? TRAVELLER_STORAGE_KEYS : [];
}

/** Every field a plan form sends, so a reply can carry back exactly what was typed. */
export function planFieldNames(): string[] {
  return [
    'name',
    'periodDays',
    'price',
    'currency',
    ...CAPACITY_KEYS.map(limitField),
    ...TRAVELLER_STORAGE_KEYS.map(limitField),
    ...AI_FEATURE_KEYS.flatMap((f) => [featureOnField(f), featureLimitField(f)]),
  ];
}

/** The label of each capacity field, in the vocabulary's names. */
export function capacityLabel(key: CapacityKey): string {
  return key === 'storage_bytes' ? 'Storage (MB)' : CAPACITY_ENTITLEMENTS[key].name;
}

export const UNLIMITED_HINT = 'Leave empty for Unlimited.';

/** The label of a traveller storage field. */
export function travellerStorageLabel(key: TravellerStorageKey): string {
  return `${TRAVELLER_STORAGE_ENTITLEMENTS[key].name} (MB)`;
}

/** "120 MB", from bytes, as the Plans page shows storage. */
export function mbText(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MB).toLocaleString('en-US')} MB`;
}

/** The hint under a traveller storage field, with the upload setting it follows when empty. */
export function travellerStorageHint(settingBytes: number): string {
  return `Leave empty to follow the upload settings (now ${mbText(settingBytes)}). It cannot be less than on Traveller Free.`;
}

/** Traveller Free's storage, in its card and form (ADR 0025 D10). */
export function travellerFreeStorageNote(accountBytes: number, personBytes: number): string {
  return `Traveller Free follows the upload settings for storage: ${mbText(accountBytes)} for the whole account and ${mbText(personBytes)} per person. Set more storage on a paid traveller plan.`;
}

/** A traveller plan's price: in BDT only, and a period already paid is never repriced. */
export const TRAVELLER_PRICE_NOTE =
  'Traveller plans are sold in BDT. Leave the amount empty while the plan is not for sale. A new price applies to purchases from now; a period already paid is never repriced.';

/** Said on every paid traveller plan until buying is switched on (ADR 0025 section 9). */
export const TRAVELLER_SELLING_NOTE =
  'Travellers cannot buy a plan yet: buying arrives in a later update. Until then nobody is charged, and nothing changes for travellers.';

/** A paid traveller plan gives at least what Traveller Free gives (ADR 0025 D1). */
export const TRAVELLER_FLOOR_NOTE =
  'A paid traveller plan gives more room than Traveller Free, never less: its storage and daily limits cannot be lower.';

/**
 * The limits the Plans page edits. Team Members and Invitations is not among them: it always
 * follows Team Members (round 2), and its key stays internal.
 */
export const EDITABLE_CAPACITY_KEYS: readonly CapacityKey[] = CAPACITY_KEYS.filter(
  (key) => key !== 'invitations',
);

/** Agency plans decide the agency AI features (S22); the traveller ones are set on Traveller Free. */
export const AGENCY_AI_NOTE = 'Traveller AI limits are set on Traveller Free.';

/** The daily limit of an agency AI feature: one count for the whole agency (S22). */
export const AGENCY_AI_LIMIT_HINT =
  'Uses per agency per day, for all its staff together, from 1 to 1000, while the feature is on. Leave it empty for no plan limit: the daily limit set on the AI Features page still applies.';

/** Said in the card once a plan is retired. */
export const RETIRED_LINE = 'Retired. Nobody new can be put on this plan.';
export const TRAVELLER_RETIRED_LINE =
  'Retired. Nobody new can buy this plan; people on it keep it until the period they paid for ends.';
export const AI_ALLOWANCE_HINT =
  'Shown on Plan and Usage for now; it does not stop any work yet. Leave empty for Unlimited.';
export const AI_LIMIT_HINT =
  'Uses per person per day, from 1 to 1000, while the feature is on. Leave it empty for no plan limit: the daily limit set on the AI Features page still applies. A limit typed for a feature that is off is not kept.';

/** Said before a traveller plan's new price is saved (ADR 0025 section 12.1). */
export const TRAVELLER_PRICE_CHANGE_STEP =
  'It applies to purchases from now. A period already paid is never repriced.';

/** S29 plan decision: a price change never touches a period already under way. */
export const PRICE_CHANGE_NOTE =
  "Applies from each agency's next billing period. Invoices already made keep their amounts.";

export const PERIOD_LOCKED_NOTE =
  'The billing period is fixed now that an agency has been on this plan.';
export const TRAVELLER_PERIOD_LOCKED_NOTE =
  'The period is fixed now that someone has been on this plan.';

export const RETIRE_NOTE =
  'Retiring a plan means nobody new can be put on it. Agencies already on it keep it, with its limits and price.';
export const TRAVELLER_RETIRE_NOTE =
  'Retiring a plan means nobody new can buy it. People already on it keep it until the period they paid for ends.';

/** How many keep a plan being retired: agencies, or people on a traveller plan. */
export function keepingWords(count: number, audience: 'AGENCY' | 'TRAVELLER'): string {
  const one = audience === 'TRAVELLER' ? 'person' : 'agency';
  const many = audience === 'TRAVELLER' ? 'people' : 'agencies';
  if (count === 0) {
    return audience === 'TRAVELLER'
      ? 'No one is on this plan now.'
      : 'No agency is on this plan now.';
  }
  return count === 1
    ? `1 ${one} is on this plan now and keeps it.`
    : `${count} ${many} are on this plan now and keep it.`;
}

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
  /** Set after the first press: how many agencies (or people, on a traveller plan) keep it. */
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
