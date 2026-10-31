import type { AiFeatureEntitlement, AiFeatureKey } from '@visastack/core/ai-features';
import type { Db } from './db';
import { resolveEntitlements } from './entitlements';
import { listOwnedApplicantEvidenceBytes } from './quotas';

/** One traveller profile the account owns, and the evidence bytes it holds. */
export interface TravellerProfileStorage {
  readonly applicantId: string;
  readonly displayName: string;
  readonly usedBytes: number;
}

export interface TravellerPlanSummary {
  /** The plan every traveller is on (Traveller Free), or null when no plan row exists. */
  readonly plan: { readonly key: string; readonly name: string } | null;
  /**
   * What the plan itself gives for each AI feature (set on the admin Plans page), apart from
   * whether the feature works right now (that is `getAiUsageToday`).
   */
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>> | null;
  /** Evidence bytes across every profile the account owns (the account storage limit counts these). */
  readonly usedBytes: number;
  /** Each owned profile with its own bytes (each profile has its own storage limit), oldest first. */
  readonly profiles: readonly TravellerProfileStorage[];
}

/**
 * The signed-in traveller's own plan and storage, for Plan & Usage. Scoped to the actor: it reads
 * only the profiles that account owns, never anyone else's. Every traveller is on the traveller
 * plan (no traveller subscriptions yet). The plan's capacity limits (seats, cases) are agency
 * limits not enforced on travellers, so none are returned. Storage is counted exactly as the
 * upload limits count it (quotas.ts).
 */
export async function getTravellerPlanSummary(
  db: Db,
  input: { readonly actorAccountId: string; readonly now?: Date },
): Promise<TravellerPlanSummary> {
  const [entitlements, profiles] = await Promise.all([
    resolveEntitlements(db, { accountId: input.actorAccountId }, input.now ?? new Date()),
    listOwnedApplicantEvidenceBytes(db, input.actorAccountId),
  ]);
  const plan = entitlements.plan;
  return {
    plan: plan ? { key: plan.key, name: plan.name } : null,
    features: entitlements.features,
    usedBytes: profiles.reduce((total, profile) => total + profile.usedBytes, 0),
    profiles,
  };
}
