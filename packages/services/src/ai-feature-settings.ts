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
  type AiFeatureKind,
  type AiFeatureOffReason,
  type AiPlanTier,
  aiFeatureOffHint,
  effectiveAiDailyLimit,
} from '@visastack/core/ai-features';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type StaffScope, SystemScope, staffScopeProblem } from './access/principal';
import { AuthorizedApplicant } from './access/require-access';
import { aiFilesAvailable } from './ai-files-ready';
import { isAiDispatchAllowed } from './ai-provider-config';
import { aiSuggestionsAvailable } from './ai-suggestions';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type EntitlementSubject, resolveEntitlements } from './entitlements';
import { type AiFeatureReason, type ServiceError, refusal, serviceError } from './errors';

/**
 * Whether an AI feature works for a person right now, and how much a day (S21 framework; S28
 * brings every AI feature in, ADR 0021 S28 amendment). AI is additive: VisaStack meets every
 * goal with each feature here off, so an "off" answer is always calm, never an error.
 *
 * One answer, decided in this order (the first that applies wins):
 * 1. `platform_off`: the platform is not running this kind of feature. For a feature that calls a
 *    model: the caller's environment switch or usable provider (`options.platform.model`), then
 *    the provider kill switch (`isAiDispatchAllowed`). For a feature that serves AI apps: the AI
 *    app switch (`options.platform.connector`), when the caller knows it.
 * 2. `not_available_yet`: the feature's own storage is not in place (its migration has not run).
 * 3. `turned_off`: the platform owner's switch (`platform_ai_feature_settings`, the AI Features
 *    admin page); no saved row means the registered default, and so does a missing table.
 * 4. `not_in_plan`: the person's plan (S29's resolver; a plan with no row for the feature gives the
 *    registry's `planDefault`).
 * 5. `daily_limit`: today's use (UTC day) has reached the smaller of the plan's and the admin's
 *    limit. Only for the features S28 counts; S21 and S20 keep counting their own way.
 * After this, the service itself checks the person's consent, then the spend and attempt limits.
 *
 * Turning a feature off only stops new use. Nothing a person already has is removed or hidden:
 * earlier readings stay to accept or skip, explanations stay readable, connections stay listed.
 *
 * To bring a feature in: register it in core, add a line to `FEATURE_READY`, and call
 * `getAiFeatureState` (or, where use is counted, `openAiFeatureGate` and `chargeAiFeatureUse`)
 * once where the feature starts its work.
 */

export interface AiFeatureState {
  readonly feature: AiFeatureKey;
  readonly available: boolean;
  /** Why not, when not available. */
  readonly reason: AiFeatureOffReason | null;
  /** Uses per person per day: the smaller of the plan's and the admin's. */
  readonly dailyLimit: number | null;
}

/** Made only by `aiOwnerContext`; the module keeps the genuine ones. */
export interface AiOwnerContext {
  readonly accountId: string;
}
const OWNER_CONTEXTS = new WeakSet<object>();

/**
 * Who is asking:
 * - `proof`: a person's record, through the access gate; the record owner's plan and count apply;
 * - `staff`: a platform staff member reading the settings (never counted);
 * - `system`: the automatic reading job, for the owner of the file it is reading;
 * - `owner`: a service that has itself shown the account owns the record (`aiOwnerContext`, not
 *   exported from the services index, so the web app cannot make one);
 * - `agency`: an organization member's proof; the agency's plan and count apply (S22 wires the
 *   callers; agency plans carry no AI rows yet, so the registry default applies).
 */
export type AiFeatureContext =
  | { readonly proof: AuthorizedApplicant<PermissionAction> }
  | { readonly staff: StaffScope<'AI_FEATURES_MANAGE'> }
  | { readonly system: SystemScope<'process-ai-reading'>; readonly accountId: string }
  | { readonly owner: AiOwnerContext }
  | { readonly agency: AuthorizedApplicant<PermissionAction> };

/**
 * The context of an account a service has already shown owns the record it works on (for example
 * after `loadOwnedApplicant`). For services only: never exported from the services index.
 */
export function aiOwnerContext(accountId: string): { readonly owner: AiOwnerContext } {
  const owner: AiOwnerContext = Object.freeze({ accountId });
  OWNER_CONTEXTS.add(owner);
  return { owner };
}

