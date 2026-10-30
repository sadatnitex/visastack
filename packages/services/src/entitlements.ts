import {
  AI_FEATURE_KEYS,
  AI_PLAN_TIERS,
  type AiFeatureEntitlement,
  type AiFeatureKey,
} from '@visastack/core/ai-features';
import {
  CAPACITY_KEYS,
  type CapacityKey,
  aiEntitlementKey,
  isEntitlementKey,
} from '@visastack/core/entitlements';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import { type PlanAudience, entitlementsSchemaPresent, planColumns } from './plans-schema';

/**
 * The one answer to "what may this agency or traveller use right now" (S29, ADR 0020 S29
 * amendment, audit S2). Every limit check, Plan and Usage and the AI feature switches read it, so
 * the number a person sees and the number that stops them can never disagree.
 *
 * What decides, in this order (the `gate`):
 * 1. an active commercial override (a platform owner lifted every limit until a date);
 * 2. a plan that lifts every limit (`bypass_limits`, the complimentary Founding Access offer);
 * 3. the agency's billing being Suspended (new work is paused);
 * 4. the plan's own limits. No plan at all means no limits, never zero (COM-02's rule).
 *
 * An agency is read with one joined query in the caller's transaction. A traveller has no
 * subscription yet: every traveller is on the traveller plan (`traveller_free`) as data. Before
 * migration 0107 the limits come from the plan's old columns and the AI features from the
 * built-in FREE tier, which is exactly what 0107 copies into `plan_entitlements`.
 */

export const TRAVELLER_PLAN_KEY = 'traveller_free';

export type EntitlementSubject =
  | { readonly organizationId: string }
  | { readonly accountId: string | null };

export interface PlanPrice {
  readonly priceMinorUnits: number;
  readonly currency: string;
}

export interface ResolvedPlan {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly active: boolean;
  readonly audience: PlanAudience;
  readonly periodDays: number;
  /** The price of the current billing period; null when the plan has no price. */
  readonly price: PlanPrice | null;
  /** A different price that applies from the next billing period, and from when. */
  readonly nextPrice: (PlanPrice & { readonly from: Date }) | null;
}

export type EntitlementGate = 'override' | 'bypass' | 'suspended' | 'plan';

export interface ResolvedEntitlements {
  readonly plan: ResolvedPlan | null;
  readonly billingStatus: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'CLOSED' | null;
  /** An active commercial override and when it ends. */
  readonly override: { readonly until: Date } | null;
  readonly bypassLimits: boolean;
  /** The plan's limit for each capacity key; null is no limit. */
  readonly limits: Readonly<Record<CapacityKey, number | null>>;
  /**
   * What the plan gives for each AI feature, for a traveller. Null for an agency: agencies have no
   * AI features of their own yet (S22, S28), so the answer is "not applicable", the same before and
   * after migration 0107, never "not in your plan".
   */
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>> | null;
  readonly gate: EntitlementGate;
  /** When the current billing period started (agencies with a plan only). */
  readonly periodStart: Date | null;
  /** Whether the rows came from `plan_entitlements` (after 0107) or the old plan columns. */
  readonly source: 'entitlements' | 'columns';
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanRow = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly active: boolean;
  readonly audience: PlanAudience;
  readonly bypassLimits: boolean;
  readonly periodDays: number;
  readonly priceMinorUnits: number | null;
  readonly currency: string | null;
  readonly seatsAllowed: number | null;
  readonly casesPerPeriodAllowed: number | null;
  readonly concurrentOpenCasesAllowed: number | null;
  readonly storageBytesAllowed: number | null;
  readonly aiAllowanceUnitsAllowed: number | null;
};

type EntitlementRow = {
  readonly key: string;
  readonly included: boolean;
  readonly limit: string | null;
};
type PriceRow = {
  readonly price: number | null;
  readonly currency: string | null;
  readonly from: string;
};

const NO_LIMITS: Readonly<Record<CapacityKey, number | null>> = {
  seats: null,
  invitations: null,
  cases_per_period: null,
  open_cases: null,
  storage_bytes: null,
  ai_allowance_units: null,
};

function columnLimits(plan: PlanRow): Record<CapacityKey, number | null> {
  return {
    seats: plan.seatsAllowed,
    invitations: plan.seatsAllowed,
    cases_per_period: plan.casesPerPeriodAllowed,
    open_cases: plan.concurrentOpenCasesAllowed,
    storage_bytes: plan.storageBytesAllowed,
    ai_allowance_units: plan.aiAllowanceUnitsAllowed,
  };
}

