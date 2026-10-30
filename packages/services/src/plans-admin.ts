import { type Result, err, isIsoCurrencyCode, normalizeCurrencyCode, ok } from '@visastack/core';
import {
  AI_FEATURE_LIMIT_MAX,
  AI_FEATURE_LIMIT_MIN,
  AI_PLAN_TIERS,
} from '@visastack/core/ai-features';
import {
  CAPACITY_KEYS,
  type CapacityKey,
  type EntitlementKey,
  aiFeatureOfKey,
  entitlementDefinition,
  entitlementKeys,
  isCapacityKey,
  isEntitlementKey,
} from '@visastack/core/entitlements';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { StaffScope } from './access/principal';
import { staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, schema } from './db';
import { TRAVELLER_PLAN_KEY } from './entitlements';
import { type ServiceError, refusal, serviceError } from './errors';
import { type PlanAudience, entitlementsSchemaPresent, planColumns } from './plans-schema';

/**
 * The Plans page (S29, ADR 0020 S29 amendment, audit M1): the platform owner creates plans, sets
 * each plan's limits, AI features and price, and retires plans, without SQL.
 *
 * - Owner only (`PLANS_MANAGE`, held by no other role), a fresh sign-in check for every save, and
 *   every change audited with what it was before and after.
 * - Only after migration 0107 (`entitlementsSchemaPresent`); before it nothing can be saved.
 * - A price change is a new `plan_prices` row in effect from now. An invoice takes the price in
 *   effect when its billing period started, so the change applies from each agency's next period
 *   and an invoice already made never changes.
 * - A plan's period length is fixed once any agency has been on it (it would move every billing
 *   date).
 * - Retiring keeps the plan for agencies already on it; nobody new can be put on it. Traveller Free
 *   and the plan new agencies start on (Founding Access) cannot be retired.
 * - The old limit columns on `plans` are kept equal to the rules (they are what code before S29
 *   reads), so going back to an earlier release never meets a plan it does not understand.
 */

/** The plan every new agency starts on (organizations.ts, founding-access.ts). */
export const DEFAULT_AGENCY_PLAN_KEY = 'agency_founding_access';

/** The first price of a plan applies from before any billing period could start. */
export const PLAN_PRICE_FROM_START = new Date('2000-01-01T00:00:00Z');

/** The plan every new agency starts on keeps a price of zero in its currency (S29 round 2). */
export const DEFAULT_PLAN_PRICE_NEEDED =
  'Every new agency starts on this plan, so it keeps a price of 0. Enter 0 and its currency, for example 0 and USD.';

/** Why plans cannot be changed yet. */
export const PLANS_UNAVAILABLE = 'Plans can be changed after the database update.';

export const PLAN_NAME_MAX = 80;
export const PLAN_PERIOD_DAYS_MAX = 366;
/** The largest price (the column is a 32-bit whole number of minor units). */
export const PLAN_PRICE_MAX_MINOR_UNITS = 2_147_483_647;
const INT_COLUMN_MAX = 2_147_483_647;

export interface PlanRuleInput {
  readonly included: boolean;
  /** Null: no limit. */
  readonly limit: number | null;
}

export interface PlanPriceInput {
  readonly priceMinorUnits: number;
  readonly currency: string;
}

export interface PlanDraft {
  readonly name: string;
  readonly periodDays: number;
  /** Null: the plan has no price (it is never invoiced). */
  readonly price: PlanPriceInput | null;
  /** One entry per registry key; a key left out keeps what the plan has. */
  readonly rules: Readonly<Partial<Record<EntitlementKey, PlanRuleInput>>>;
}

/** Which field a refusal is about, so the form can point at it. */
export type PlanField = 'name' | 'periodDays' | 'price' | 'currency' | EntitlementKey;

export type PlanRefusal = ServiceError & { readonly field?: PlanField };

