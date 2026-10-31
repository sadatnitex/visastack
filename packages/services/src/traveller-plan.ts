import type { AiFeatureEntitlement, AiFeatureKey } from '@visastack/core/ai-features';
import type { Db } from './db';
import { resolveEntitlements } from './entitlements';

export interface TravellerPlanSummary {
  /** The plan every traveller is on (Traveller Free), or null when no plan row exists. */
  readonly plan: { readonly key: string; readonly name: string } | null;
  /**
   * What the plan itself gives for each AI feature (set on the admin Plans page), apart from
   * whether the feature works right now (that is `getAiUsageToday`).
   */
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>> | null;
  /** When the paid period covering now ends; null on Traveller Free (ADR 0025). */
  readonly paidUntil: Date | null;
}

/**
 * The plan a traveller is on, for Plan & Usage: a paid traveller plan while a paid period covers
 * now (ADR 0025), else Traveller Free. Storage is counted by the page with the readers the upload
 * limits use. The plan's
 * capacity limits (seats, cases) are agency limits not enforced on travellers, so none are
 * returned.
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
    paidUntil: entitlements.periodEnd,
  };
}