/** Whole, non-negative numbers only; anything else in a row reads as "no limit" never as zero. */
function limitOf(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * The plan's rules from its rows. A capacity key with no row keeps the old column (no row was
 * ever written for it). The AI features are read for the traveller plan only (agencies have
 * none yet); a feature with no row is the built-in FREE tier, the floor every person keeps.
 */
function fromRows(
  plan: PlanRow,
  rows: readonly EntitlementRow[],
): {
  limits: Record<CapacityKey, number | null>;
  features: Record<AiFeatureKey, AiFeatureEntitlement>;
} {
  const limits = columnLimits(plan);
  const byKey = new Map(rows.filter((r) => isEntitlementKey(r.key)).map((r) => [r.key, r]));
  for (const key of CAPACITY_KEYS) {
    const row = byKey.get(key);
    if (row) limits[key] = row.included ? limitOf(row.limit) : 0;
  }
  const features = {} as Record<AiFeatureKey, AiFeatureEntitlement>;
  for (const feature of AI_FEATURE_KEYS) {
    const row = byKey.get(aiEntitlementKey(feature));
    features[feature] = row
      ? { included: row.included, dailyLimit: row.included ? limitOf(row.limit) : null }
      : AI_PLAN_TIERS.FREE[feature];
  }
  return { limits, features };
}

function freeTier(): Record<AiFeatureKey, AiFeatureEntitlement> {
  return { ...AI_PLAN_TIERS.FREE };
}

/** The price in effect at `at`: the newest row from on or before it. */
function priceAt(prices: readonly PriceRow[], at: Date): PriceRow | undefined {
  let best: PriceRow | undefined;
  for (const row of prices) {
    const from = new Date(row.from).getTime();
    if (from > at.getTime()) continue;
    if (!best || from > new Date(best.from).getTime()) best = row;
  }
  return best;
}

function asPrice(row: PriceRow | undefined): PlanPrice | null {
  return row && row.price !== null && row.currency !== null
    ? { priceMinorUnits: row.price, currency: row.currency }
    : null;
}

/** The start of the billing period `now` falls in, counted from the subscription start. */
export function billingPeriodStart(startedAt: Date, periodDays: number, now: Date): Date {
  const length = Math.max(1, periodDays) * DAY_MS;
  const elapsed = Math.max(0, now.getTime() - startedAt.getTime());
  return new Date(startedAt.getTime() + Math.floor(elapsed / length) * length);
}

/**
 * The plan as a page shows it. Before 0107 (`prices` null) the price is the plan's own column.
 * After it, the price is the one in effect when the current billing period started, and a newer
 * price, if any, applies from the next period. Without a billing period (a traveller) the price is
 * the newest one.
 */
function resolvedPlan(
  plan: PlanRow,
  prices: readonly PriceRow[] | null,
  periodStart: Date | null,
  now: Date,
): ResolvedPlan {
  const base = {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    active: plan.active,
    audience: plan.audience,
    periodDays: plan.periodDays,
  };
  if (prices === null) {
    const price =
      plan.priceMinorUnits !== null && plan.currency !== null
        ? { priceMinorUnits: plan.priceMinorUnits, currency: plan.currency }
        : null;
    return { ...base, price, nextPrice: null };
  }
  if (periodStart === null) {
    return { ...base, price: asPrice(priceAt(prices, now)), nextPrice: null };
  }
  const nextStart = new Date(periodStart.getTime() + Math.max(1, plan.periodDays) * DAY_MS);
  const current = asPrice(priceAt(prices, periodStart));
  const next = asPrice(priceAt(prices, now));
  const differs =
    (current === null) !== (next === null) ||
    (current !== null &&
      next !== null &&
      (current.priceMinorUnits !== next.priceMinorUnits || current.currency !== next.currency));
  return {
    ...base,
    price: current,
    nextPrice: differs && next !== null ? { ...next, from: nextStart } : null,
  };
}

function gateOf(override: boolean, bypass: boolean, suspended: boolean): EntitlementGate {
  if (override) return 'override';
  if (bypass) return 'bypass';
  if (suspended) return 'suspended';
  return 'plan';
}

function entitlementRowsSql(present: boolean) {
  return present
    ? sql<
        EntitlementRow[] | null
      >`(select json_agg(json_build_object('key', e.key, 'included', e.included, 'limit', e.limit_value::text)) from plan_entitlements e where e.plan_id = ${schema.plans.id})`
    : sql<null>`null`;
}

function priceRowsSql(present: boolean) {
  return present
    ? sql<
        PriceRow[] | null
      >`(select json_agg(json_build_object('price', pp.price_minor_units, 'currency', pp.currency, 'from', pp.effective_from)) from plan_prices pp where pp.plan_id = ${schema.plans.id})`
    : sql<null>`null`;
}