function refuse(message: string, field?: PlanField): PlanRefusal {
  return field ? { ...serviceError('invalid', message), field } : serviceError('invalid', message);
}

function limitMax(key: EntitlementKey): number {
  if (key === 'storage_bytes') return Number.MAX_SAFE_INTEGER;
  if (aiFeatureOfKey(key) !== null) return AI_FEATURE_LIMIT_MAX;
  return INT_COLUMN_MAX;
}

/** The first problem with a draft, worded for the owner, or undefined. */
export function planDraftProblem(draft: PlanDraft): PlanRefusal | undefined {
  const name = draft.name.trim();
  if (name.length === 0) return refuse('Enter a name for the plan.', 'name');
  if (name.length > PLAN_NAME_MAX) {
    return refuse(`Keep the name to ${PLAN_NAME_MAX} characters.`, 'name');
  }
  if (
    !Number.isSafeInteger(draft.periodDays) ||
    draft.periodDays < 1 ||
    draft.periodDays > PLAN_PERIOD_DAYS_MAX
  ) {
    return refuse(
      `Enter the billing period as a whole number of days from 1 to ${PLAN_PERIOD_DAYS_MAX}.`,
      'periodDays',
    );
  }
  if (draft.price !== null) {
    if (
      !Number.isSafeInteger(draft.price.priceMinorUnits) ||
      draft.price.priceMinorUnits < 0 ||
      draft.price.priceMinorUnits > PLAN_PRICE_MAX_MINOR_UNITS
    ) {
      return refuse('Enter the price as an amount of zero or more.', 'price');
    }
    if (!isIsoCurrencyCode(draft.price.currency)) {
      return refuse('Enter a three-letter currency code, for example BDT.', 'currency');
    }
  }
  for (const [key, rule] of Object.entries(draft.rules)) {
    if (!isEntitlementKey(key) || rule === undefined) {
      return refuse('This plan has a rule VisaStack does not know. Reload the page.');
    }
    // S29 round 2: an AI feature's daily limit is from 1 (a feature at 0 a day is simply off).
    // S28 round 2: an AI feature that is on may have no plan limit (empty): the admin's daily
    // limit on the AI Features page still applies, so the six features that start with no limit
    // keep saving.
    if (aiFeatureOfKey(key) !== null && rule.included) {
      if (rule.limit === null) continue;
      if (
        !Number.isSafeInteger(rule.limit) ||
        rule.limit < AI_FEATURE_LIMIT_MIN ||
        rule.limit > AI_FEATURE_LIMIT_MAX
      ) {
        return refuse(
          `Enter the daily limit for ${entitlementDefinition(key).name} as a whole number from ${AI_FEATURE_LIMIT_MIN} to ${AI_FEATURE_LIMIT_MAX}, or leave it empty for no plan limit.`,
          key,
        );
      }
      continue;
    }
    if (rule.limit !== null) {
      if (!rule.included) {
        return refuse(`${entitlementDefinition(key).name} is off, so it has no limit.`, key);
      }
      const max = limitMax(key);
      if (!Number.isSafeInteger(rule.limit) || rule.limit < 0 || rule.limit > max) {
        return refuse(
          `Enter ${entitlementDefinition(key).name} as a whole number from 0 to ${max.toLocaleString('en-US')}, or choose Unlimited.`,
          key,
        );
      }
    }
  }
  return undefined;
}

type Rules = Record<EntitlementKey, PlanRuleInput>;

/**
 * Team Members and Invitations always follow Team Members (S29 round 2, as `updatePlan` keeps
 * them): the Plans page edits only Team Members; the invitations key stays internal.
 */
export function withInvitationsFollowingSeats(rules: Readonly<Partial<Rules>>): Partial<Rules> {
  const { invitations: _ignored, ...rest } = rules;
  return rest.seats ? { ...rest, invitations: rest.seats } : rest;
}

