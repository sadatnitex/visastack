import { type AiFeatureOffReason, aiFeatureOffHint } from '@visastack/core/ai-features';

/**
 * What a person sees where an AI feature's button would be while the feature is off or today's
 * limit is used up (S28). One calm sentence; everything already there (earlier suggestions,
 * explanations and flags) stays readable and decidable beside it.
 */
export function AiFeatureOffNote({ reason }: { readonly reason: AiFeatureOffReason | null }) {
  return <p className="muted u-fs-085">{aiFeatureOffHint(reason)}</p>;
}
