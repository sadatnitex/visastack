import { switchOn } from '@visastack/core';
import type { AiFeatureEntitlement, AiFeatureKey } from '@visastack/core/ai-features';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { type Db, schema } from './db';
import {
  TRAVELLER_PLAN_KEY,
  type TravellerStorageRules,
  resolveEntitlements,
  travellerRulesOf,
} from './entitlements';
import { entitlementsSchemaPresent } from './plans-schema';

export interface TravellerPlanSummary {
  /** The plan every traveller is on (Traveller Free), or null when no plan row exists. */
  readonly plan: { readonly key: string; readonly name: string } | null;
  /**
   * What the plan itself gives for each AI feature (set on the admin Plans page), apart from
   * whether the feature works right now (that is `getAiUsageToday`).
   */
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>> | null;
  /**
   * The last moment the paid period covering now includes (its end is exclusive, so this is one
   * millisecond before it), for "Paid until <day>"; null on Traveller Free (ADR 0025).
   */
  readonly paidUntil: Date | null;
  /** The plan's own storage rules; a rule left null falls back to the upload settings. */
  readonly storage: TravellerStorageRules | null;
}

/**
 * The plan a traveller is on, for Plan & Usage: a paid traveller plan while a paid period covers
 * now (ADR 0025), else Traveller Free, read once with its storage rules. Storage used is counted
 * by the page with the readers the upload limits use. The plan's capacity limits (seats, cases)
 * are agency limits not enforced on travellers, so none are returned.
 */
export async function getTravellerPlanSummary(
  db: Db,
  input: { readonly actorAccountId: string; readonly now?: Date },
): Promise<TravellerPlanSummary> {
  const entitlements = await resolveEntitlements(
    db,
    { accountId: input.actorAccountId },
    input.now ?? new Date(),
  );
  const plan = entitlements.plan;
  return {
    plan: plan ? { key: plan.key, name: plan.name } : null,
    features: entitlements.features,
    paidUntil: entitlements.periodEnd ? new Date(entitlements.periodEnd.getTime() - 1) : null,
    storage: entitlements.travellerStorage,
  };
}

/** The switch that lets paid traveller plans be sold (ADR 0025 section 9). */
export const TRAVELLER_PLANS_SWITCH = 'TRAVELLER_PLANS_ENABLED';

/**
 * Whether paid traveller plans may be sold (ADR 0025 section 9): `TRAVELLER_PLANS_ENABLED`, off by
 * default and on only for the word "true" (the shared reading of new switches). It governs selling
 * and renewal invoices only: turning it off never removes a period already paid for, which the
 * entitlement resolver keeps reading from paid invoices.
 */
export function travellerPlansEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return switchOn(env[TRAVELLER_PLANS_SWITCH]);
}

/** A paid traveller plan offered now, as Plan & Usage compares it with Traveller Free. */
export interface TravellerPlanOffer {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly periodDays: number;
  readonly price: { readonly amountMinorUnits: number; readonly currency: string };
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>>;
  readonly storage: TravellerStorageRules;
}

export interface TravellerPlanCatalogue {
  /** Traveller Free's own rules, the first column; null when its row is missing. */
  readonly free: {
    readonly name: string;
    readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>>;
    readonly storage: TravellerStorageRules;
  } | null;
  /** The paid traveller plans on sale now: offered, and priced in BDT now. Cheapest first. */
  readonly offers: readonly TravellerPlanOffer[];
}

/**
 * The traveller plans to compare on Plan & Usage (ADR 0025 section 8): Traveller Free and every
 * paid traveller plan on sale now, each with the rules the resolver would give a person on it.
 * Reads plans only, never anyone's billing. Empty offers before migration 0107; the page also
 * shows none while selling is switched off.
 */
export async function listTravellerPlansForSale(
  db: Db,
  now: Date = new Date(),
): Promise<TravellerPlanCatalogue> {
  if (!(await entitlementsSchemaPresent(db))) return { free: null, offers: [] };
  const p = schema.plans;
  const plans = await db
    .select({ id: p.id, key: p.key, name: p.name, periodDays: p.periodDays })
    .from(p)
    .where(and(eq(p.audience, 'TRAVELLER'), eq(p.active, true)));
  if (plans.length === 0) return { free: null, offers: [] };
  const ids = plans.map((plan) => plan.id);
  const e = schema.planEntitlements;
  const ruleRows = await db
    .select({
      planId: e.planId,
      key: e.key,
      included: e.included,
      limit: sql<string | null>`${e.limitValue}::text`,
    })
    .from(e)
    .where(inArray(e.planId, ids));
  const pp = schema.planPrices;
  const prices = await db
    .selectDistinctOn([pp.planId], {
      planId: pp.planId,
      amount: pp.priceMinorUnits,
      currency: pp.currency,
    })
    .from(pp)
    .where(and(inArray(pp.planId, ids), lte(pp.effectiveFrom, now)))
    .orderBy(pp.planId, desc(pp.effectiveFrom));
  const rulesFor = (planId: string) =>
    travellerRulesOf(ruleRows.filter((r) => r.planId === planId));
  const freePlan = plans.find((plan) => plan.key === TRAVELLER_PLAN_KEY);
  const offers: TravellerPlanOffer[] = [];
  for (const plan of plans) {
    if (plan.key === TRAVELLER_PLAN_KEY) continue;
    const price = prices.find((row) => row.planId === plan.id);
    if (!price || price.amount === null || price.amount <= 0 || price.currency !== 'BDT') continue;
    offers.push({
      id: plan.id,
      key: plan.key,
      name: plan.name,
      periodDays: plan.periodDays,
      price: { amountMinorUnits: price.amount, currency: price.currency },
      ...rulesFor(plan.id),
    });
  }
  offers.sort(
    (a, b) => a.price.amountMinorUnits - b.price.amountMinorUnits || a.name.localeCompare(b.name),
  );
  return {
    free: freePlan ? { name: freePlan.name, ...rulesFor(freePlan.id) } : null,
    offers,
  };
}
