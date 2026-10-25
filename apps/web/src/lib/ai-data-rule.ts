import 'server-only';
import {
  type AiDataMode,
  type AiDataRuleSetting,
  type AiProviderConfig,
  type AiProviderDataTerms,
  type AiProviderUseDecision,
  type Db,
  aiProviderTermsFor,
  decideAiProviderUse,
  loadAiDataRuleSetting,
  loadAiProviderDataTerms,
  unknownAiProviderDataTerms,
} from '@visastack/services';
import { getPlatformCapabilities } from './capabilities';
import { getDeploymentMode } from './deployment-mode';

/**
 * Whether the platform may be holding real applicant data right now: a
 * commercial deployment, or any deployment where the real-applicant-data
 * capability ("All Protections for Real Personal Data in Place") is
 * available. Controlled pilot and development without that capability hold
 * made-up data only. Read per call, never cached.
 */
export function currentAiDataMode(): AiDataMode {
  if (getDeploymentMode() === 'commercial') return 'real_applicant_data';
  return getPlatformCapabilities().realApplicantData === 'available'
    ? 'real_applicant_data'
    : 'synthetic_only';
}

/** Stands in for the configuration-less environment-variable path, which has no terms of its own. */
const ENVIRONMENT_ONLY_ID = 'environment-only';

export interface AiDataCheck {
  readonly mode: AiDataMode;
  readonly setting: AiDataRuleSetting;
  readonly terms: AiProviderDataTerms;
  readonly decision: AiProviderUseDecision;
}

/**
 * The gateway's single data-terms check, run for the primary configuration
 * and for its fallback before any adapter is built
 * (packages/services/src/ai-data-terms.ts `decideAiProviderUse` holds the
 * rule itself). `config` is undefined for the older environment-variable
 * path, which has no recorded terms and so reads as "unknown".
 */
export async function checkAiDataTerms(
  db: Db,
  config: AiProviderConfig | undefined,
  /** The setting when the caller has already read it, so it is read once. */
  knownSetting?: AiDataRuleSetting,
): Promise<AiDataCheck> {
  const mode = currentAiDataMode();
  const setting = knownSetting ?? (await loadAiDataRuleSetting(db));
  const terms = config
    ? aiProviderTermsFor(await loadAiProviderDataTerms(db, [config.id]), config.id)
    : unknownAiProviderDataTerms(ENVIRONMENT_ONLY_ID);
  const decision = decideAiProviderUse({
    mode,
    terms,
    requireNoTraining: setting.requireNoTraining,
  });
  return { mode, setting, terms, decision };
}

/** True when the configuration may be sent anything right now. */
export async function isAiDataUseAllowed(
  db: Db,
  config: AiProviderConfig | undefined,
): Promise<boolean> {
  // With the setting off every answer is "allowed" (decideAiProviderUse), so
  // skip reading the terms: this runs on every AI call and page check.
  const setting = await loadAiDataRuleSetting(db);
  if (!setting.requireNoTraining) return true;
  return (await checkAiDataTerms(db, config, setting)).decision.allowed;
}
