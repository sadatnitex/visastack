import type { AiFeatureEntitlement, AiFeatureKey } from '@visastack/core/ai-features';
import type { Db } from './db';
import { type TravellerStorageRules, resolveEntitlements } from './entitlements';

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
