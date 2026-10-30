import { describe, expect, it, vi } from 'vitest';
import { AnthropicExtractionAdapter } from './anthropic-extraction';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A Messages API reply carrying a JSON-outputs answer in its text block. */
function answerResponse(
  answer: unknown,
  extras: { id?: string; usage?: Record<string, number>; content?: unknown[] } = {},
): Response {
  return jsonResponse(200, {
    ...(extras.id ? { id: extras.id } : {}),
    stop_reason: 'end_turn',
    content: [...(extras.content ?? []), { type: 'text', text: JSON.stringify(answer) }],
    usage: extras.usage ?? { input_tokens: 1, output_tokens: 1 },
  });
}

function sentBody(fetchImpl: ReturnType<typeof vi.fn>, call = 0) {
  const [, requestInit] = fetchImpl.mock.calls[call] as [string, RequestInit];
  return JSON.parse(requestInit.body as string);
}

interface SchemaNode {
  readonly type?: unknown;
  readonly additionalProperties?: unknown;
}

/** Every object in a JSON Schema, so a test can check each one is closed. */
function objectsIn(schema: unknown): SchemaNode[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const node = schema as SchemaNode;
  const children = Object.values(node).flatMap((value) =>
    Array.isArray(value) ? value.flatMap(objectsIn) : objectsIn(value),
  );
  return node.type === 'object' ? [node, ...children] : children;
}

const VALID_INPUT = {
  documentVersionId: 'doc-version-1',
  text: 'Passport number: L898902C3, issued to Anna Maria Eriksson.',
  allowedFieldKeys: ['passport.number', 'passport.givenNames'],
};

const CLASSIFY_INPUT = {
  documentVersionId: 'doc-version-1',
  text: 'statement of account, opening balance, closing balance',
  allowedTypes: ['PASSPORT', 'BANK_STATEMENT', 'EMPLOYMENT_CERTIFICATE'],
};

const EXPLAIN_INPUT = {
  requirementKind: 'DOCUMENT' as const,
  requirementKey: 'BANK_STATEMENT',
  state: 'CRITICAL_GAP' as const,
  citation: 'Route guide §4.2: proof of funds required.',
  optional: false,
};

const INCONSISTENCY_INPUT = {
  documentVersionId: 'doc-version-1',
  text: 'Name: Anna Marie Eriksson. DOB: 1990-04-02.',
  profileFacts: [{ fieldKey: 'applicant.givenNames', value: 'Anna Maria' }],
};

/** Runs each of the four tasks once against `fetchImpl`, so a test can check every request. */
async function runEveryTask(adapter: AnthropicExtractionAdapter): Promise<void> {
  await adapter.extract(VALID_INPUT);
  await adapter.classify(CLASSIFY_INPUT);
  await adapter.explain(EXPLAIN_INPUT);
  await adapter.checkConsistency(INCONSISTENCY_INPUT);
}