async function currentRules(tx: Db, planId: string): Promise<Partial<Rules>> {
  const e = schema.planEntitlements;
  const rows = await tx
    .select({ key: e.key, included: e.included, limit: e.limitValue })
    .from(e)
    .where(eq(e.planId, planId));
  const rules: Partial<Rules> = {};
  for (const row of rows) {
    if (isEntitlementKey(row.key)) rules[row.key] = { included: row.included, limit: row.limit };
  }
  return rules;
}

async function latestPrice(tx: Db, planId: string): Promise<PlanPriceInput | null> {
  const pp = schema.planPrices;
  const row = first(
    await tx
      .select({ price: pp.priceMinorUnits, currency: pp.currency })
      .from(pp)
      .where(eq(pp.planId, planId))
      .orderBy(desc(pp.effectiveFrom))
      .limit(1),
  );
  return row && row.price !== null && row.currency !== null
    ? { priceMinorUnits: row.price, currency: row.currency }
    : null;
}

function samePrice(a: PlanPriceInput | null, b: PlanPriceInput | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.priceMinorUnits === b.priceMinorUnits &&
    normalizeCurrencyCode(a.currency) === normalizeCurrencyCode(b.currency)
  );
}

/** The old column a capacity key is kept equal to (invitations have none: they used seats). */
const LEGACY_COLUMN: Readonly<Partial<Record<CapacityKey, string>>> = {
  seats: 'seatsAllowed',
  cases_per_period: 'casesPerPeriodAllowed',
  open_cases: 'concurrentOpenCasesAllowed',
  storage_bytes: 'storageBytesAllowed',
  ai_allowance_units: 'aiAllowanceUnitsAllowed',
};

/**
 * Writes rule rows (insert or replace) and keeps the old limit columns equal. Returns what changed,
 * keyed by entitlement key, for the audit. Inside the caller's transaction, after 0107.
 */
export async function writePlanRules(
  tx: Db,
  planId: string,
  next: Readonly<Partial<Rules>>,
  now: Date,
): Promise<
  Record<string, { readonly before: PlanRuleInput | null; readonly after: PlanRuleInput }>
> {
  const before = await currentRules(tx, planId);
  const changes: Record<string, { before: PlanRuleInput | null; after: PlanRuleInput }> = {};
  const columns: Record<string, number | null> = {};
  for (const [key, rule] of Object.entries(next) as [EntitlementKey, PlanRuleInput | undefined][]) {
    if (!rule) continue;
    const was = before[key] ?? null;
    if (was && was.included === rule.included && was.limit === rule.limit) continue;
    const per = entitlementDefinition(key).per;
    await tx
      .insert(schema.planEntitlements)
      .values({ planId, key, included: rule.included, limitValue: rule.limit, per, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.planEntitlements.planId, schema.planEntitlements.key],
        set: { included: rule.included, limitValue: rule.limit, updatedAt: now },
      });
    changes[key] = { before: was, after: rule };
    const column = isCapacityKey(key) ? LEGACY_COLUMN[key] : undefined;
    if (column) columns[column] = rule.included ? rule.limit : 0;
  }
  if (Object.keys(columns).length > 0) {
    await tx
      .update(schema.plans)
      .set({ ...columns, updatedAt: now })
      .where(eq(schema.plans.id, planId));
  }
  return changes;
}

/**
 * Records a new price from `effectiveFrom` (and the plan's own price columns, kept equal to the
 * newest price). Nothing is written when the price is unchanged. Inside the caller's transaction.
 */
