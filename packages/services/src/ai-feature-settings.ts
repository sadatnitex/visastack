import type { PermissionAction, Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import {
  AI_FEATURES,
  AI_FEATURE_KEYS,
  AI_FEATURE_LIMIT_MAX,
  AI_FEATURE_LIMIT_MIN,
  AI_PLAN_TIERS,
  type AiFeatureEntitlement,
  type AiFeatureKey,
  type AiFeatureOffReason,
  type AiPlanTier,
  effectiveAiDailyLimit,
} from '@visastack/core/ai-features';
import { eq, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { AuthorizedApplicant } from './access/require-access';
import { aiSuggestionsAvailable } from './ai-suggestions';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Whether an AI feature works for a person right now, and how much a day (S21 framework; S28
 * brings the other AI features in). One answer from three inputs:
 *
 * 1. the platform owner's switch and optional daily limit (`platform_ai_feature_settings`, the
 *    AI Features admin page); no saved row means the registered default
 *    (`packages/core/src/ai-features.ts`), and so does a database where the table is not there yet;
 * 2. the feature's own storage being in place (`FEATURE_READY` below);
 * 3. the person's plan entitlement (`aiEntitlementFor`).
 *
 * Turning a feature off only stops new use. Nothing a person already has is removed or hidden:
 * pending suggestions stay reviewable, drafts stay readable and removable.
 *
 * To bring a feature in: register it in core, add a line to `FEATURE_READY`, and call
 * `getAiFeatureState` once where the feature starts its work.
 */

export interface AiFeatureState {
  readonly feature: AiFeatureKey;
  readonly available: boolean;
  /** Why not, when not available. */
  readonly reason: AiFeatureOffReason | null;
  /** Uses per person per day: the smaller of the plan's and the admin's. */
  readonly dailyLimit: number | null;
}

/** Who is asking: a person's record (through the access gate) or a platform staff member. */
export type AiFeatureContext =
  | { readonly proof: AuthorizedApplicant<PermissionAction> }
  | { readonly staff: StaffScope<'AI_FEATURES_MANAGE'> };

/** Whether each feature's own storage exists (its migration has run). Never fails a transaction. */
const FEATURE_READY: Readonly<Record<AiFeatureKey, (db: Db) => Promise<boolean>>> = {
  ai_app_suggestions: aiSuggestionsAvailable,
};

export interface AiPlanEntitlement {
  readonly tier: AiPlanTier;
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>>;
}

/**
 * The AI features a person's plan includes. Today every person is on the FREE tier, which is also
 * the floor everyone keeps. Paid tiers plug in here: read the account's plan (for example its
 * subscription) and return that tier from `AI_PLAN_TIERS`, keeping FREE for anyone without one.
 * The caller already passed the access gate; this only decides how much.
 */
export function aiEntitlementFor(_context: {
  readonly accountId: string | null;
}): AiPlanEntitlement {
  return { tier: 'FREE', features: AI_PLAN_TIERS.FREE };
}

interface SavedSetting {
  readonly enabled: boolean;
  readonly dailyLimit: number | null;
  readonly updatedAt: Date | null;
  readonly updatedByAccountId: string | null;
}

async function settingsTablePresent(db: Db): Promise<boolean> {
  const rows = await db
    .select({
      present: sql<boolean>`to_regclass('platform_ai_feature_settings') is not null`,
    })
    .from(sql`(select 1) as probe`);
  return rows[0]?.present === true;
}

/** The saved switch for a feature, or its default. */
async function savedSetting(db: Db, feature: AiFeatureKey): Promise<SavedSetting> {
  const standard: SavedSetting = {
    enabled: AI_FEATURES[feature].defaultEnabled,
    dailyLimit: null,
    updatedAt: null,
    updatedByAccountId: null,
  };
  if (!(await settingsTablePresent(db))) return standard;
  const row = first(
    await db
      .select()
      .from(schema.platformAiFeatureSettings)
      .where(eq(schema.platformAiFeatureSettings.featureKey, feature))
      .limit(1),
  );
  return row
    ? {
        enabled: row.enabled,
        dailyLimit: row.dailyLimit,
        updatedAt: row.updatedAt,
        updatedByAccountId: row.updatedByAccountId,
      }
    : standard;
}

function contextAccount(context: AiFeatureContext): string | null | undefined {
  if ('proof' in context) {
    const proof = context.proof;
    if (!AuthorizedApplicant.isGenuine(proof, proof.action)) return undefined;
    return proof.applicant.ownerAccountId ?? null;
  }
  return staffScopeProblem(context.staff, 'AI_FEATURES_MANAGE') ? undefined : null;
}

/**
 * Whether `feature` works for the person behind `context` now. A forged context gets "turned off",
 * never an error, so a caller can always fall back to the calm "off" behaviour.
 */
export async function getAiFeatureState(
  db: Db,
  feature: AiFeatureKey,
  context: AiFeatureContext,
): Promise<AiFeatureState> {
  const off = (reason: AiFeatureOffReason, dailyLimit: number | null = null): AiFeatureState => ({
    feature,
    available: false,
    reason,
    dailyLimit,
  });
  const accountId = contextAccount(context);
  if (accountId === undefined) return off('turned_off');
  if (!(await FEATURE_READY[feature](db))) return off('not_available_yet');
  const saved = await savedSetting(db, feature);
  const plan = aiEntitlementFor({ accountId }).features[feature];
  const dailyLimit = effectiveAiDailyLimit(plan.dailyLimit, saved.dailyLimit);
  if (!saved.enabled) return off('turned_off', dailyLimit);
  if (!plan.included) return off('not_in_plan', dailyLimit);
  return { feature, available: true, reason: null, dailyLimit };
}

/** One feature as the AI Features page shows it. */
export interface AiFeatureSettingView {
  readonly feature: AiFeatureKey;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /** The admin's own limit, or null for the plan's. */
  readonly adminDailyLimit: number | null;
  /** The FREE tier's limit, the most anyone gets today. */
  readonly planDailyLimit: number | null;
  readonly ready: boolean;
  readonly updatedAt: Date | null;
}

export interface AiFeatureSettingsList {
  /** False until the settings table exists. */
  readonly available: boolean;
  readonly features: readonly AiFeatureSettingView[];
}

/** Every registered feature with its switch, for the AI Features page. Platform owner only. */
export async function listAiFeatureSettings(
  db: Db,
  staff: StaffScope<'AI_FEATURES_MANAGE'>,
): Promise<Result<AiFeatureSettingsList, ServiceError>> {
  const denied = staffScopeProblem(staff, 'AI_FEATURES_MANAGE');
  if (denied) return err(denied);
  const available = await settingsTablePresent(db);
  const features: AiFeatureSettingView[] = [];
  for (const feature of AI_FEATURE_KEYS) {
    const saved = await savedSetting(db, feature);
    features.push({
      feature,
      name: AI_FEATURES[feature].name,
      description: AI_FEATURES[feature].description,
      enabled: saved.enabled,
      adminDailyLimit: saved.dailyLimit,
      planDailyLimit: AI_PLAN_TIERS.FREE[feature].dailyLimit,
      ready: await FEATURE_READY[feature](db),
      updatedAt: saved.updatedAt,
    });
  }
  return ok({ available, features });
}

/** The refusal for a save before the settings table exists. */
export const AI_FEATURE_SETTINGS_UNAVAILABLE = 'AI feature settings are not available yet';

export interface UpdateAiFeatureSettingInput {
  readonly feature: AiFeatureKey;
  readonly enabled: boolean;
  /** Null: use the plan's limit. */
  readonly dailyLimit: number | null;
  readonly stepUpSatisfied: boolean;
}

/**
 * Saves one feature's switch and limit. Platform owner only (`AI_FEATURES_MANAGE` is held by no
 * other role), with a fresh sign-in check. Audited with the setting before and after.
 */
export async function updateAiFeatureSetting(
  db: Db,
  staff: StaffScope<'AI_FEATURES_MANAGE'>,
  input: UpdateAiFeatureSettingInput,
): Promise<Result<{ readonly changed: boolean }, ServiceError>> {
  const denied = staffScopeProblem(staff, 'AI_FEATURES_MANAGE');
  if (denied) return err(denied);
  if (!Object.hasOwn(AI_FEATURES, input.feature)) {
    return err(serviceError('invalid', 'unknown AI feature'));
  }
  if (
    input.dailyLimit !== null &&
    !(
      Number.isSafeInteger(input.dailyLimit) &&
      input.dailyLimit >= AI_FEATURE_LIMIT_MIN &&
      input.dailyLimit <= AI_FEATURE_LIMIT_MAX
    )
  ) {
    return err(
      serviceError(
        'invalid',
        `Daily Limit per Person must be a whole number from ${AI_FEATURE_LIMIT_MIN} to ${AI_FEATURE_LIMIT_MAX}, or empty for the plan's limit.`,
      ),
    );
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'changing AI features requires reauthentication'));
  }
  if (!(await settingsTablePresent(db))) {
    return err(serviceError('invalid', AI_FEATURE_SETTINGS_UNAVAILABLE));
  }
  return db.transaction(async (tx) => {
    const before = await savedSetting(tx, input.feature);
    if (
      before.updatedAt !== null &&
      before.enabled === input.enabled &&
      before.dailyLimit === input.dailyLimit
    ) {
      return ok({ changed: false });
    }
    const now = new Date();
    await tx
      .insert(schema.platformAiFeatureSettings)
      .values({
        featureKey: input.feature,
        enabled: input.enabled,
        dailyLimit: input.dailyLimit,
        updatedByAccountId: staff.accountId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.platformAiFeatureSettings.featureKey,
        set: {
          enabled: input.enabled,
          dailyLimit: input.dailyLimit,
          updatedByAccountId: staff.accountId,
          updatedAt: now,
        },
      });
    await appendAuditEvent(tx, {
      eventType: 'AI_FEATURE_SETTING_UPDATED',
      actorAccountId: staff.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'platform_ai_feature',
      resourceId: input.feature,
      metadata: {
        before: { enabled: before.enabled, dailyLimit: before.dailyLimit },
        after: { enabled: input.enabled, dailyLimit: input.dailyLimit },
      },
    });
    return ok({ changed: true });
  });
}