describe('AnthropicExtractionAdapter', () => {
  it('parses a well-formed JSON-outputs answer into proposals', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      answerResponse(
        {
          proposals: [
            {
              type: 'NEW',
              fieldKey: 'passport.number',
              value: 'L898902C3',
              confidence: 0.95,
              rationale: 'exact match',
              evidenceSnippet: 'L898902C3',
            },
          ],
        },
        { id: 'msg_abc123', usage: { input_tokens: 30, output_tokens: 12 } },
      ),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]?.fieldKey).toBe('passport.number');
    expect(outcome.result.proposals[0]?.confidence).toBe(0.95);
    expect(outcome.result.usage.costUnits).toBe(42);
    expect(outcome.result.usage.inputUnits).toBe(30);
    expect(outcome.result.usage.outputUnits).toBe(12);
    expect(outcome.result.usage.modelVersion).toBe('claude-sonnet-5');
    expect(outcome.result.usage.provider).toBe('anthropic');
    expect(outcome.result.usage.providerRequestId).toBe('msg_abc123');

    // Sends only the deterministic text + allowed keys -- never raw file bytes.
    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('L898902C3');
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(['proposals']);
    expect((requestInit.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    expect((requestInit.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });

  it('never forces a tool call, on any task or model: Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 refuse one with a 400', async () => {
    for (const model of [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-fable-5-1',
      'claude-opus-4-8',
    ]) {
      const fetchImpl = vi.fn().mockImplementation(async () => answerResponse({}));
      await runEveryTask(
        new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', model, fetchImpl }),
      );
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      for (let call = 0; call < 4; call++) {
        const body = sentBody(fetchImpl, call);
        expect(body.model).toBe(model);
        expect(body.tool_choice).toBeUndefined();
        expect(body.tools).toBeUndefined();
        expect(body.output_config.format.type).toBe('json_schema');
      }
    }
  });

  it('sends a closed schema for every task: each object sets additionalProperties to false', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => answerResponse({}));
    await runEveryTask(new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl }));
    for (let call = 0; call < 4; call++) {
      const objects = objectsIn(sentBody(fetchImpl, call).output_config.format.schema);
      expect(objects.length).toBeGreaterThan(0);
      for (const object of objects) expect(object.additionalProperties).toBe(false);
    }
  });

  it('leaves room for thinking before the answer by default, and honours an explicit model and maxTokens override', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => answerResponse({ proposals: [] }));
    await new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl }).extract(VALID_INPUT);
    expect(sentBody(fetchImpl, 0).max_tokens).toBe(16_000);

    await new AnthropicExtractionAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      maxTokens: 8000,
      fetchImpl,
    }).extract(VALID_INPUT);
    const body = sentBody(fetchImpl, 1);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(8000);
  });

  it('reads the answer after a thinking block, which is never mistaken for the answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      answerResponse(
        {
          proposals: [
            {
              type: 'NEW',
              fieldKey: 'passport.number',
              value: 'L898902C3',
              confidence: 0.9,
              rationale: null,
              evidenceSnippet: 'L898902C3',
            },
          ],
        },
        { content: [{ type: 'thinking', thinking: '', signature: 'sig' }] },
      ),
    );
    const adapter = new AnthropicExtractionAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      fetchImpl,
    });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals[0]?.value).toBe('L898902C3');
  });

  it('sends the chosen reasoning effort to a model that takes it, and keys the cache on it', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => answerResponse({}));
    const adapter = new AnthropicExtractionAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      reasoningEffort: 'low',
      fetchImpl,
    });
    await runEveryTask(adapter);
    for (let call = 0; call < 4; call++) {
      expect(sentBody(fetchImpl, call).output_config.effort).toBe('low');
    }
    expect(adapter.cacheKeyComponents().reasoningEffort).toBe('low');
    expect(adapter.classifyCacheKeyComponents().reasoningEffort).toBe('low');
    expect(adapter.explainCacheKeyComponents().reasoningEffort).toBe('low');
    expect(adapter.inconsistencyCacheKeyComponents().reasoningEffort).toBe('low');
  });

  it('sends no effort to a model that refuses one, for an unknown level, or when none was chosen; never sends storeResponses', async () => {
    const cases: { model: string; reasoningEffort?: string }[] = [
      { model: 'claude-haiku-4-5', reasoningEffort: 'high' },
      { model: 'claude-sonnet-4-5-20250929', reasoningEffort: 'high' },
      { model: 'claude-opus-4-1-20250805', reasoningEffort: 'high' },
      { model: 'claude-opus-5-5', reasoningEffort: 'minimal' },
      { model: 'claude-opus-5-5' },
    ];
    for (const options of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(answerResponse({ proposals: [] }));
      const adapter = new AnthropicExtractionAdapter({
        apiKey: 'sk-ant-test',
        storeResponses: true,
        fetchImpl,
        ...options,
      });
      await adapter.extract(VALID_INPUT);
      const body = sentBody(fetchImpl);
      expect(body.output_config.effort).toBeUndefined();
      expect(body.store).toBeUndefined();
      // The cache key never claims a reasoning-effort dependency the request did not have.
      expect(adapter.cacheKeyComponents().reasoningEffort).toBeUndefined();
    }
  });

  it('matches an enum value whatever its capitalization, and coerces an out-of-enum type to UNCERTAIN', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      answerResponse({
        proposals: [
          { type: 'new', confidence: 0.6 },
          { type: 'NOT_A_REAL_TYPE', confidence: 0.5 },
        ],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals.map((p) => p.type)).toEqual(['NEW', 'UNCERTAIN']);
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'slow down' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it('reports upstream_error, with the provider message, on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('500: internal error');
  });

  it('reports upstream_error when fetch itself throws (network failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure'));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('DNS failure');
  });

  it('reports invalid_response when the payload has no content array at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when the answer has no proposals array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answerResponse({ notProposals: true }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when the answer text is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I am not able to do that.' }],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports timeout when the request exceeds the configured timeout, never hanging the caller', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    const adapter = new AnthropicExtractionAdapter({
      apiKey: 'sk-ant-test',
      fetchImpl,
      timeoutMs: 20,
    });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('timeout');
    expect(outcome.provider).toBe('anthropic');
    // A timer can fire a millisecond early against the clock; this only has to show it waited.
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('reports auth_failed (never generic upstream_error) on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid api key' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-bad', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports auth_failed on HTTP 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-bad', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports refused (never a silent empty proposal set) on an explicit stop_reason of refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'refusal',
        content: [{ type: 'text', text: 'I cannot process this request' }],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('cannot process');
  });

  it("reports refused with the provider's own explanation when the refusal carries one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: 'Declined by policy' },
        content: [],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toBe('Declined by policy');
  });

  it('reports refused when the reply carries no answer at all (only thinking)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated (never trusts a partial answer as complete) when stop_reason is max_tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"proposals":[]}' }],
        usage: { input_tokens: 500, output_tokens: 16000 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('captures the provider, message id, latency, and the input/output/cached token breakdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      answerResponse(
        { proposals: [] },
        {
          id: 'msg_xyz789',
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
        },
      ),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.usage.provider).toBe('anthropic');
    expect(outcome.result.usage.providerRequestId).toBe('msg_xyz789');
    expect(outcome.result.usage.inputUnits).toBe(100);
    expect(outcome.result.usage.outputUnits).toBe(50);
    expect(outcome.result.usage.cachedUnits).toBe(20);
    expect(outcome.result.usage.costUnits).toBe(150);
    expect(outcome.result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('AnthropicExtractionAdapter.classify (Part 8 AI-01 item 2)', () => {
  it('parses a well-formed answer into a suggestion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      answerResponse({
        suggestedType: 'BANK_STATEMENT',
        confidence: 0.85,
        rationale: 'mentions opening and closing balance',
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBe('BANK_STATEMENT');
    expect(outcome.result.confidence).toBe(0.85);
    expect(outcome.result.rationale).toBe('mentions opening and closing balance');
    expect(outcome.result.usage.schemaVersion).toBe('document_classification_v1');

    const body = sentBody(fetchImpl);
    expect(body.output_config.format.schema.required).toEqual([
      'suggestedType',
      'confidence',
      'rationale',
    ]);
    expect(JSON.stringify(body)).toContain('BANK_STATEMENT');
  });

  it('reports a null suggestedType as a genuine "could not classify", not an error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        answerResponse({ suggestedType: null, confidence: 0.1, rationale: 'unclear' }),
      );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBeNull();
  });

  it('reports invalid_response when the answer has no numeric confidence', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answerResponse({ suggestedType: 'PASSPORT' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports refused when the model declines', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'refusal',
        content: [{ type: 'text', text: 'I cannot help with this' }],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when max_tokens was reached', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { stop_reason: 'max_tokens', content: [] }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on HTTP 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'bad key' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("classifyCacheKeyComponents never collides with extract()'s own cacheKeyComponents", () => {
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test' });
    const extractionComponents = adapter.cacheKeyComponents();
    const classifyComponents = adapter.classifyCacheKeyComponents();
    expect(classifyComponents.schemaVersion).not.toBe(extractionComponents.schemaVersion);
  });
});