export async function writePlanPrice(
  tx: Db,
  planId: string,
  price: PlanPriceInput | null,
  input: {
    readonly effectiveFrom: Date;
    readonly actorAccountId: string | null;
    readonly now: Date;
  },
): Promise<{
  readonly before: PlanPriceInput | null;
  readonly after: PlanPriceInput | null;
} | null> {
  const before = await latestPrice(tx, planId);
  const normalized =
    price === null
      ? null
      : { priceMinorUnits: price.priceMinorUnits, currency: normalizeCurrencyCode(price.currency) };
  const hasRow = first(
    await tx
      .select({ id: schema.planPrices.id })
      .from(schema.planPrices)
      .where(eq(schema.planPrices.planId, planId))
      .limit(1),
  );
  if (hasRow && samePrice(before, normalized)) return null;
  await tx.insert(schema.planPrices).values({
    planId,
    priceMinorUnits: normalized?.priceMinorUnits ?? null,
    currency: normalized?.currency ?? null,
    effectiveFrom: input.effectiveFrom,
    createdByAccountId: input.actorAccountId,
  });
  await tx
    .update(schema.plans)
    .set({
      priceMinorUnits: normalized?.priceMinorUnits ?? null,
      currency: normalized?.currency ?? null,
      updatedAt: input.now,
    })
    .where(eq(schema.plans.id, planId));
  return { before, after: normalized };
}

/** Rules for every capacity key from a plan's old columns (a plan made by the older call). */
export function rulesFromColumns(plan: {
  readonly seatsAllowed: number | null;
  readonly casesPerPeriodAllowed: number | null;
  readonly concurrentOpenCasesAllowed: number | null;
  readonly storageBytesAllowed: number | null;
  readonly aiAllowanceUnitsAllowed: number | null;
}): Record<CapacityKey, PlanRuleInput> {
  const rule = (limit: number | null): PlanRuleInput => ({ included: true, limit });
  return {
    seats: rule(plan.seatsAllowed),
    invitations: rule(plan.seatsAllowed),
    cases_per_period: rule(plan.casesPerPeriodAllowed),
    open_cases: rule(plan.concurrentOpenCasesAllowed),
    storage_bytes: rule(plan.storageBytesAllowed),
    ai_allowance_units: rule(plan.aiAllowanceUnitsAllowed),
  };
}

// --- The Plans page ------------------------------------------------------------------------

export interface PlanAdminView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly audience: PlanAudience;
  readonly active: boolean;
  readonly bypassLimits: boolean;
  readonly periodDays: number;
  /** The newest price (what an agency's next period will cost). */
  readonly price: PlanPriceInput | null;
  /** Every registry key, with what the plan says (a key with no row reads as on, no limit). */
  readonly rules: Readonly<Rules>;
  /** Agencies on it now; for the traveller plan, every account. */
  readonly onIt: number;
  /** Whether any agency has ever been on it (its period length is then fixed). */
  readonly periodLocked: boolean;
  /** Why it cannot be retired, or null when it can. */
  readonly retireBlocked: 'traveller' | 'default' | 'retired' | null;
}

export interface PlansAdminList {
  /** False before migration 0107: the page shows the plans and saves nothing. */
  readonly available: boolean;
  readonly plans: readonly PlanAdminView[];
}

function retireBlock(plan: { key: string; active: boolean }): PlanAdminView['retireBlocked'] {
  if (plan.key === TRAVELLER_PLAN_KEY) return 'traveller';
  if (plan.key === DEFAULT_AGENCY_PLAN_KEY) return 'default';
  if (!plan.active) return 'retired';
  return null;
}

function standardRule(key: EntitlementKey, audience: PlanAudience): PlanRuleInput {
  // An AI feature with no row is not part of an agency plan; on the traveller plan it is the
  // built-in daily limit (entitlements.ts reads it the same way).
  const feature = aiFeatureOfKey(key);
  if (feature === null) return { included: true, limit: null };
  if (audience !== 'TRAVELLER') return { included: false, limit: null };
  const free = AI_PLAN_TIERS.FREE[feature];
  return { included: free.included, limit: free.dailyLimit };
}

