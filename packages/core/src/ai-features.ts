/**
 * The AI features a platform owner can switch on or off, and how much each person may use them
 * (S21 framework; S28 brings every other AI feature in). Browser-safe: plain data and pure
 * functions, shared by the admin screen, the consent screen, the privacy page and the services.
 *
 * AI is additive: every journey in VisaStack works with every feature here turned off. Four
 * things decide whether a feature works for a person, combined in
 * `packages/services/src/ai-feature-settings.ts` (`getAiFeatureState`), in this order:
 * 1. the platform itself: the environment switch, a usable provider and the provider kill switch
 *    for features that call a model; the AI app switch for features that serve AI apps;
 * 2. the platform owner's switch (admin page "AI Features"; a feature with no saved setting uses
 *    `defaultEnabled` here);
 * 3. the person's plan (`planDefault` here when the plan has no row for the feature);
 * 4. today's use against the daily limit: the smaller of the plan's and the admin's.
 *
 * Adding a feature is one entry in `AI_FEATURES` plus one call to `getAiFeatureState` where the
 * feature starts its work (a test scans every model call for it).
 */

/** What a feature does with AI: calls a model, or serves an AI app a person connected. */
export type AiFeatureKind = 'model' | 'connector';

/** What one plan gives for one feature. */
export interface AiFeatureEntitlement {
  readonly included: boolean;
  /** Uses per person per day; null when the feature is counted but not limited. */
  readonly dailyLimit: number | null;
}

export interface AiFeatureDefinition {
  readonly key: string;
  /** Title Case, as the admin screen lists it. */
  readonly name: string;
  /** One plain sentence: what it lets people do. */
  readonly description: string;
  readonly kind: AiFeatureKind;
  /** What one use is, plural and plain ("files"), for "3 files today". */
  readonly unit: string;
  /** Whether it works before the platform owner has ever saved a choice for it. */
  readonly defaultEnabled: boolean;
  /** What a plan gives when it has no rule of its own for the feature. */
  readonly planDefault: AiFeatureEntitlement;
}

export const AI_FEATURES = {
  ai_automatic_reading: {
    key: 'ai_automatic_reading',
    name: 'Automatic Reading',
    description:
      'Reads each new file by itself after it is uploaded and suggests the details it finds, which the person checks before anything is saved.',
    kind: 'model',
    unit: 'files',
    defaultEnabled: true,
    planDefault: { included: true, dailyLimit: null },
  },
  ai_document_reading: {
    key: 'ai_document_reading',
    name: 'Read with AI',
    description:
      'Lets a person ask for a file to be read with AI, as a scan or as text, and suggests the details it finds for the person to check.',
    kind: 'model',
    unit: 'files',
    defaultEnabled: true,
    planDefault: { included: true, dailyLimit: null },
  },
  ai_document_kind: {
    key: 'ai_document_kind',
    name: 'Document Kind Suggestions',
    description:
      'Suggests what kind of document a file is and a name for it, when VisaStack cannot tell by itself.',
    kind: 'model',
    unit: 'suggestions',
    defaultEnabled: true,
    planDefault: { included: true, dailyLimit: null },
  },
  ai_explanations: {
    key: 'ai_explanations',
    name: 'Gap Explanations',
    description: 'Explains in plain words why something a case needs is still missing.',
    kind: 'model',
    unit: 'explanations',
    defaultEnabled: true,
    planDefault: { included: true, dailyLimit: null },
  },
  ai_consistency_checks: {
    key: 'ai_consistency_checks',
    name: 'Consistency Checks',
    description:
      'Compares a file with the details the person already confirmed and points out anything that looks different, for the person to check.',
    kind: 'model',
    unit: 'checks',
    defaultEnabled: true,
    planDefault: { included: true, dailyLimit: null },
  },
  ai_app_access: {
    key: 'ai_app_access',
    name: 'AI App Access',
    description:
      'Lets the AI apps people connect read the parts of their record each person chose to share.',
    kind: 'connector',
    unit: 'requests',
    defaultEnabled: true,
    planDefault: { included: true, dailyLimit: null },
  },
  ai_app_suggestions: {
    key: 'ai_app_suggestions',
    name: 'AI App Suggestions',
    description:
      'Lets the AI apps people connect leave suggestions, drafts and reminders that the person reviews in VisaStack, only when the person asks the app for a change.',
    kind: 'connector',
    unit: 'suggestions',
    defaultEnabled: false,
    planDefault: { included: true, dailyLimit: 15 },
  },
  ai_app_original_files: {
    key: 'ai_app_original_files',
    name: 'AI App Original Files',
    description:
      'Lets the AI apps people connect receive the files a person ticked, as a Safe Copy or the original, never passports, identity, money or health documents.',
    kind: 'connector',
    unit: 'files',
    defaultEnabled: false,
    planDefault: { included: true, dailyLimit: 30 },
  },
} as const satisfies Readonly<Record<string, AiFeatureDefinition>>;

