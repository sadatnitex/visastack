import type { AiExtractionOutcome, AiExtractionPort } from '@visastack/services';
import { EVAL_ALLOWED_FIELD_KEYS, EVAL_CASES, type EvalCase } from './dataset';
import {
  type AggregateReport,
  type CaseScore,
  aggregate,
  errorCaseScore,
  scoreCase,
} from './scoring';

/**
 * The actual case-by-case evaluation loop (Part 8 §5's admin "run task
 * evaluation" action; §14's own evaluation requirement) -- extracted here,
 * not left as a private loop inside `run.ts`, once a second real caller
 * needed it: the CLI runner (`run.ts`) and the admin-triggered evaluation
 * action (`apps/web`) both run the identical 13-case dataset against an
 * already-built adapter and need the identical aggregate report back. Takes
 * an adapter the caller already resolved (never builds one itself) -- this
 * file has no opinion on which provider or which credentials, matching
 * `dataset.ts`/`scoring.ts`'s own existing provider-agnostic discipline.
 */
export interface EvaluationSuiteResult {
  readonly report: AggregateReport;
  readonly scores: readonly CaseScore[];
}

/** Invoked once per case, after it is scored -- `run.ts` uses this for its own live per-case console output; a caller with no interest in per-case detail (e.g. the admin action, which only needs the final `report`) simply omits it. */
export type EvaluationCaseCallback = (
  evalCase: EvalCase,
  outcome: AiExtractionOutcome,
  score: CaseScore,
) => void;

export async function runEvaluationSuite(
  ai: AiExtractionPort,
  onCaseComplete?: EvaluationCaseCallback,
): Promise<EvaluationSuiteResult> {
  const scores: CaseScore[] = [];
  for (const evalCase of EVAL_CASES) {
    const startedAt = Date.now();
    const outcome = await ai.extract({
      documentVersionId: `eval-${evalCase.id}`,
      text: evalCase.documentText,
      allowedFieldKeys: EVAL_ALLOWED_FIELD_KEYS as unknown as string[],
    });
    const latencyMs = Date.now() - startedAt;

    const score = outcome.ok
      ? scoreCase(
          evalCase,
          outcome.result.proposals,
          outcome.result.usage.costUnits,
          latencyMs,
          EVAL_ALLOWED_FIELD_KEYS as unknown as string[],
        )
      : errorCaseScore(evalCase, latencyMs);
    scores.push(score);
    onCaseComplete?.(evalCase, outcome, score);
  }
  return { report: aggregate(scores), scores };
}