/** Whose use is counted and whose plan applies. */
type AiSubject =
  | { readonly kind: 'account'; readonly id: string }
  | { readonly kind: 'organization'; readonly id: string };

/** Whether each feature's own storage exists (its migration has run). Never fails a transaction. */
const always = async () => true;
const FEATURE_READY: Readonly<Record<AiFeatureKey, (db: Db) => Promise<boolean>>> = {
  ai_automatic_reading: always,
  ai_document_reading: always,
  ai_document_kind: always,
  ai_explanations: always,
  ai_consistency_checks: always,
  ai_app_access: always,
  ai_app_suggestions: aiSuggestionsAvailable,
  ai_app_original_files: aiFilesAvailable,
};

/**
 * Where a feature's use is counted: one fixed-window bucket per subject per UTC day. AI App
 * Suggestions (S21) and AI App Original Files (S20) keep the buckets they already charge, so their
 * limits work exactly as before; every other feature is counted here, as `ai_feature.<key>`.
 */
const SHARED_BUCKETS: Partial<Record<AiFeatureKey, string>> = {
  ai_app_suggestions: 'ai_write.account',
  ai_app_original_files: 'ai_file.account',
};

/** One UTC day: daily limits start again at midnight UTC (6 AM in Bangladesh). */
export const AI_FEATURE_WINDOW_MS = 24 * 60 * 60 * 1000;

function usageAction(feature: AiFeatureKey): string {
  return SHARED_BUCKETS[feature] ?? `ai_feature.${feature}`;
}

/** Whether S28 counts and limits this feature (the others count their own way). */
function countedHere(feature: AiFeatureKey): boolean {
  return SHARED_BUCKETS[feature] === undefined;
}

function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / AI_FEATURE_WINDOW_MS) * AI_FEATURE_WINDOW_MS);
}

/** When today's count started and when the next one starts (UTC midnights). */
export function aiFeatureDay(now: Date = new Date()): { readonly from: Date; readonly to: Date } {
  const from = windowStart(now);
  return { from, to: new Date(from.getTime() + AI_FEATURE_WINDOW_MS) };
}

export interface AiPlanEntitlement {
  readonly tier: AiPlanTier;
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>>;
}

/**
 * The AI features a plan includes (S29): read through the one entitlement resolver, so the
 * platform owner sets them on the Plans page. A traveller is on Traveller Free today, which is also
 * the floor everyone keeps; a feature the plan has no row for uses the registry's `planDefault`.
 * An agency's plan carries no AI rules yet (the resolver answers "not applicable"), so the
 * registry default applies until S22 adds them. The caller already passed the access gate; this
 * only decides how much.
 */
