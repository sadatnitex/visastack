/**
 * The AI features a platform owner can switch on or off, and how much each person may use them
 * (S21 framework; S28 brings the other AI features in). Browser-safe: plain data and pure
 * functions, shared by the admin screen, the consent screen and the services.
 *
 * Three things decide whether a feature works for a person, combined in
 * `packages/services/src/ai-feature-settings.ts` (`getAiFeatureState`):
 * 1. the platform owner's switch and optional daily limit (admin page "AI Features"; a feature
 *    with no saved setting uses `defaultEnabled` here);
 * 2. the feature's own storage being in place (its migration has run);
 * 3. the person's plan (`AI_PLAN_TIERS` below): which features it includes and how much a day.
 *
 * Adding a feature is one entry in `AI_FEATURES` (and a line in each plan tier), plus one call to
 * `getAiFeatureState` where the feature starts its work.
 */

export interface AiFeatureDefinition {
  readonly key: string;
  /** Title Case, as the admin screen lists it. */
  readonly name: string;
  /** One plain sentence: what it lets people do. */
  readonly description: string;
  /** Whether it works before the platform owner has ever saved a choice for it. */
  readonly defaultEnabled: boolean;
  /** Uses per person per day before any admin limit; null when the feature is not counted. */
  readonly defaultDailyLimit: number | null;
}

export const AI_FEATURES = {
  ai_app_suggestions: {
    key: 'ai_app_suggestions',
    name: 'AI App Suggestions',
    description:
      'Lets the AI apps people connect leave suggestions, drafts and reminders that the person reviews in VisaStack, only when the person asks the app for a change.',
    defaultEnabled: false,
    defaultDailyLimit: 15,
  },
} as const satisfies Readonly<Record<string, AiFeatureDefinition>>;

export type AiFeatureKey = keyof typeof AI_FEATURES;

export const AI_FEATURE_KEYS = Object.keys(AI_FEATURES) as AiFeatureKey[];

export function isAiFeatureKey(value: string): value is AiFeatureKey {
  return Object.hasOwn(AI_FEATURES, value);
}

/** The range an admin daily limit may take (the database checks the same). */
export const AI_FEATURE_LIMIT_MIN = 1;
export const AI_FEATURE_LIMIT_MAX = 1000;

/** What one plan gives for one feature. */
export interface AiFeatureEntitlement {
  readonly included: boolean;
  /** Uses per person per day; null when the feature is not counted. */
  readonly dailyLimit: number | null;
}

/**
 * What each plan includes. Today there is one tier, FREE, for everyone, and it is the floor every
 * person keeps whatever plan they are on later. Paid tiers plug in here: add a tier with its own
 * features and limits, and have `aiEntitlementFor` in packages/services/src/ai-feature-settings.ts
 * pick the tier from the person's plan. Nothing else changes: the admin switch and the admin
 * limit still apply on top, and the smaller limit always wins.
 */
export const AI_PLAN_TIERS = {
  FREE: {
    ai_app_suggestions: { included: true, dailyLimit: 15 },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<AiFeatureKey, AiFeatureEntitlement>>>>;

export type AiPlanTier = keyof typeof AI_PLAN_TIERS;

/**
 * The limit that applies: the plan's, lowered by the admin's when one is set. Never raised by the
 * admin above what the plan gives.
 */
export function effectiveAiDailyLimit(
  planLimit: number | null,
  adminLimit: number | null,
): number | null {
  if (planLimit === null) return adminLimit;
  if (adminLimit === null) return planLimit;
  return Math.min(planLimit, adminLimit);
}

/** Why a feature does not work for this person right now. */
export const AI_FEATURE_OFF_REASONS = ['turned_off', 'not_in_plan', 'not_available_yet'] as const;
export type AiFeatureOffReason = (typeof AI_FEATURE_OFF_REASONS)[number];

/** The one sentence a person sees wherever a feature that is off would have been. */
export const AI_FEATURE_OFF_HINT =
  'This AI feature is turned off right now. Everything else works as usual.';

// --- How an AI app is named on screen ----------------------------------------------------------

/** Control, zero-width and text-direction characters, which could disguise a name on screen. */
function hiddenCharacter(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

/** What a page calls an app whose name is missing or empty. */
export const AI_APP_FALLBACK_NAME = 'an AI App';

/**
 * An app's name as a page shows it: cleaned again at display (hidden characters removed, spaces
 * collapsed, at most 80 characters), whatever was stored, or "an AI App".
 */
export function aiAppName(name: string | null | undefined): string {
  if (typeof name !== 'string') return AI_APP_FALLBACK_NAME;
  const visible = Array.from(name)
    .filter((char) => !hiddenCharacter(char.codePointAt(0) ?? 0))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = Array.from(visible).slice(0, 80).join('').trim();
  return cut.length > 0 ? cut : AI_APP_FALLBACK_NAME;
}

/** An app's web address as a page shows it: only the characters an address can hold. */
export function aiAppHost(host: string | null | undefined): string | null {
  if (typeof host !== 'string') return null;
  const clean = host
    .toLowerCase()
    .replace(/[^a-z0-9.:-]/g, '')
    .slice(0, 253);
  return clean.length > 0 ? clean : null;
}

/** "Claude (claude.ai)", or "an AI App" when nothing usable was stored. */
export function aiAppLabel(app: {
  readonly name: string | null | undefined;
  readonly host: string | null | undefined;
}): string {
  const name = aiAppName(app.name);
  const host = aiAppHost(app.host);
  return host ? `${name} (${host})` : name;
}