/**
 * What `subject` may use now. Pass the caller's transaction so the answer and the write it guards
 * see the same rows. `now` defaults to the current time.
 */
export async function resolveEntitlements(
  db: Db,
  subject: EntitlementSubject,
  now: Date = new Date(),
): Promise<ResolvedEntitlements> {
  const present = await entitlementsSchemaPresent(db);
  if ('organizationId' in subject)
    return resolveForOrganization(db, subject.organizationId, now, present);
  return resolveForTraveller(db, now, present);
}

async function resolveForOrganization(
  db: Db,
  organizationId: string,
  now: Date,
  present: boolean,
): Promise<ResolvedEntitlements> {
  const o = schema.organizations;
  const s = schema.subscriptions;
  const b = schema.billingAccounts;
  const at = now.toISOString();
  const row = first(
    await db
      .select({
        startedAt: s.startedAt,
        plan: planColumns(),
        billingStatus: b.status,
        overrideUntil: sql<
          string | null
        >`(select max(co.expiry_at)::text from commercial_overrides co where co.organization_id = ${o.id} and co.revoked_at is null and co.expiry_at > ${at}::timestamptz)`,
        entitlements: entitlementRowsSql(present),
        prices: priceRowsSql(present),
      })
      .from(o)
      .leftJoin(s, and(eq(s.organizationId, o.id), isNull(s.endedAt)))
      .leftJoin(schema.plans, eq(schema.plans.id, s.planId))
      .leftJoin(b, eq(b.organizationId, o.id))
      .where(eq(o.id, organizationId))
      .limit(1),
  );
  const overrideUntil = row?.overrideUntil ? new Date(row.overrideUntil) : null;
  const billingStatus = row?.billingStatus ?? null;
  const planRow = row?.plan?.id ? (row.plan as PlanRow) : null;
  const bypass = planRow?.bypassLimits === true;
  const gate = gateOf(overrideUntil !== null, bypass, billingStatus === 'SUSPENDED');
  if (!planRow) {
    return {
      plan: null,
      billingStatus,
      override: overrideUntil ? { until: overrideUntil } : null,
      bypassLimits: false,
      limits: NO_LIMITS,
      features: null,
      gate,
      periodStart: null,
      source: present ? 'entitlements' : 'columns',
    };
  }
  const periodStart =
    row?.startedAt instanceof Date
      ? billingPeriodStart(row.startedAt, planRow.periodDays, now)
      : null;
  const limits = present
    ? fromRows(planRow, row?.entitlements ?? []).limits
    : columnLimits(planRow);
  return {
    plan: resolvedPlan(planRow, present ? (row?.prices ?? []) : null, periodStart, now),
    billingStatus,
    override: overrideUntil ? { until: overrideUntil } : null,
    bypassLimits: bypass,
    limits,
    features: null,
    gate,
    periodStart,
    source: present ? 'entitlements' : 'columns',
  };
}

async function resolveForTraveller(
  db: Db,
  now: Date,
  present: boolean,
): Promise<ResolvedEntitlements> {
  const row = first(
    await db
      .select({
        plan: planColumns(),
        entitlements: entitlementRowsSql(present),
        prices: priceRowsSql(present),
      })
      .from(schema.plans)
      .where(eq(schema.plans.key, TRAVELLER_PLAN_KEY))
      .limit(1),
  );
  const base = {
    billingStatus: null,
    override: null,
    bypassLimits: false,
    gate: 'plan' as const,
    periodStart: null,
    source: present ? ('entitlements' as const) : ('columns' as const),
  };
  if (!row) return { ...base, plan: null, limits: NO_LIMITS, features: freeTier() };
  const plan = row.plan as PlanRow;
  const rules = present
    ? fromRows(plan, row.entitlements ?? [])
    : { limits: columnLimits(plan), features: freeTier() };
  return {
    ...base,
    plan: resolvedPlan(plan, present ? (row.prices ?? []) : null, null, now),
    limits: rules.limits,
    features: rules.features,
  };
}

/**
 * One plan's capacity limits, whoever is on it (for comparing two plans, as a downgrade does). The
 * rule rows after 0107, the old columns before.
 */
export async function planCapacityLimits(
  db: Db,
  plan: PlanRow,
): Promise<Record<CapacityKey, number | null>> {
  if (!(await entitlementsSchemaPresent(db))) return columnLimits(plan);
  const e = schema.planEntitlements;
  const rows = await db
    .select({ key: e.key, included: e.included, limit: sql<string | null>`${e.limitValue}::text` })
    .from(e)
    .where(eq(e.planId, plan.id));
  return fromRows(plan, rows).limits;
}
