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
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { type StaffScope, SystemScope, staffScopeProblem } from './access/principal';
import { AuthorizedApplicant } from './access/require-access';
import { aiFilesAvailable } from './ai-files-ready';
import { isAiDispatchAllowed } from './ai-provider-config';
import { aiSuggestionsAvailable } from './ai-suggestions';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type EntitlementSubject, resolveEntitlements } from './entitlements';
import { serverErrorEvent } from './error-report';
import { type AiFeatureReason, type ServiceError, refusal, serviceError } from './errors';
import { formatObservabilityLine } from './observability-format';
import { RATE_LIMITS, refundRateLimitWindow, windowStartFor } from './rate-limit';

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
 * limits work exactly as before, with their built-in daily ceiling when neither the plan nor the
 * admin sets one; every other feature is counted here, as `ai_feature.<key>`.
 */
const SHARED_BUCKETS: Partial<
  Record<AiFeatureKey, { readonly action: string; readonly ceiling: number }>
> = {
  ai_app_suggestions: {
    action: 'ai_write.account',
    ceiling: RATE_LIMITS.AI_WRITE_ACCOUNT_DAY.limit,
  },
  ai_app_original_files: {
    action: 'ai_file.account',
    ceiling: RATE_LIMITS.AI_FILE_ACCOUNT_DAY.limit,
  },
};

/** One UTC day: daily limits start again at midnight UTC (6 AM in Bangladesh). */
export const AI_FEATURE_WINDOW_MS = 24 * 60 * 60 * 1000;

function usageAction(feature: AiFeatureKey): string {
  return SHARED_BUCKETS[feature]?.action ?? `ai_feature.${feature}`;
}

/** Whether S28 counts and limits this feature (the others count their own way). */
function countedHere(feature: AiFeatureKey): boolean {
  return SHARED_BUCKETS[feature] === undefined;
}

