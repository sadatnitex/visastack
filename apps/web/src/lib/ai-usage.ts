import { type AiUsageToday, getAiUsageToday } from '@visastack/services';
import { resolveAiExtractionAvailability } from './ai';
import { aiConnectorEnabled } from './ai-connector';
import { createKeyManagementPort } from './providers';
import { reportServerError } from './server-error';

/**
 * A person's AI use today (S28), as Privacy & Consent and Plan & Usage show it: the same
 * reading and the same words on both.
 */

/** "2 files today", "1 file today" or "3 of 10 checks today" (S28). */
export function usageLine(feature: AiUsageToday): string {
  const noun = feature.used === 1 ? feature.unit.replace(/s$/, '') : feature.unit;
  return feature.dailyLimit === null
    ? `${feature.used} ${noun} today`
    : `${feature.used} of ${feature.dailyLimit} ${feature.unit} today`;
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