/** Every plan with its rules and price, newest first, for the Plans page. Owner only. */
export async function listPlansForAdmin(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
): Promise<Result<PlansAdminList, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PLANS_MANAGE');
  if (denied) return err(denied);
  const available = await entitlementsSchemaPresent(db);
  // A fixed number of queries, whatever the number of plans: the plans with their counts, then
  // (after 0107) every rule row and every plan's newest price, then the traveller count.
  const plans = await db
    .select({
      plan: planColumns(),
      onIt: sql<number>`(select count(*)::int from subscriptions c where c.plan_id = ${schema.plans.id} and c.ended_at is null)`,
      ever: sql<number>`(select count(*)::int from subscriptions e where e.plan_id = ${schema.plans.id})`,
    })
    .from(schema.plans)
    .orderBy(desc(schema.plans.createdAt));
  const storedRules = new Map<string, Partial<Rules>>();
  const latestPrices = new Map<string, PlanPriceInput | null>();
  if (available) {
    const e = schema.planEntitlements;
    for (const row of await db
      .select({ planId: e.planId, key: e.key, included: e.included, limit: e.limitValue })
      .from(e)) {
      if (!isEntitlementKey(row.key)) continue;
      const rules = storedRules.get(row.planId) ?? {};
      rules[row.key] = { included: row.included, limit: row.limit };
      storedRules.set(row.planId, rules);
    }
    const pp = schema.planPrices;
    for (const row of await db
      .selectDistinctOn([pp.planId], {
        planId: pp.planId,
        price: pp.priceMinorUnits,
        currency: pp.currency,
      })
      .from(pp)
      .orderBy(pp.planId, desc(pp.effectiveFrom))) {
      latestPrices.set(
        row.planId,
        row.price !== null && row.currency !== null
          ? { priceMinorUnits: row.price, currency: row.currency }
          : null,
      );
    }
  }
  const travellers = await travellerCount(db);
  const views: PlanAdminView[] = [];
  for (const row of plans) {
    const plan = row.plan;
    const rules = {} as Rules;
    const stored = storedRules.get(plan.id) ?? {};
    const fromColumns = rulesFromColumns(plan);
    for (const key of entitlementKeys()) {
      rules[key] =
        stored[key] ??
        (available
          ? standardRule(key, plan.audience)
          : isCapacityKey(key)
            ? fromColumns[key]
            : standardRule(key, plan.audience));
    }
    const price = available
      ? (latestPrices.get(plan.id) ?? null)
      : plan.priceMinorUnits !== null && plan.currency !== null
        ? { priceMinorUnits: plan.priceMinorUnits, currency: plan.currency }
        : null;
    views.push({
      id: plan.id,
      key: plan.key,
      name: plan.name,
      audience: plan.audience,
      active: plan.active,
      bypassLimits: plan.bypassLimits,
      periodDays: plan.periodDays,
      price,
      rules,
      onIt: plan.key === TRAVELLER_PLAN_KEY ? travellers : row.onIt,
      periodLocked: row.ever > 0,
      retireBlocked: retireBlock(plan),
    });
  }
  return ok({ available, plans: views });
}

/**
 * Accounts on the traveller plan: every account, because each one uses it for its own record,
 * agency members included (S29 round 3; the resolver gives every account this plan).
 */
async function travellerCount(db: Db): Promise<number> {
  const row = first(await db.select({ n: sql<number>`count(*)::int` }).from(schema.accounts));
  return row?.n ?? 0;
}

/**
 * One plan's newest price, for the Plans page's save (S29 round 2: it reads only that plan, never
 * the whole list). Owner only. Null when the plan has no price; not found when it does not exist.
 */
export async function getPlanLatestPrice(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
  planId: string,
): Promise<Result<PlanPriceInput | null, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PLANS_MANAGE');
  if (denied) return err(denied);
  const plan = first(
    await db
      .select({
        id: schema.plans.id,
        price: schema.plans.priceMinorUnits,
        currency: schema.plans.currency,
      })
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1),
  );
  if (!plan) return err(serviceError('not_found', 'This plan was not found. Reload the page.'));
  if (!(await entitlementsSchemaPresent(db))) {
    return ok(
      plan.price !== null && plan.currency !== null
        ? { priceMinorUnits: plan.price, currency: plan.currency }
        : null,
    );
  }
  return ok(await latestPrice(db, planId));
}

