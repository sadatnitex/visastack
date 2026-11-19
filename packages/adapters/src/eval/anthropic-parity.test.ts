import type {
  AiExtractionInput,
  AiExtractionOutcome,
  AiExtractionPort,
  FieldProposal,
} from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicExtractionAdapter } from '../anthropic-extraction';
import { EVAL_CASES, type EvalCase } from './dataset';
import { runEvaluationSuite } from './harness';
import type { CaseScore } from './scoring';

/**
 * Prompt caching changes what a request is billed, never what the model is asked or what the
 * adapter makes of the answer. These checks run the whole evaluation dataset through the real
 * Anthropic adapter against a fake Messages API (no network), and compare the result with the
 * same answers handed straight to the scorer.
 */

/** The answer a perfect model gives for one dataset case: exactly its expected fields. */
function perfectProposals(evalCase: EvalCase): FieldProposal[] {
  return evalCase.expected.map((expected) => ({
    type: 'NEW' as const,
    fieldKey: expected.fieldKey,
    value: expected.value,
    confidence: 0.9,
    ...(evalCase.documentText.includes(expected.value) ? { evidenceSnippet: expected.value } : {}),
  }));
}

/** The dataset case whose document text the request carries (the longest match, so no case shadows another). */
function caseFor(userContent: string): EvalCase {
  const matches = EVAL_CASES.filter((evalCase) => userContent.includes(evalCase.documentText));
  const best = matches.sort((a, b) => b.documentText.length - a.documentText.length)[0];
  if (!best) throw new Error('request carried no dataset document');
  return best;
}

/** The instruction text a request carries, whether sent as a plain string or as text blocks. */
function instructionText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .map((block: { type?: unknown; text?: unknown }) =>
      block.type === 'text' && typeof block.text === 'string' ? block.text : '',
    )
    .join('');
}

/**
 * A fake Messages API: refuses (400) a request with no extraction instruction or no answer
 * schema, as the real one would misbehave, and otherwise answers with the case's perfect
 * proposals. It reads the instruction from either request shape, so the same answers come back
 * before and after caching: what differs is billing only.
 */
function fakeMessagesApi() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as {
      system?: unknown;
      messages: Array<{ content: string }>;
      output_config?: { format?: { type?: unknown; schema?: unknown } };
    };
    const wellFormed =
      instructionText(body.system).includes('extract structured field proposals') &&
      body.output_config?.format?.type === 'json_schema' &&
      typeof body.output_config.format.schema === 'object';
    if (!wellFormed) {
      return new Response(JSON.stringify({ type: 'error' }), { status: 400 });
    }
    const evalCase = caseFor(body.messages[0]?.content ?? '');
    return new Response(
      JSON.stringify({
        id: `msg_${evalCase.id}`,
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: JSON.stringify({ proposals: perfectProposals(evalCase) }) },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
}

/** The same answers without any request at all, for the comparison. */
function directPort(): AiExtractionPort {
  return {
    extract: async (input: AiExtractionInput): Promise<AiExtractionOutcome> => {
      const evalCase = caseFor(input.text);
      return {
        ok: true,
        result: {
          proposals: perfectProposals(evalCase),
          usage: {
            costUnits: 15,
            inputUnits: 10,
            outputUnits: 5,
            cachedUnits: 0,
            modelVersion: 'direct',
            promptVersion: 'direct',
            schemaVersion: 'direct',
            provider: 'direct',
            latencyMs: 0,
          },
        },
      };
    },
    cacheKeyComponents: () => ({ model: 'direct', promptVersion: 'v1', schemaVersion: 'v1' }),
  };
}

/** A score without its wall-clock time, the one part that legitimately differs between runs. */
function withoutTiming(scores: readonly CaseScore[]) {
  return scores.map(({ latencyMs: _latencyMs, ...rest }) => rest);
}

describe('Anthropic request shape parity on the evaluation dataset', () => {
  it('scores every case exactly as the same answers scored without any request', async () => {
    const adapter = new AnthropicExtractionAdapter({
      apiKey: 'sk-ant-test',
      fetchImpl: fakeMessagesApi(),
    });
    const throughAdapter = await runEvaluationSuite(adapter);
    const direct = await runEvaluationSuite(directPort());

    expect(throughAdapter.scores).toHaveLength(EVAL_CASES.length);
    expect(withoutTiming(throughAdapter.scores)).toEqual(withoutTiming(direct.scores));
    const { cases: _a, meanLatencyMs: _b, ...adapterReport } = throughAdapter.report;
    const { cases: _c, meanLatencyMs: _d, ...directReport } = direct.report;
    expect(adapterReport).toEqual(directReport);
    expect(throughAdapter.report.anyCaseErrored).toBe(false);
  });

  it('sends every dataset request with one identical cached instruction block and no document text in it', async () => {
    const fetchImpl = fakeMessagesApi();
    await runEvaluationSuite(new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl }));
    expect(fetchImpl).toHaveBeenCalledTimes(EVAL_CASES.length);

    const systems = fetchImpl.mock.calls.map(([, init]) => {
      const body = JSON.parse(init?.body as string);
      expect(JSON.stringify(body.messages)).not.toContain('cache_control');
      return JSON.stringify(body.system);
    });
    expect(new Set(systems).size).toBe(1);
    const [system] = systems;
    expect(JSON.parse(system ?? '[]').at(-1).cache_control).toEqual({ type: 'ephemeral' });
    for (const evalCase of EVAL_CASES) {
      expect(system).not.toContain(evalCase.documentText);
    }
  });
});