export type AiFeatureKey = keyof typeof AI_FEATURES;

export const AI_FEATURE_KEYS = Object.keys(AI_FEATURES) as AiFeatureKey[];

export function isAiFeatureKey(value: string): value is AiFeatureKey {
  return Object.hasOwn(AI_FEATURES, value);
}

/** The two ways a person can have a file read: by itself after upload, or on request. */
export type AiReadingFeature = 'ai_automatic_reading' | 'ai_document_reading';

/** The range an admin daily limit may take (the database checks the same). */
export const AI_FEATURE_LIMIT_MIN = 1;
export const AI_FEATURE_LIMIT_MAX = 1000;

function planDefaults(): Record<AiFeatureKey, AiFeatureEntitlement> {
  const tier = {} as Record<AiFeatureKey, AiFeatureEntitlement>;
  for (const key of AI_FEATURE_KEYS) tier[key] = AI_FEATURES[key].planDefault;
  return tier;
}

/**
 * The built-in plan: what every feature gives when a plan has no rule for it (S29 reads plan rules
 * from `plan_entitlements`; this only seeds them and fills the gaps). It is the floor every person
 * keeps. It is made from each feature's `planDefault`, so the registry stays the one place.
 */
export const AI_PLAN_TIERS: {
  readonly FREE: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>>;
} = { FREE: planDefaults() };

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

/**
 * Why a feature does not work for this person right now, in the order they are decided:
 * the platform is not running it, the platform owner turned it off, the plan does not include it,
 * today's limit is used up, or its storage is not in place yet.
 */
export const AI_FEATURE_OFF_REASONS = [
  'platform_off',
  'turned_off',
  'not_in_plan',
  'daily_limit',
  'not_available_yet',
] as const;
export type AiFeatureOffReason = (typeof AI_FEATURE_OFF_REASONS)[number];

/** The one sentence a person sees wherever a feature that is off would have been. */
export const AI_FEATURE_OFF_HINT =
  'This AI feature is turned off right now. Everything else works as usual.';

/**
 * When daily limits start again. The count is kept per UTC day (midnight UTC is 6 AM in Dhaka),
 * said in the time people here live by.
 */
export const AI_DAY_BOUNDARY_NOTE = 'Daily limits start again at 6 AM Bangladesh time.';

/** The sentence a person sees once today's limit for a feature is used up. */
export const AI_FEATURE_LIMIT_HINT =
  'You have reached today’s limit for this AI feature. It starts again at 6 AM Bangladesh time. Everything else works as usual.';

/** What a person sees in place of a feature that is off, for the reason it is off. */
export function aiFeatureOffHint(reason: AiFeatureOffReason | null): string {
  return reason === 'daily_limit' ? AI_FEATURE_LIMIT_HINT : AI_FEATURE_OFF_HINT;
}

/**
 * The same, naming the feature, where a screen speaks about one feature by name (the AI app
 * consent screen): "AI App Access is turned off right now."
 */
export function aiFeatureOffSentence(
  feature: AiFeatureKey,
  reason: AiFeatureOffReason | null,
): string {
  const name = AI_FEATURES[feature].name;
  return reason === 'daily_limit'
    ? `You have reached today’s limit for ${name}. It starts again at 6 AM Bangladesh time.`
    : `${name} is turned off right now.`;
}

// --- How an AI app is named on screen ----------------------------------------------------------

/**
 * Control, zero-width, line-separator and text-direction characters, which could disguise text on
 * screen. The one list every AI app text filter uses (app names, suggested values, drafts).
 */
export function isHiddenCodePoint(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
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
    .filter((char) => !isHiddenCodePoint(char.codePointAt(0) ?? 0))
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
