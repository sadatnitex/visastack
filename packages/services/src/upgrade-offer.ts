import {
  AI_PLAN_TIERS,
  type AiFeatureEntitlement,
  type AiFeatureKey,
} from '@visastack/core/ai-features';
import { type SelfScope, selfScopeProblem } from './access/principal';
import { aiAdminDailyLimit } from './ai-feature-settings';
import type { Db } from './db';
import type { TravellerStorageRules } from './entitlements';
import { getOwnRenewal } from './person-billing';
import { type UploadQuotaConfig, loadUploadQuotaConfig, storageLimitsFrom } from './quotas';
import {
  type TravellerPlanOffer,
  getTravellerPlanSummary,
  listTravellerPlansForSale,
  travellerPlansEnabled,
} from './traveller-plan';

/**
 * What ran short when a person was refused (ADR 0025 section 12.2): the room in their whole
 * account, the room in one of their own records, or today's use of one AI feature.
 */
export type UpgradeShortfall =
  | { readonly kind: 'account_storage' }
  | { readonly kind: 'person_storage' }
  | {
      readonly kind: 'ai';
      readonly feature: AiFeatureKey;
      /**
       * The limit in force when the feature stopped (Plan & Usage passes it from today's use):
       * used where the person's plan has no rule of its own, and, when it is below the plan's own
       * limit, as the platform owner's cap.
       */
      readonly limitNow?: number | null;
      /** The daily limit the platform owner set for the feature, when known (null: none). */
      readonly adminCap?: number | null;
    };

/** Everything the upgrade decision reads, so Plan & Usage can decide from what it already has. */
export interface UpgradeContext {
  /** `TRAVELLER_PLANS_ENABLED` (ADR 0025 section 9). */
  readonly selling: boolean;
  /** The paid traveller plans on sale now (`listTravellerPlansForSale`). */
  readonly offers: readonly TravellerPlanOffer[];
  /**
   * A paid period covers today, or the last one ended and its renewal is waiting to be paid in the
   * grace week (renewing it is the next step then, not buying another plan).
   */
  readonly covered: boolean;
  /** The person's current plan's storage rules; a rule left null follows the upload settings. */
  readonly storage: TravellerStorageRules | null;
  /** The person's current plan's AI rules, or null when no plan row exists. */
  readonly features: Readonly<Record<AiFeatureKey, AiFeatureEntitlement>> | null;
  readonly quota: UploadQuotaConfig;
}

/**
 * Whether offering a paid plan would really help with `shortfall` (ADR 0025 section 12.2): only
 * while selling is on, a plan is on sale and nothing paid covers today, and only when some plan on
 * sale gives more of what ran short. For storage that is a higher limit, counting the upload
 * setting a plan follows when it sets none; for an AI feature, the feature included with no daily
 * limit or a higher one than the person has now, both counted under the platform owner's own cap
 * (which no plan lifts). Where the person's plan sets no limit for the feature, Plan & Usage passes
 * the limit in force (`limitNow`); a refusal passes none, so no line is offered then.
 */
export function upgradeHelps(context: UpgradeContext, shortfall: UpgradeShortfall): boolean {
  if (!context.selling || context.covered || context.offers.length === 0) return false;
  const limits = storageLimitsFrom(context.storage, context.quota);
  switch (shortfall.kind) {
    case 'account_storage':
      return context.offers.some(
        (offer) =>
          (offer.storage.accountBytes ?? context.quota.maxAccountEvidenceBytes) >
          limits.accountBytes,
      );
    case 'person_storage':
      return context.offers.some(
        (offer) =>
          (offer.storage.personBytes ?? context.quota.maxApplicantEvidenceBytes) >
          limits.personBytes,
      );
    case 'ai': {
      const planNow = context.features?.[shortfall.feature]?.dailyLimit ?? null;
      const reached = planNow ?? shortfall.limitNow ?? null;
      if (reached === null) return false;
      // The platform owner's cap stays whatever plan they buy, so a plan helps only above it.
      const limitNow = shortfall.limitNow ?? null;
      const cap =
        shortfall.adminCap ??
        (limitNow !== null && planNow !== null && limitNow < planNow ? limitNow : null);
      const capped = (limit: number | null) =>
        limit === null ? cap : cap === null ? limit : Math.min(limit, cap);
      const now = capped(reached) ?? reached;
      return context.offers.some((offer) => {
        const rule = offer.features[shortfall.feature];
        if (rule?.included !== true) return false;
        const after = capped(rule.dailyLimit);
        return after === null || after > now;
      });
    }
  }
}

/**
 * Whether the signed-in person, refused for `shortfall`, should be told a paid plan would help
 * (ADR 0025 section 12.2), read for them alone: false for a scope that is not a genuine, fresh
 * one, and with nothing read while selling is switched off or no plan is on sale. Their current
 * plan (and its paid time), its renewal and the upload settings decide the rest (`upgradeHelps`).
 */
export async function upgradeWouldHelp(
  db: Db,
  self: SelfScope,
  shortfall: UpgradeShortfall,
  options: { readonly now?: Date } = {},
): Promise<boolean> {
  if (selfScopeProblem(self)) return false;
  if (!travellerPlansEnabled()) return false;
  const now = options.now ?? new Date();
  const catalogue = await listTravellerPlansForSale(db, now);
  if (catalogue.offers.length === 0) return false;
  const [summary, renewal, adminCap] = await Promise.all([
    getTravellerPlanSummary(db, { actorAccountId: self.accountId, now }),
    getOwnRenewal(db, self, { now }),
    shortfall.kind === 'ai' && shortfall.adminCap === undefined
      ? aiAdminDailyLimit(db, shortfall.feature)
      : Promise.resolve(undefined),
  ]);
  const renewalWaiting =
    renewal?.renews === true &&
    renewal.openRenewal !== null &&
    renewal.paidUntil.getTime() <= now.getTime();
  return upgradeHelps(
    {
      selling: true,
      offers: catalogue.offers,
      covered: summary.paidUntil !== null || renewalWaiting,
      storage: summary.storage,
      // Without a plan row the built-in plan applies, as for the AI gate (`aiEntitlementFor`).
      features: summary.features ?? AI_PLAN_TIERS.FREE,
      quota: loadUploadQuotaConfig(),
    },
    shortfall.kind === 'ai' && adminCap !== undefined ? { ...shortfall, adminCap } : shortfall,
  );
}