export async function aiEntitlementFor(
  db: Db,
  subject: EntitlementSubject,
): Promise<AiPlanEntitlement> {
  const resolved = await resolveEntitlements(db, subject);
  return { tier: 'FREE', features: resolved.features ?? AI_PLAN_TIERS.FREE };
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

function standardSetting(feature: AiFeatureKey): SavedSetting {
  return {
    enabled: AI_FEATURES[feature].defaultEnabled,
    dailyLimit: null,
    updatedAt: null,
    updatedByAccountId: null,
  };
}

/** The saved switches for `features`, or their defaults, in one read. */
async function savedSettings(
  db: Db,
  features: readonly AiFeatureKey[],
): Promise<Map<AiFeatureKey, SavedSetting>> {
  const settings = new Map(features.map((feature) => [feature, standardSetting(feature)] as const));
  if (features.length === 0 || !(await settingsTablePresent(db))) return settings;
  const rows = await db
    .select()
    .from(schema.platformAiFeatureSettings)
    .where(inArray(schema.platformAiFeatureSettings.featureKey, [...features]));
  for (const row of rows) {
    const feature = row.featureKey as AiFeatureKey;
    if (!settings.has(feature)) continue;
    settings.set(feature, {
      enabled: row.enabled,
      dailyLimit: row.dailyLimit,
      updatedAt: row.updatedAt,
      updatedByAccountId: row.updatedByAccountId,
    });
  }
  return settings;
}

/** The saved switch for one feature, or its default. */
async function savedSetting(db: Db, feature: AiFeatureKey): Promise<SavedSetting> {
  return (await savedSettings(db, [feature])).get(feature) ?? standardSetting(feature);
}

/** Whose plan and count apply; null for staff (never counted); undefined for a forged context. */
function contextSubject(context: AiFeatureContext): AiSubject | null | undefined {
  if ('proof' in context) {
    const proof = context.proof;
    if (!AuthorizedApplicant.isGenuine(proof, proof.action)) return undefined;
    const owner = proof.applicant.ownerAccountId ?? null;
    return owner === null ? null : { kind: 'account', id: owner };
  }
  if ('agency' in context) {
    const proof = context.agency;
    if (!AuthorizedApplicant.isGenuine(proof, proof.action)) return undefined;
    if (proof.actor.kind !== 'organization_member') return undefined;
    return { kind: 'organization', id: proof.actor.membership.organizationId };
  }
  if ('system' in context) {
    const scope = context.system;
    if (!SystemScope.isGenuine(scope) || scope.job !== 'process-ai-reading') return undefined;
    return { kind: 'account', id: context.accountId };
  }
  if ('owner' in context) {
    return OWNER_CONTEXTS.has(context.owner)
      ? { kind: 'account', id: context.owner.accountId }
      : undefined;
  }
  return staffScopeProblem(context.staff, 'AI_FEATURES_MANAGE') ? undefined : null;
}

function entitlementSubject(subject: AiSubject | null): EntitlementSubject {
  if (subject?.kind === 'organization') return { organizationId: subject.id };
  return { accountId: subject?.id ?? null };
}

/** Today's count for one feature and subject, without counting anything. */
async function usedToday(
  db: Db,
  feature: AiFeatureKey,
  subject: AiSubject,
  now: Date,
): Promise<number> {
  // The features S21 and S20 count are counted per person only.
  if (!countedHere(feature) && subject.kind !== 'account') return 0;
  const row = first(
    await db
      .select({ count: schema.rateLimitBuckets.count })
      .from(schema.rateLimitBuckets)
      .where(
        and(
          eq(schema.rateLimitBuckets.subjectId, subject.id),
          eq(schema.rateLimitBuckets.action, usageAction(feature)),
          eq(schema.rateLimitBuckets.windowStart, windowStart(now)),
        ),
      )
      .limit(1),
  );
  return row?.count ?? 0;
}

export interface AiFeatureStateOptions {
  /**
   * What the caller knows about the platform for each kind of feature: false when the
   * environment switch is off or no provider is usable (model), or when AI apps cannot connect on
   * this site (connector). Left out: not known here, and a model feature still checks the
   * provider kill switch.
   */
  readonly platform?: Partial<Record<AiFeatureKind, boolean>>;
  /**
   * This use was already counted today by the step before it (one file read as a scan, then for
   * its details), so today's limit does not stop it again.
   */
  readonly alreadyCounted?: boolean;
  readonly now?: Date;
}

interface ResolvedState {
  readonly state: AiFeatureState;
  readonly subject: AiSubject | null;
}

async function resolveStates(
  db: Db,
  features: readonly AiFeatureKey[],
  subject: AiSubject | null | undefined,
  options: AiFeatureStateOptions,
): Promise<ResolvedState[]> {
  const off = (
    feature: AiFeatureKey,
    reason: AiFeatureOffReason,
    dailyLimit: number | null = null,
  ): AiFeatureState => ({ feature, available: false, reason, dailyLimit });
  if (subject === undefined) {
    return features.map((feature) => ({ state: off(feature, 'turned_off'), subject: null }));
  }
  const now = options.now ?? new Date();
  const asksModel = features.some(
    (feature) => AI_FEATURES[feature].kind === 'model' && options.platform?.model !== false,
  );
  // The kill switch is read once, and only when a model feature could otherwise be on.
  const dispatchAllowed = asksModel ? await isAiDispatchAllowed(db) : true;
  const saved = await savedSettings(db, features);
  const plan = (await aiEntitlementFor(db, entitlementSubject(subject))).features;
  const resolved: ResolvedState[] = [];
  for (const feature of features) {
    const kind = AI_FEATURES[feature].kind;
    const setting = saved.get(feature) ?? standardSetting(feature);
    const entitlement = plan[feature];
    const dailyLimit = effectiveAiDailyLimit(entitlement.dailyLimit, setting.dailyLimit);
    const platformOn = options.platform?.[kind] !== false && (kind !== 'model' || dispatchAllowed);
    let state: AiFeatureState;
    if (!platformOn) state = off(feature, 'platform_off', dailyLimit);
    // Each readiness probe caches a "yes" per database handle, so asking again is free.
    else if (!(await FEATURE_READY[feature](db))) state = off(feature, 'not_available_yet');
    else if (!setting.enabled) state = off(feature, 'turned_off', dailyLimit);
    else if (!entitlement.included) state = off(feature, 'not_in_plan', dailyLimit);
    else if (
      countedHere(feature) &&
      options.alreadyCounted !== true &&
      dailyLimit !== null &&
      subject !== null &&
      (await usedToday(db, feature, subject, now)) >= dailyLimit
    ) {
      state = off(feature, 'daily_limit', dailyLimit);
    } else state = { feature, available: true, reason: null, dailyLimit };
    resolved.push({ state, subject });
  }
  return resolved;
}

/**
 * Whether `feature` works for the person behind `context` now. A forged context gets "turned off",
 * never an error, so a caller can always fall back to the calm "off" behaviour.
 */
export async function getAiFeatureState(
  db: Db,
  feature: AiFeatureKey,
  context: AiFeatureContext,
  options: AiFeatureStateOptions = {},
): Promise<AiFeatureState> {
  const [resolved] = await resolveStates(db, [feature], contextSubject(context), options);
  return resolved?.state ?? { feature, available: false, reason: 'turned_off', dailyLimit: null };
}

/** Several features at once for one page, reading the settings and the plan once. */
export async function getAiFeatureStates<K extends AiFeatureKey>(
  db: Db,
  features: readonly K[],
  context: AiFeatureContext,
  options: AiFeatureStateOptions = {},
): Promise<Readonly<Record<K, AiFeatureState>>> {
  const resolved = await resolveStates(db, features, contextSubject(context), options);
  const states = {} as Record<K, AiFeatureState>;
  for (const [i, feature] of features.entries()) {
    states[feature] = resolved[i]?.state ?? {
      feature,
      available: false,
      reason: 'turned_off',
      dailyLimit: null,
    };
  }
  return states;
}

/** A feature that is on for this person, ready to be charged once its work is about to happen. */
export interface AiFeatureGate {
  readonly feature: AiFeatureKey;
  readonly dailyLimit: number | null;
  readonly subject: AiSubject | null;
}

/**
 * The state of `feature`, and when it is on, the gate to charge once the work is certain (for
 * services only; not exported from the services index).
 */
export async function openAiFeatureGate(
  db: Db,
  feature: AiFeatureKey,
  context: AiFeatureContext,
  options: AiFeatureStateOptions = {},
): Promise<Result<AiFeatureGate, AiFeatureState>> {
  const [resolved] = await resolveStates(db, [feature], contextSubject(context), options);
  if (!resolved) {
    return err({ feature, available: false, reason: 'turned_off', dailyLimit: null });
  }
  if (!resolved.state.available) return err(resolved.state);
  return ok({ feature, dailyLimit: resolved.state.dailyLimit, subject: resolved.subject });
}

/**
 * Counts one use against today's bucket, last, inside the transaction that does the work: false
 * when the daily limit is already reached (nothing is counted then). With no limit the use is
 * still counted, for the AI Use Today page. A use is never counted twice: the count only rises
 * while it is under the limit, in one statement, so two calls at once cannot both pass it.
 */
export async function chargeAiFeatureUse(
  db: Db,
  gate: AiFeatureGate,
  now: Date = new Date(),
): Promise<boolean> {
  if (gate.subject === null || !countedHere(gate.feature)) return true;
  const limit = gate.dailyLimit;
  if (limit !== null && limit <= 0) return false;
  const bucket = schema.rateLimitBuckets;
  const rows = await db
    .insert(bucket)
    .values({
      subjectId: gate.subject.id,
      action: usageAction(gate.feature),
      windowStart: windowStart(now),
      count: 1,
    })
    .onConflictDoUpdate({
      target: [bucket.subjectId, bucket.action, bucket.windowStart],
      set: { count: sql`${bucket.count} + 1`, updatedAt: sql`now()` },
      ...(limit !== null ? { setWhere: sql`${bucket.count} < ${limit}` } : {}),
    })
    .returning({ count: bucket.count });
  return rows.length > 0;
}

/** The refusal a service returns for a feature that is off: a plain sentence and a typed reason. */
export function aiFeatureRefusal(state: AiFeatureState): ServiceError {
  const reason: AiFeatureReason =
    state.reason === 'platform_off'
      ? 'ai_platform_off'
      : state.reason === 'daily_limit'
        ? 'ai_daily_limit'
        : 'ai_feature_off';
  return refusal(reason, aiFeatureOffHint(state.reason));
}

/**
 * Gives one counted use back, never below zero: for a call that was counted when it started (so
 * its count row is locked before anything else) and then ended refused. Refusals are free.
 */
export async function refundAiFeatureUse(
  db: Db,
  gate: AiFeatureGate,
  now: Date = new Date(),
): Promise<void> {
  if (gate.subject === null || !countedHere(gate.feature)) return;
  const bucket = schema.rateLimitBuckets;
  await db
    .update(bucket)
    .set({ count: sql`greatest(${bucket.count} - 1, 0)`, updatedAt: sql`now()` })
    .where(
      and(
        eq(bucket.subjectId, gate.subject.id),
        eq(bucket.action, usageAction(gate.feature)),
        eq(bucket.windowStart, windowStart(now)),
      ),
    );
}

/** The refusal for a use the daily limit stopped at the moment it was to be counted. */
export function aiDailyLimitRefusal(gate: AiFeatureGate): ServiceError {
  return aiFeatureRefusal({
    feature: gate.feature,
    available: false,
    reason: 'daily_limit',
    dailyLimit: gate.dailyLimit,
  });
}

/** Whether a refusal came from an AI feature being off (any of the typed reasons above). */
export function isAiFeatureRefusal(error: ServiceError): boolean {
  return (
    error.reason === 'ai_platform_off' ||
    error.reason === 'ai_feature_off' ||
    error.reason === 'ai_daily_limit'
  );
}

/** One feature on the AI Use Today page. */
export interface AiUsageToday {
  readonly feature: AiFeatureKey;
  readonly name: string;
  /** Plural and plain, for "3 files today". */
  readonly unit: string;
  readonly used: number;
  readonly dailyLimit: number | null;
  readonly available: boolean;
  readonly reason: AiFeatureOffReason | null;
}

/**
 * How much of each AI feature a person (or an agency) used today, and whether each works now, for
 * the AI Use Today page. Counts only: never what was read or asked. The day is the UTC day.
 */
export async function getAiUsageToday(
  db: Db,
  subject: { readonly accountId: string } | { readonly organizationId: string },
  options: AiFeatureStateOptions = {},
): Promise<{ readonly features: readonly AiUsageToday[]; readonly startsAgainAt: Date }> {
  const now = options.now ?? new Date();
  const who: AiSubject =
    'accountId' in subject
      ? { kind: 'account', id: subject.accountId }
      : { kind: 'organization', id: subject.organizationId };
  const resolved = await resolveStates(db, AI_FEATURE_KEYS, who, { ...options, now });
  const features: AiUsageToday[] = [];
  for (const { state } of resolved) {
    features.push({
      feature: state.feature,
      name: AI_FEATURES[state.feature].name,
      unit: AI_FEATURES[state.feature].unit,
      used: await usedToday(db, state.feature, who, now),
      dailyLimit: state.dailyLimit,
      available: state.available,
      reason: state.reason,
    });
  }
  return { features, startsAgainAt: aiFeatureDay(now).to };
}

/** One feature as the AI Features page shows it. */
export interface AiFeatureSettingView {
  readonly feature: AiFeatureKey;
  readonly name: string;
  readonly description: string;
  /** Calls a model, or serves the AI apps people connect. */
  readonly kind: AiFeatureKind;
  readonly enabled: boolean;
  /** Whether the traveller plan includes it (set on the Plans page). */
  readonly planIncluded: boolean;
  /** The admin's own limit, or null for the plan's. */
  readonly adminDailyLimit: number | null;
  /** The traveller plan's limit (set on the Plans page), the most anyone gets today. */
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
  const plan = await aiEntitlementFor(db, { accountId: null });
  const settings = await savedSettings(db, AI_FEATURE_KEYS);
  for (const feature of AI_FEATURE_KEYS) {
    const saved = settings.get(feature) ?? standardSetting(feature);
    features.push({
      feature,
      name: AI_FEATURES[feature].name,
      description: AI_FEATURES[feature].description,
      kind: AI_FEATURES[feature].kind,
      enabled: saved.enabled,
      planIncluded: plan.features[feature].included,
      adminDailyLimit: saved.dailyLimit,
      planDailyLimit: plan.features[feature].dailyLimit,
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
