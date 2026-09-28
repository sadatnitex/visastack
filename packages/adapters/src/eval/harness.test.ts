import type { AiExtractionInput, AiExtractionOutcome, AiExtractionPort } from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { EVAL_CASES } from './dataset';
import { runEvaluationSuite } from './harness';

const SUCCESS_USAGE = {
  costUnits: 1,
  inputUnits: 1,
  outputUnits: 1,
  cachedUnits: 0,
  modelVersion: 'stub-model',
  promptVersion: 'stub-prompt-v1',
  schemaVersion: 'stub-schema-v1',
  provider: 'stub',
  latencyMs: 5,
} as const;

/** A stub `AiExtractionPort` that always succeeds with no proposals -- exercises `runEvaluationSuite`'s own orchestration (does it call extract once per case, in order, and aggregate correctly), not scoring correctness itself (already thoroughly covered by scoring.test.ts against hand-built fixtures). */
function alwaysSucceedsAdapter(): AiExtractionPort {
  return {
    extract: vi.fn(
      async (_input: AiExtractionInput): Promise<AiExtractionOutcome> => ({
        ok: true,
        result: { proposals: [], usage: SUCCESS_USAGE },
      }),
    ),
    cacheKeyComponents: () => ({ model: 'stub-model', promptVersion: 'v1', schemaVersion: 'v1' }),
  };
}

function alwaysErrorsAdapter(): AiExtractionPort {
  return {
    extract: vi.fn(
      async (_input: AiExtractionInput): Promise<AiExtractionOutcome> => ({
        ok: false,
        code: 'upstream_error',
        message: 'stub failure',
      }),
    ),
    cacheKeyComponents: () => ({ model: 'stub-model', promptVersion: 'v1', schemaVersion: 'v1' }),
  };
}

describe('runEvaluationSuite -- the shared case-by-case loop both run.ts and the admin evaluation action use', () => {
  it('calls extract exactly once per dataset case, and aggregates a clean run with no errors', async () => {
    const adapter = alwaysSucceedsAdapter();

    const { report, scores } = await runEvaluationSuite(adapter);

    expect(adapter.extract).toHaveBeenCalledTimes(EVAL_CASES.length);
    expect(scores).toHaveLength(EVAL_CASES.length);
    expect(scores.every((s) => s.erroredOut === undefined)).toBe(true);
    expect(report.anyCaseErrored).toBe(false);
  });

  it('passes each case its own documentVersionId and the shared allowed field keys', async () => {
    const adapter = alwaysSucceedsAdapter();

    await runEvaluationSuite(adapter);

    const firstCall = (adapter.extract as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as AiExtractionInput;
    expect(firstCall.documentVersionId).toBe(`eval-${EVAL_CASES[0]?.id}`);
    expect(firstCall.text).toBe(EVAL_CASES[0]?.documentText);
    expect(firstCall.allowedFieldKeys.length).toBeGreaterThan(0);
  });

  it('records every case as erroredOut when the adapter fails on all of them, and rolls that up into anyCaseErrored', async () => {
    const adapter = alwaysErrorsAdapter();

    const { report, scores } = await runEvaluationSuite(adapter);

    expect(scores).toHaveLength(EVAL_CASES.length);
    expect(scores.every((s) => s.erroredOut === true)).toBe(true);
    expect(report.anyCaseErrored).toBe(true);
  });

  it('invokes the optional per-case callback once per case, with the matching case/outcome/score', async () => {
    const adapter = alwaysSucceedsAdapter();
    const onCaseComplete = vi.fn();

    await runEvaluationSuite(adapter, onCaseComplete);

    expect(onCaseComplete).toHaveBeenCalledTimes(EVAL_CASES.length);
    const [firstEvalCase, firstOutcome, firstScore] = onCaseComplete.mock.calls[0] as [
      unknown,
      AiExtractionOutcome,
      unknown,
    ];
    expect(firstEvalCase).toBe(EVAL_CASES[0]);
    expect(firstOutcome.ok).toBe(true);
    expect(firstScore).toBeDefined();
  });

  it('runs to completion with no callback at all', async () => {
    const adapter = alwaysSucceedsAdapter();

    await expect(runEvaluationSuite(adapter)).resolves.toBeDefined();
  });
});