export interface SavePlanInput {
  /** Absent: a new plan. */
  readonly planId?: string;
  readonly draft: PlanDraft;
  readonly stepUpSatisfied: boolean;
  readonly now?: Date;
}

export interface SavedPlan {
  readonly planId: string;
  readonly created: boolean;
  readonly changed: boolean;
  /** Set when the price changed: it applies from each agency's next billing period. */
  readonly priceChanged: boolean;
}

/** A plan key nobody types: from the name, with a short random end so two names never clash. */
function newPlanKey(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const tail = crypto.randomUUID().replace(/-/g, '').slice(0, 6);
  return `agency_${slug.length > 0 ? slug : 'plan'}_${tail}`;
}

/**
 * Creates a plan or saves an existing one: its name, period, price and rules. Owner only, with a
 * fresh sign-in check, after migration 0107. A new plan is an agency plan; the traveller plan is
 * Traveller Free. Audited (PLAN_CREATED or PLAN_UPDATED with each change before and after, and
 * PLAN_PRICE_CHANGED for a new price).
 */
export async function savePlan(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
  input: SavePlanInput,
): Promise<Result<SavedPlan, PlanRefusal>> {
  const denied = staffScopeProblem(staff, 'PLANS_MANAGE');
  if (denied) return err(denied);
  const problem = planDraftProblem(input.draft);
  if (problem) return err(problem);
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'changing plans requires reauthentication'));
  }
  if (!(await entitlementsSchemaPresent(db))) {
    return err(refusal('plans_unavailable', PLANS_UNAVAILABLE));
  }
  const now = input.now ?? new Date();
  const name = input.draft.name.trim();
  try {
    return await db.transaction(async (tx): Promise<Result<SavedPlan, PlanRefusal>> => {
      if (input.planId === undefined) {
        const key = newPlanKey(name);
        const [created] = await tx
          .insert(schema.plans)
          .values({
            key,
            name,
            periodDays: input.draft.periodDays,
            audience: 'AGENCY',
            bypassLimits: false,
          })
          .returning({ id: schema.plans.id });
        if (!created) throw new Error('expected the new plan to be returned');
        const given = withInvitationsFollowingSeats(input.draft.rules);
        const rules: Partial<Rules> = {};
        for (const k of entitlementKeys()) {
          rules[k] = given[k] ?? standardRule(k, 'AGENCY');
        }
        await writePlanRules(tx, created.id, rules, now);
        await writePlanPrice(tx, created.id, input.draft.price, {
          effectiveFrom: PLAN_PRICE_FROM_START,
          actorAccountId: staff.accountId,
          now,
        });
        await appendAuditEvent(tx, {
          eventType: 'PLAN_CREATED',
          actorAccountId: staff.accountId,
          action: 'MANAGE',
          method: 'MANUAL',
          result: 'ALLOWED',
          resourceType: 'plan',
          resourceId: created.id,
          metadata: {
            key,
            after: { name, periodDays: input.draft.periodDays, price: input.draft.price, rules },
          },
        });
        return ok({ planId: created.id, created: true, changed: true, priceChanged: false });
      }

      const plan = first(
        await tx
          .select(planColumns())
          .from(schema.plans)
          .where(eq(schema.plans.id, input.planId))
          .limit(1)
          .for('update'),
      );
      if (!plan) return err(serviceError('not_found', 'This plan was not found. Reload the page.'));
      if (
        plan.bypassLimits &&
        input.draft.price !== null &&
        input.draft.price.priceMinorUnits > 0
      ) {
        // The plan every new agency starts on keeps a price of 0, so it says so rather than
        // "leave it empty", which it would then refuse (S29 round 3).
        return err(
          refuse(
            plan.key === DEFAULT_AGENCY_PLAN_KEY
              ? DEFAULT_PLAN_PRICE_NEEDED
              : 'A complimentary plan has no price. Leave the price empty.',
            'price',
          ),
        );
      }
      if (plan.key === DEFAULT_AGENCY_PLAN_KEY && input.draft.price === null) {
        return err(refuse(DEFAULT_PLAN_PRICE_NEEDED, 'price'));
      }
      if (plan.audience === 'TRAVELLER' && input.draft.price !== null) {
        return err(refuse('The traveller plan has no price.', 'price'));
      }
      const changes: {
        name?: { readonly before: string; readonly after: string };
        periodDays?: { readonly before: number; readonly after: number };
      } = {};
      const set: { name?: string; periodDays?: number; updatedAt?: Date } = {};
      if (plan.name !== name) {
        set.name = name;
        changes.name = { before: plan.name, after: name };
      }
      if (plan.periodDays !== input.draft.periodDays) {
        const ever = first(
          await tx
            .select({ n: count() })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.planId, plan.id)),
        );
        if ((ever?.n ?? 0) > 0) {
          return err({
            ...refusal(
              'period_locked',
              'The billing period cannot change once an agency has been on this plan. Make a new plan instead.',
            ),
            field: 'periodDays',
          });
        }
        set.periodDays = input.draft.periodDays;
        changes.periodDays = { before: plan.periodDays, after: input.draft.periodDays };
      }
      if (Object.keys(set).length > 0) {
        await tx
          .update(schema.plans)
          .set({ ...set, updatedAt: now })
          .where(eq(schema.plans.id, plan.id));
      }
      const ruleChanges = await writePlanRules(
        tx,
        plan.id,
        withInvitationsFollowingSeats(input.draft.rules),
        now,
      );
      const priceChange = await writePlanPrice(tx, plan.id, input.draft.price, {
        effectiveFrom: now,
        actorAccountId: staff.accountId,
        now,
      });
      const changed =
        Object.keys(changes).length > 0 ||
        Object.keys(ruleChanges).length > 0 ||
        priceChange !== null;
      if (Object.keys(changes).length > 0 || Object.keys(ruleChanges).length > 0) {
        await appendAuditEvent(tx, {
          eventType: 'PLAN_UPDATED',
          actorAccountId: staff.accountId,
          action: 'MANAGE',
          method: 'MANUAL',
          result: 'ALLOWED',
          resourceType: 'plan',
          resourceId: plan.id,
          metadata: { key: plan.key, changes, rules: ruleChanges },
        });
      }
      if (priceChange) {
        await appendAuditEvent(tx, {
          eventType: 'PLAN_PRICE_CHANGED',
          actorAccountId: staff.accountId,
          action: 'MANAGE',
          method: 'MANUAL',
          result: 'ALLOWED',
          resourceType: 'plan',
          resourceId: plan.id,
          metadata: {
            key: plan.key,
            before: priceChange.before,
            after: priceChange.after,
            effectiveFrom: now.toISOString(),
          },
        });
      }
      return ok({ planId: plan.id, created: false, changed, priceChanged: priceChange !== null });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(
        serviceError(
          'stale',
          'Someone saved this plan at the same moment. Reload the page and try again.',
        ),
      );
    }
    throw error;
  }
}

