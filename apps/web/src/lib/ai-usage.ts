import { type AiFeatureEntitlement, aiFeatureOffSentence } from '@visastack/core/ai-features';
import { type AiUsageToday, getAiUsageToday } from '@visastack/services';
import { resolveAiExtractionAvailability } from './ai';
import { aiConnectorEnabled } from './ai-connector';
import { createKeyManagementPort } from './providers';
import { reportServerError } from './server-error';

/**
 * A person's AI use today (S28), as Privacy & Consent and Plan & Usage show it: the same
 * reading and the same words on both.
 */

/** "2 files today", "1 file today" or "3 of 10 checks today" (S28), against `limit`. */
export function usageLine(
  feature: AiUsageToday,
  limit: number | null = feature.dailyLimit,
): string {
  const noun = feature.used === 1 ? feature.unit.replace(/s$/, '') : feature.unit;
  return limit === null
    ? `${feature.used} ${noun} today`
    : `${feature.used} of ${limit} ${feature.unit} today`;
}

/** The badge beside each AI feature: on, off, or today's limit used up. */
export function usageBadge(feature: AiUsageToday): {
  readonly label: string;
  readonly tone: string;
} {
  if (feature.available) return { label: 'On', tone: 'badge-success' };
  if (feature.reason === 'daily_limit') return { label: 'Limit Reached', tone: 'badge-warning' };
  return { label: 'Off', tone: 'badge-neutral' };
}

/**
 * How much of each AI feature the person used today (S28). Never fails the page: if it cannot be
 * read the card is left out, and nothing else changes.
 */
export async function readAiUsage(
  db: Parameters<typeof getAiUsageToday>[0],
  accountId: string,
): Promise<readonly AiUsageToday[] | null> {
  try {
    const model =
      (await resolveAiExtractionAvailability(db, createKeyManagementPort() !== undefined)) ===
      'available';
    const usage = await getAiUsageToday(
      db,
      { accountId },
      { platform: { model, connector: aiConnectorEnabled() } },
    );
    return usage.features;
  } catch (error) {
    reportServerError('aiUsageToday', error);
    return null;
  }
}

/** One AI feature on Plan & Usage: what the plan gives, apart from whether it works right now. */
export interface PlanFeatureView {
  readonly inPlan: boolean;
  /** Whether it works right now, in the same words as AI Use Today; null when not in the plan. */
  readonly now: { readonly label: string; readonly tone: string } | null;
  /** "Up to 15 a day. 3 of 15 files today." or "No daily limit. 2 files today."; null when not in the plan. */
  readonly detail: string | null;
  /** Why it does not work right now, when it is in the plan but off; null otherwise. */
  readonly offSentence: string | null;
}

/**
 * Plan inclusion comes from the plan's own rule (`rule`), never from why a feature is off: a
 * feature the plan leaves out reads Not in Your Plan even while AI is switched off for everyone.
 * Without a rule (no plan row) the feature's own state decides. The limit is the one in force
 * while the feature works (the smaller of the plan's and the administrator's), else the plan's.
 */
export function planFeatureView(
  feature: AiUsageToday,
  rule: AiFeatureEntitlement | undefined,
): PlanFeatureView {
  const inPlan = rule ? rule.included : feature.reason !== 'not_in_plan';
  if (!inPlan) return { inPlan, now: null, detail: null, offSentence: null };
  const limit = feature.available ? feature.dailyLimit : (rule?.dailyLimit ?? null);
  const limitWords = limit === null ? 'No daily limit' : `Up to ${limit} a day`;
  const off = !feature.available && feature.reason !== 'daily_limit';
  return {
    inPlan,
    now: usageBadge(feature),
    detail: `${limitWords}. ${usageLine(feature, limit)}.`,
    offSentence: off
      ? aiFeatureOffSentence(
          feature.feature,
          feature.reason === 'not_in_plan' ? null : feature.reason,
        )
      : null,
  };
}
