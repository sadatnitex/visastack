import { AI_FEATURES, AI_FEATURE_KEYS, type AiFeatureKey } from './ai-features';

/**
 * Every entitlement a plan can carry, in one registry (S29, ADR 0020 S29 amendment). A plan's
 * rules are rows of `plan_entitlements`, one per plan and key; this file says what each key means,
 * what people call it (docs/uiux/ccd/VOCABULARY.md), how it counts, and in what unit. The
 * database checks the same key shapes and counting (`plan_entitlements_key_shape`,
 * `plan_entitlements_per_matches_key`, migration 0107).
 *
 * - Capacity keys are fixed: team members, invitations, new cases, open cases, storage and the AI
 *   allowance (shown only; enforcing it is a later package).
 * - AI feature keys are `ai.<feature>`, one per feature in `AI_FEATURES`, counted per person per
 *   day. Adding an AI feature adds its key here by itself.
 *
 * Pure and framework-free: safe to import in the browser.
 */

/** How a limit counts: in each billing period, each day, in total, or at the same time. */
export type EntitlementPer = 'PERIOD' | 'DAY' | 'TOTAL' | 'CONCURRENT';

/** What a limit counts. */
export type EntitlementUnit = 'people' | 'cases' | 'bytes' | 'units' | 'uses';

export interface EntitlementDefinition {
  readonly key: string;
  /** Title Case, as Plan and Usage and the Plans page name it. */
  readonly name: string;
  readonly unit: EntitlementUnit;
  readonly per: EntitlementPer;
  /** One plain sentence: what is counted. `{days}` stands for the plan's period length. */
  readonly definition: string;
  /** Shown on Plan and Usage but never enforced yet. */
  readonly shownOnly: boolean;
}

export const CAPACITY_ENTITLEMENTS = {
  seats: {
    key: 'seats',
    name: 'Team Members',
    unit: 'people',
    per: 'CONCURRENT',
    definition: 'People with an active place in your agency.',
    shownOnly: false,
  },
  invitations: {
    key: 'invitations',
    name: 'Team Members and Invitations',
    unit: 'people',
    per: 'CONCURRENT',
    definition: 'People with an active place in your agency, plus invitations not yet answered.',
    shownOnly: false,
  },
  cases_per_period: {
    key: 'cases_per_period',
    name: 'New Cases',
    unit: 'cases',
    per: 'PERIOD',
    definition: 'Cases your agency started in the last {days} days.',
    shownOnly: false,
  },
  open_cases: {
    key: 'open_cases',
    name: 'Open Cases',
    unit: 'cases',
    per: 'CONCURRENT',
    definition: 'Cases of your agency that are not closed or cancelled yet.',
    shownOnly: false,
  },
  storage_bytes: {
    key: 'storage_bytes',
    name: 'Storage',
    unit: 'bytes',
    per: 'TOTAL',
    definition:
      'Files kept for every traveller who currently shares their record with your agency.',
    shownOnly: false,
  },
  ai_allowance_units: {
    key: 'ai_allowance_units',
    name: 'AI Allowance',
    unit: 'units',
    per: 'PERIOD',
    definition:
      'Automatic document reading used in the last {days} days for travellers who share their record with your agency.',
    shownOnly: true,
  },
} as const satisfies Readonly<Record<string, EntitlementDefinition>>;

export type CapacityKey = keyof typeof CAPACITY_ENTITLEMENTS;

export const CAPACITY_KEYS = Object.keys(CAPACITY_ENTITLEMENTS) as CapacityKey[];

/**
 * A traveller plan's storage rules (ADR 0025, migration 0111), apart from the agency capacity keys:
 * they belong to traveller plans only. A rule with no limit follows the upload settings, never
 * Unlimited, and the platform-wide storage stop always applies.
 */