export interface RetirePreview {
  /** Agencies on the plan now: they keep it. */
  readonly agenciesOnIt: number;
  /** Scheduled plan changes still waiting to move an agency onto this plan (retiring waits for them). */
  readonly pendingDowngrades: number;
}

async function pendingDowngradesTo(db: Db, planId: string): Promise<number> {
  const d = schema.scheduledDowngrades;
  const row = first(
    await db
      .select({ n: count() })
      .from(d)
      .where(and(eq(d.toPlanId, planId), eq(d.status, 'PENDING'))),
  );
  return row?.n ?? 0;
}

/** Why a plan with waiting plan changes to it cannot be retired yet, in plain words. */
export function pendingDowngradesSentence(n: number): string {
  return n === 1
    ? "1 scheduled plan change still moves an agency to this plan. Cancel it on that agency's page first, then retire the plan."
    : `${n} scheduled plan changes still move agencies to this plan. Cancel them on those agencies' pages first, then retire the plan.`;
}

/** How many agencies keep a plan that is retired now. Owner only. */
export async function previewPlanRetire(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
  planId: string,
): Promise<Result<RetirePreview, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PLANS_MANAGE');
  if (denied) return err(denied);
  const row = first(
    await db
      .select({ n: count() })
      .from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.planId, planId), isNull(schema.subscriptions.endedAt))),
  );
  return ok({
    agenciesOnIt: row?.n ?? 0,
    pendingDowngrades: await pendingDowngradesTo(db, planId),
  });
}

