import 'server-only';
import type { AiFeatureKey } from '@visastack/core/ai-features';
import {
  type Db,
  type SelfScope,
  type ServiceError,
  type UpgradeShortfall,
  upgradeWouldHelp,
} from '@visastack/services';
import type { UpgradeLineKind } from '../components/upgrade-line';
import { reportServerError } from './server-error';

/**
 * What ran short for a refusal, when it is something a person's own plan decides: the room in
 * one of their records or their whole account (a typed upload refusal), or today's use of the AI
 * feature `aiFeature` (a refusal for its daily limit). Anything else (an agency's plan, the
 * platform's capacity, a feature turned off) is not something a paid plan changes.
 */
function shortfallOf(error: ServiceError, aiFeature?: AiFeatureKey): UpgradeShortfall | null {
  if (error.reason === 'person_storage_limit') return { kind: 'person_storage' };
  if (error.reason === 'account_storage_limit') return { kind: 'account_storage' };
  if (error.reason === 'ai_daily_limit' && aiFeature) return { kind: 'ai', feature: aiFeature };
  return null;
}

/**
 * The upgrade line to add after a refusal (ADR 0025 section 12.2), as fields to spread into an
 * action's answer: `{ upgrade }` only when a paid plan on sale would really help this person
 * (`upgradeWouldHelp`), else nothing. Call it only for the record's owner acting for themselves,
 * never for a contributor or agency staff: `self` is the signed-in person from `withSession`. It
 * never fails the refusal it adds to: a failed read means no line.
 */
export async function upgradeLineForRefusal(
  db: Db,
  self: SelfScope,
  error: ServiceError,
  aiFeature?: AiFeatureKey,
): Promise<{ readonly upgrade?: UpgradeLineKind }> {
  const shortfall = shortfallOf(error, aiFeature);
  if (!shortfall) return {};
  try {
    if (!(await upgradeWouldHelp(db, self, shortfall))) return {};
  } catch (failure) {
    reportServerError('upgradeLine', failure);
    return {};
  }
  return { upgrade: shortfall.kind === 'ai' ? 'ai' : 'storage' };
}