export const TRAVELLER_STORAGE_ENTITLEMENTS = {
  account_storage_bytes: {
    key: 'account_storage_bytes',
    name: 'Storage for the Whole Account',
    unit: 'bytes',
    per: 'TOTAL',
    definition: 'Files kept for every person the account keeps a record for.',
    shownOnly: false,
  },
  person_storage_bytes: {
    key: 'person_storage_bytes',
    name: 'Storage per Person',
    unit: 'bytes',
    per: 'TOTAL',
    definition: 'Files kept for one person the account keeps a record for.',
    shownOnly: false,
  },
} as const satisfies Readonly<Record<string, EntitlementDefinition>>;

export type TravellerStorageKey = keyof typeof TRAVELLER_STORAGE_ENTITLEMENTS;

export const TRAVELLER_STORAGE_KEYS = Object.keys(
  TRAVELLER_STORAGE_ENTITLEMENTS,
) as TravellerStorageKey[];

export type AiEntitlementKey = `ai.${AiFeatureKey}`;

export type EntitlementKey = CapacityKey | TravellerStorageKey | AiEntitlementKey;

/** The entitlement key of an AI feature: `ai.<feature>`. */
export function aiEntitlementKey(feature: AiFeatureKey): AiEntitlementKey {
  return `ai.${feature}`;
}

/** The AI feature behind an `ai.<feature>` key, or null for any other text. */
export function aiFeatureOfKey(key: string): AiFeatureKey | null {
  if (!key.startsWith('ai.')) return null;
  const feature = key.slice(3);
  return Object.hasOwn(AI_FEATURES, feature) ? (feature as AiFeatureKey) : null;
}

export function isCapacityKey(key: string): key is CapacityKey {
  return Object.hasOwn(CAPACITY_ENTITLEMENTS, key);
}

export function isTravellerStorageKey(key: string): key is TravellerStorageKey {
  return Object.hasOwn(TRAVELLER_STORAGE_ENTITLEMENTS, key);
}

/** A key this registry defines (any other text is refused before it reaches the database). */
export function isEntitlementKey(key: string): key is EntitlementKey {
  return isCapacityKey(key) || isTravellerStorageKey(key) || aiFeatureOfKey(key) !== null;
}

/** The definition of any registered key. */
export function entitlementDefinition(key: EntitlementKey): EntitlementDefinition {
  if (isCapacityKey(key)) return CAPACITY_ENTITLEMENTS[key];
  if (isTravellerStorageKey(key)) return TRAVELLER_STORAGE_ENTITLEMENTS[key];
  const feature = aiFeatureOfKey(key) as AiFeatureKey;
  return {
    key,
    name: AI_FEATURES[feature].name,
    unit: 'uses',
    per: 'DAY',
    definition: AI_FEATURES[feature].description,
    shownOnly: false,
  };
}

/**
 * The agency plan keys in the order screens list them: capacity first, then AI features. Traveller
 * storage keys are not among them; `planEntitlementKeys` gives the keys of either kind of plan.
 */
export function entitlementKeys(): EntitlementKey[] {
  return [...CAPACITY_KEYS, ...AI_FEATURE_KEYS.map(aiEntitlementKey)];
}

/**
 * The keys a plan of `audience` carries, in screen order: an agency plan has the capacity keys,
 * a traveller plan the traveller storage keys, and both have every AI feature key (a feature of
 * the other audience reads as off).
 */
export function planEntitlementKeys(audience: 'AGENCY' | 'TRAVELLER'): EntitlementKey[] {
  const ai = AI_FEATURE_KEYS.map(aiEntitlementKey);
  return audience === 'TRAVELLER' ? [...TRAVELLER_STORAGE_KEYS, ...ai] : [...CAPACITY_KEYS, ...ai];
}

/** A definition with the plan's period length filled in. */
export function entitlementDefinitionText(
  definition: EntitlementDefinition,
  periodDays: number,
): string {
  return definition.definition.replace('{days}', String(periodDays));
}

/** The largest number a limit may be (the database stores it as a 64-bit whole number). */
export const ENTITLEMENT_LIMIT_MAX = Number.MAX_SAFE_INTEGER;