function windowStart(now: Date): Date {
  return windowStartFor(now, AI_FEATURE_WINDOW_MS);
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

/** Today's count of every feature for one subject, in one read, without counting anything. */
async function usageToday(
  db: Db,
  subject: AiSubject,
  now: Date,
): Promise<Map<AiFeatureKey, number>> {
  // The features S21 and S20 count are counted per person only.
  const features = AI_FEATURE_KEYS.filter(
    (feature) => countedHere(feature) || subject.kind === 'account',
  );
  const rows = await db
    .select({ action: schema.rateLimitBuckets.action, count: schema.rateLimitBuckets.count })
    .from(schema.rateLimitBuckets)
    .where(
      and(
        eq(schema.rateLimitBuckets.subjectId, subject.id),
        inArray(schema.rateLimitBuckets.action, features.map(usageAction)),
        eq(schema.rateLimitBuckets.windowStart, windowStart(now)),
      ),
    );
  const byAction = new Map(rows.map((row) => [row.action, row.count] as const));
  return new Map(
    AI_FEATURE_KEYS.map(
      (feature) =>
        [
          feature,
          features.includes(feature) ? (byAction.get(usageAction(feature)) ?? 0) : 0,
        ] as const,
    ),
  );
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
  readonly now?: Date;
}

/** What only the services pass: never part of the options the web app can give. */
interface ResolveOptions extends AiFeatureStateOptions {
  /**
   * This use was already counted today by the step before it (a scan that was charged for this
   * very file), so today's limit does not stop it again. Set only from a genuine scan charge.
   */
  readonly alreadyCounted?: boolean;
  /**
   * Today's counts, read once by the caller (AI Use Today). Given, the features S21 and S20 count
   * are checked against their limit too, so the page never says "On" when they are used up.
   */
  readonly usage?: ReadonlyMap<AiFeatureKey, number>;
}

interface ResolvedState {
  readonly state: AiFeatureState;
  readonly subject: AiSubject | null;
}

async function resolveStates(
  db: Db,
  features: readonly AiFeatureKey[],
  subject: AiSubject | null | undefined,
  options: ResolveOptions,
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
    const shared = SHARED_BUCKETS[feature];
    const chosen = effectiveAiDailyLimit(entitlement.dailyLimit, setting.dailyLimit);
    // S21 and S20 keep their built-in ceiling when neither the plan nor the admin sets a limit.
    const dailyLimit = chosen ?? shared?.ceiling ?? null;
    const checksLimit = shared === undefined || options.usage !== undefined;
    const platformOn = options.platform?.[kind] !== false && (kind !== 'model' || dispatchAllowed);
    let state: AiFeatureState;
    if (!platformOn) state = off(feature, 'platform_off', dailyLimit);
    // Each readiness probe caches a "yes" per database handle, so asking again is free.
    else if (!(await FEATURE_READY[feature](db))) state = off(feature, 'not_available_yet');
    else if (!setting.enabled) state = off(feature, 'turned_off', dailyLimit);
    else if (!entitlement.included) state = off(feature, 'not_in_plan', dailyLimit);
    else if (
      checksLimit &&
      options.alreadyCounted !== true &&
      dailyLimit !== null &&
      subject !== null &&
      (options.usage?.get(feature) ?? (await usedToday(db, feature, subject, now))) >= dailyLimit
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
  options: AiFeatureStateOptions & { readonly alreadyCounted?: boolean } = {},
): Promise<Result<AiFeatureGate, AiFeatureState>> {
  const [resolved] = await resolveStates(db, [feature], contextSubject(context), options);
  if (!resolved) {
    return err({ feature, available: false, reason: 'turned_off', dailyLimit: null });
  }
  if (!resolved.state.available) return err(resolved.state);
  return ok({ feature, dailyLimit: resolved.state.dailyLimit, subject: resolved.subject });
}

/**
 * One counted use (or one used scan cover), so it can be given back. Made only by
 * `chargeAiFeatureUse` and `useScanCover`; a copied or made-up object is never accepted.
 */
export interface AiFeatureCharge {
  readonly feature: AiFeatureKey;
  /** False when nothing was counted (staff, a feature that counts its own way, a used cover). */
  readonly counted: boolean;
}

interface ChargeRecord {
  readonly subjectId: string;
  /** The bucket counted, or for a used cover, the cover it came from. */
  readonly action: string;
  readonly windowStart: Date;
  /** `use`: giving back lowers the count; `cover`: giving back puts the used cover back. */
  readonly kind: 'use' | 'cover';
  /** `refunding` while the give-back is being written; `refunded` only once it was. */
  state: 'open' | 'refunding' | 'refunded';
}
const CHARGES = new WeakMap<AiFeatureCharge, ChargeRecord>();

/** Adds one to a bucket, always (no limit). Returns the new count. */
async function addOne(db: Db, subjectId: string, action: string, window: Date): Promise<number> {
  const bucket = schema.rateLimitBuckets;
  const rows = await db
    .insert(bucket)
    .values({ subjectId, action, windowStart: window, count: 1 })
    .onConflictDoUpdate({
      target: [bucket.subjectId, bucket.action, bucket.windowStart],
      set: { count: sql`${bucket.count} + 1`, updatedAt: sql`now()` },
    })
    .returning({ count: bucket.count });
  return rows[0]?.count ?? 1;
}

/**
 * Counts one use against today's bucket, last, inside the transaction that does the work: null
 * when the daily limit is already reached (nothing is counted then). With no limit the use is
 * still counted, for the AI Use Today page. A use is never counted twice: the count only rises
 * while it is under the limit, in one statement, so two calls at once cannot both pass it.
 */
export async function chargeAiFeatureUse(
  db: Db,
  gate: AiFeatureGate,
  options: { readonly now?: Date } = {},
): Promise<AiFeatureCharge | null> {
  if (gate.subject === null || !countedHere(gate.feature)) {
    return Object.freeze({ feature: gate.feature, counted: false });
  }
  const limit = gate.dailyLimit;
  if (limit !== null && limit <= 0) return null;
  const bucket = schema.rateLimitBuckets;
  const action = usageAction(gate.feature);
  const window = windowStart(options.now ?? new Date());
  const rows = await db
    .insert(bucket)
    .values({ subjectId: gate.subject.id, action, windowStart: window, count: 1 })
    .onConflictDoUpdate({
      target: [bucket.subjectId, bucket.action, bucket.windowStart],
      set: { count: sql`${bucket.count} + 1`, updatedAt: sql`now()` },
      ...(limit !== null ? { setWhere: sql`${bucket.count} < ${limit}` } : {}),
    })
    .returning({ count: bucket.count });
  if (rows.length === 0) return null;
  const charge: AiFeatureCharge = Object.freeze({ feature: gate.feature, counted: true });
  CHARGES.set(charge, {
    subjectId: gate.subject.id,
    action,
    windowStart: window,
    kind: 'use',
    state: 'open',
  });
  return charge;
}

/**
 * The cover a counted scan that read text leaves for the reading of the same file's details
 * (S28 rounds 4 and 5): one bucket row per person, feature and file version per UTC day, in
 * `rate_limit_buckets` (no migration), holding at most one free details reading. Every cover read
 * and every cover use goes through this one definition: the person, the action, today's or
 * yesterday's window (a scan at 23:40 UTC, its details at 00:30), and a count above zero. A cover
 * kept into the next day still stands for exactly one counted scan; only which day's limit the
 * free details fall on shifts.
 */
function scanCover(feature: AiFeatureKey, accountId: string, documentVersionId: string, now: Date) {
  const bucket = schema.rateLimitBuckets;
  const action = `ai_scan_cover:${feature}:${documentVersionId}`;
  const today = windowStart(now);
  const yesterday = new Date(today.getTime() - AI_FEATURE_WINDOW_MS);
  return {
    action,
    waiting: and(
      eq(bucket.subjectId, accountId),
      eq(bucket.action, action),
      inArray(bucket.windowStart, [today, yesterday]),
      gt(bucket.count, 0),
    ),
  };
}

/**
 * Leaves the cover for a scan that was counted (`charge`) and read text: set to exactly one in
 * the window the scan was counted in, so scanning the same file again never stores up more than
 * one free details reading. A scan that failed, read nothing or was not counted leaves none.
 */
export async function leaveScanCover(
  db: Db,
  charge: AiFeatureCharge | null,
  documentVersionId: string,
): Promise<void> {
  const record = charge ? CHARGES.get(charge) : undefined;
  if (!charge || !record || record.kind !== 'use' || record.state !== 'open') return;
  const bucket = schema.rateLimitBuckets;
  const { action } = scanCover(charge.feature, record.subjectId, documentVersionId, new Date());
  await db
    .insert(bucket)
    .values({ subjectId: record.subjectId, action, windowStart: record.windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [bucket.subjectId, bucket.action, bucket.windowStart],
      set: { count: 1, updatedAt: sql`now()` },
    });
}

/** Whether a cover is waiting for this file's details (read only, nothing is used). */
export async function hasScanCover(
  db: Db,
  gate: AiFeatureGate,
  documentVersionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (gate.subject?.kind !== 'account' || !countedHere(gate.feature)) return false;
  const bucket = schema.rateLimitBuckets;
  const cover = scanCover(gate.feature, gate.subject.id, documentVersionId, now);
  const rows = await db.select({ id: bucket.id }).from(bucket).where(cover.waiting).limit(1);
  return rows.length > 0;
}

/**
 * Uses one cover a counted scan of this very file left for this feature and person: one
 * conditional statement that takes one from a cover still above zero, so a cover is never used
 * twice, even by two calls at once. Null when there is none: the details are then counted as
 * usual. The result can be given back (`refundAiFeatureUse`) when the details made no model call
 * after all.
 */
export async function useScanCover(
  db: Db,
  gate: AiFeatureGate,
  documentVersionId: string,
  now: Date = new Date(),
): Promise<AiFeatureCharge | null> {
  if (gate.subject?.kind !== 'account' || !countedHere(gate.feature)) return null;
  const bucket = schema.rateLimitBuckets;
  const cover = scanCover(gate.feature, gate.subject.id, documentVersionId, now);
  const newest = db
    .select({ id: bucket.id })
    .from(bucket)
    .where(cover.waiting)
    .orderBy(desc(bucket.windowStart))
    .limit(1);
  const rows = await db
    .update(bucket)
    .set({ count: sql`${bucket.count} - 1`, updatedAt: sql`now()` })
    .where(and(gt(bucket.count, 0), inArray(bucket.id, newest)))
    .returning({ windowStart: bucket.windowStart });
  const used = rows[0];
  if (!used) return null;
  const charge: AiFeatureCharge = Object.freeze({ feature: gate.feature, counted: false });
  CHARGES.set(charge, {
    subjectId: gate.subject.id,
    action: cover.action,
    windowStart: used.windowStart,
    kind: 'cover',
    state: 'open',
  });
  return charge;
}

/**
 * Gives one counted use back, never below zero and only once: for a call that was counted and then
 * made no model call (the kill switch stopped it) or ended refused. Refusals are free. A used
 * cover is put back. The charge is marked given back only after the database took it; a second
 * give-back of the same charge, even one started while the first is being written, does nothing,
 * and a failed one can be tried again. The count goes back to the day it was counted in.
 */
export async function refundAiFeatureUse(db: Db, charge: AiFeatureCharge | null): Promise<void> {
  const record = charge ? CHARGES.get(charge) : undefined;
  if (!record || record.state !== 'open') return;
  record.state = 'refunding';
  try {
    if (record.kind === 'cover') {
      await addOne(db, record.subjectId, record.action, record.windowStart);
    } else {
      const key = { subjectId: record.subjectId, action: record.action };
      await refundRateLimitWindow(db, key, record.windowStart);
    }
  } catch (error) {
    record.state = 'open';
    throw error;
  }
  record.state = 'refunded';
}

/** The platform owner's saved daily limit for one feature, in one read; null when none. */
async function savedDailyLimit(db: Db, feature: AiFeatureKey): Promise<number | null> {
  try {
    const rows = await db
      .select({ dailyLimit: schema.platformAiFeatureSettings.dailyLimit })
      .from(schema.platformAiFeatureSettings)
      .where(eq(schema.platformAiFeatureSettings.featureKey, feature))
      .limit(1);
    return rows[0]?.dailyLimit ?? null;
  } catch {
    // Before the settings table exists there is no saved limit.
    return null;
  }
}

/**
 * Counts an answer already given (AI App Access with no daily limit when the call started), in a
 * statement of its own after the call: always counted, so the count is what was served. If the
 * platform owner set a limit while the call ran, the count can pass it; the next call is then
 * refused, and the overage is reported at most once per person, feature and day (a marker row in
 * the same bucket table, written only by the first report).
 */
export async function countAiUseAfterCall(
  db: Db,
  gate: AiFeatureGate,
  now: Date = new Date(),
): Promise<void> {
  if (gate.subject === null || !countedHere(gate.feature)) return;
  const window = windowStart(now);
  const count = await addOne(db, gate.subject.id, usageAction(gate.feature), window);
  const limit = await savedDailyLimit(db, gate.feature);
  if (limit === null || count <= limit) return;
  const bucket = schema.rateLimitBuckets;
  const first = await db
    .insert(bucket)
    .values({
      subjectId: gate.subject.id,
      action: `ai_feature_overage:${gate.feature}`,
      windowStart: window,
      count: 1,
    })
    .onConflictDoNothing()
    .returning({ id: bucket.id });
  if (first.length === 0) return;
  console.error(
    formatObservabilityLine(
      serverErrorEvent(
        'aiFeatureOverage',
        new Error('answers were counted past a daily limit set while they ran'),
        { feature: gate.feature },
      ),
    ),
  );
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
  const usage = await usageToday(db, who, now);
  const resolved = await resolveStates(db, AI_FEATURE_KEYS, who, { ...options, now, usage });
  const features: AiUsageToday[] = resolved.map(({ state }) => ({
    feature: state.feature,
    name: AI_FEATURES[state.feature].name,
    unit: AI_FEATURES[state.feature].unit,
    used: usage.get(state.feature) ?? 0,
    dailyLimit: state.dailyLimit,
    available: state.available,
    reason: state.reason,
  }));
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