describe('AnthropicExtractionAdapter.explain (Part 8 AI-01 item 5)', () => {
  it('parses a well-formed answer into an explanation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      answerResponse({
        explanation: 'You need a recent bank statement to show you can support your trip.',
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.explanation).toContain('bank statement');
    expect(outcome.result.usage.schemaVersion).toBe('readiness_gap_explanation_v1');

    const body = sentBody(fetchImpl);
    expect(body.output_config.format.schema.required).toEqual(['explanation']);
    expect(JSON.stringify(body)).toContain('Route guide');
  });

  it('reports refused when the model declines', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'refusal',
        content: [{ type: 'text', text: 'I cannot help with this' }],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when max_tokens was reached', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { stop_reason: 'max_tokens', content: [] }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'bad key' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("explainCacheKeyComponents never collides with extract()'s or classify()'s own cache-key methods", () => {
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test' });
    const extractionComponents = adapter.cacheKeyComponents();
    const classifyComponents = adapter.classifyCacheKeyComponents();
    const explainComponents = adapter.explainCacheKeyComponents();
    expect(explainComponents.schemaVersion).not.toBe(extractionComponents.schemaVersion);
    expect(explainComponents.schemaVersion).not.toBe(classifyComponents.schemaVersion);
  });
});

describe('AnthropicExtractionAdapter.checkConsistency (Part 8 AI-01 item 4)', () => {
  it('parses a well-formed answer into flags', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      answerResponse({
        flags: [
          {
            description: 'Given names differ between the document and the profile',
            confidence: 0.7,
            rationale: '"Marie" on the document vs. "Maria" on file',
          },
        ],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(1);
    expect(outcome.result.flags[0]?.description).toContain('Given names differ');
    expect(outcome.result.usage.schemaVersion).toBe('inconsistency_flags_v1');

    const body = sentBody(fetchImpl);
    expect(body.output_config.format.schema.required).toEqual(['flags']);
    expect(JSON.stringify(body)).toContain('Anna Maria');
  });

  it('reports zero flags as a genuine, valid, good outcome', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answerResponse({ flags: [] }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(0);
  });

  it('reports invalid_response when the answer has no flags array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answerResponse({ notFlags: true }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports refused when the model declines', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'refusal',
        content: [{ type: 'text', text: 'I cannot help with this' }],
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when max_tokens was reached', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { stop_reason: 'max_tokens', content: [] }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'bad key' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("inconsistencyCacheKeyComponents never collides with any other port's own cache-key method", () => {
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test' });
    const extractionComponents = adapter.cacheKeyComponents();
    const classifyComponents = adapter.classifyCacheKeyComponents();
    const explainComponents = adapter.explainCacheKeyComponents();
    const inconsistencyComponents = adapter.inconsistencyCacheKeyComponents();
    expect(inconsistencyComponents.schemaVersion).not.toBe(extractionComponents.schemaVersion);
    expect(inconsistencyComponents.schemaVersion).not.toBe(classifyComponents.schemaVersion);
    expect(inconsistencyComponents.schemaVersion).not.toBe(explainComponents.schemaVersion);
  });
});