/**
 * Retires a plan: nobody new can be put on it, and agencies already on it keep it with its limits
 * and price. Refused for Traveller Free and for the plan every new agency starts on. Owner only,
 * with a fresh sign-in check, after 0107. Audited (PLAN_RETIRED).
 */
export async function retirePlan(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
  input: { readonly planId: string; readonly stepUpSatisfied: boolean; readonly now?: Date },
): Promise<Result<{ readonly agenciesKeepingIt: number }, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PLANS_MANAGE');
  if (denied) return err(denied);
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'changing plans requires reauthentication'));
  }
  if (!(await entitlementsSchemaPresent(db))) {
    return err(refusal('plans_unavailable', PLANS_UNAVAILABLE));
  }
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const plan = first(
      await tx
        .select(planColumns())
        .from(schema.plans)
        .where(eq(schema.plans.id, input.planId))
        .limit(1)
        .for('update'),
    );
    if (!plan) return err(serviceError('not_found', 'This plan was not found. Reload the page.'));
    const blocked = retireBlock(plan);
    if (blocked === 'traveller') {
      return err(
        refusal(
          'retire_blocked',
          'Traveller Free is the plan every traveller is on. It cannot be retired.',
        ),
      );
    }
    if (blocked === 'default') {
      return err(
        refusal('retire_blocked', 'Every new agency starts on this plan. It cannot be retired.'),
      );
    }
    if (blocked === 'retired') {
      return err(refusal('retire_blocked', 'This plan is already retired.'));
    }
    const waiting = await pendingDowngradesTo(tx, plan.id);
    if (waiting > 0) return err(refusal('retire_blocked', pendingDowngradesSentence(waiting)));
    await tx
      .update(schema.plans)
      .set({ active: false, updatedAt: now })
      .where(eq(schema.plans.id, plan.id));
    const keeping =
      first(
        await tx
          .select({ n: count() })
          .from(schema.subscriptions)
          .where(
            and(eq(schema.subscriptions.planId, plan.id), isNull(schema.subscriptions.endedAt)),
          ),
      )?.n ?? 0;
    await appendAuditEvent(tx, {
      eventType: 'PLAN_RETIRED',
      actorAccountId: staff.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'plan',
      resourceId: plan.id,
      metadata: {
        key: plan.key,
        before: { active: true },
        after: { active: false },
        agenciesKeepingIt: keeping,
      },
    });
    return ok({ agenciesKeepingIt: keeping });
  });
}

/** The plan audiences a subscription may use: only agency plans go on an agency. */
export function assignableToAgency(plan: { readonly audience: PlanAudience }): boolean {
  return plan.audience === 'AGENCY';
}

/** Capacity keys whose rule is compared when deciding whether a change is a downgrade. */
export const DOWNGRADE_KEYS: readonly CapacityKey[] = CAPACITY_KEYS;
