import { describe, expect, it, vi } from 'vitest';
import { AnthropicExtractionAdapter } from './anthropic-extraction';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_INPUT = {
  documentVersionId: 'doc-version-1',
  text: 'Passport number: L898902C3, issued to Anna Maria Eriksson.',
  allowedFieldKeys: ['passport.number', 'passport.givenNames'],
};

describe('AnthropicExtractionAdapter', () => {
  it('parses a well-formed forced tool-use response into proposals', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'msg_abc123',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'submit_field_proposals',
            input: {
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
          },
        ],
        usage: { input_tokens: 30, output_tokens: 12 },
      }),
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
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_field_proposals' });
    expect((requestInit.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    expect((requestInit.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });

  it('honours an explicit model and maxTokens override', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', input: { proposals: [] } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      maxTokens: 8000,
      fetchImpl,
    });
    await adapter.extract(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(8000);
  });

  it('accepts but does not act on reasoningEffort/storeResponses -- no equivalent exists on this provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', input: { proposals: [] } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({
      apiKey: 'sk-ant-test',
      reasoningEffort: 'high',
      storeResponses: true,
      fetchImpl,
    });
    await adapter.extract(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.reasoning).toBeUndefined();
    expect(body.store).toBeUndefined();
    // The cache key never claims a reasoning-effort dependency this adapter doesn't actually have.
    expect(adapter.cacheKeyComponents().reasoningEffort).toBeUndefined();
  });

  it('coerces an out-of-enum type to UNCERTAIN rather than trusting an unexpected value', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            input: { proposals: [{ type: 'NOT_A_REAL_TYPE', confidence: 0.5 }] },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals[0]?.type).toBe('UNCERTAIN');
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'slow down' }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it('reports upstream_error on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
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

  it('reports invalid_response when the tool_use input has no proposals array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', input: { notProposals: true } }],
        usage: { input_tokens: 1, output_tokens: 1 },
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

  it('reports refused when tool_choice forced the tool but the model produced only text (declined to comply)', async () => {
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
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('not able');
  });

  it('reports truncated (never trusts a partial tool_use as complete) when stop_reason is max_tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'max_tokens',
        content: [{ type: 'tool_use', input: { proposals: [] } }],
        usage: { input_tokens: 500, output_tokens: 4096 },
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
      jsonResponse(200, {
        id: 'msg_xyz789',
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', input: { proposals: [] } }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
      }),
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

const CLASSIFY_INPUT = {
  documentVersionId: 'doc-version-1',
  text: 'statement of account, opening balance, closing balance',
  allowedTypes: ['PASSPORT', 'BANK_STATEMENT', 'EMPLOYMENT_CERTIFICATE'],
};

describe('AnthropicExtractionAdapter.classify (Part 8 AI-01 item 2)', () => {
  it('parses a well-formed forced tool-use response into a suggestion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            input: {
              suggestedType: 'BANK_STATEMENT',
              confidence: 0.85,
              rationale: 'mentions opening and closing balance',
            },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBe('BANK_STATEMENT');
    expect(outcome.result.confidence).toBe(0.85);
    expect(outcome.result.usage.schemaVersion).toBe('document_classification_v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.tool_choice.name).toBe('submit_document_classification');
    expect(JSON.stringify(body)).toContain('BANK_STATEMENT');
  });

  it('reports a null suggestedType as a genuine "could not classify", not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            input: { suggestedType: null, confidence: 0.1, rationale: 'unclear' },
          },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBeNull();
  });

  it('reports refused when the model declines to call the forced tool', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I cannot help with this' }],
        usage: { input_tokens: 5, output_tokens: 5 },
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

const EXPLAIN_INPUT = {
  requirementKind: 'DOCUMENT' as const,
  requirementKey: 'BANK_STATEMENT',
  state: 'CRITICAL_GAP' as const,
  citation: 'Route guide §4.2: proof of funds required.',
  optional: false,
};

describe('AnthropicExtractionAdapter.explain (Part 8 AI-01 item 5)', () => {
  it('parses a well-formed forced tool-use response into an explanation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            input: {
              explanation: 'You need a recent bank statement to show you can support your trip.',
            },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.explanation).toContain('bank statement');
    expect(outcome.result.usage.schemaVersion).toBe('readiness_gap_explanation_v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.tool_choice.name).toBe('submit_readiness_gap_explanation');
    expect(JSON.stringify(body)).toContain('Route guide');
  });

  it('reports refused when the model declines to call the forced tool', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I cannot help with this' }],
        usage: { input_tokens: 5, output_tokens: 5 },
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

const INCONSISTENCY_INPUT = {
  documentVersionId: 'doc-version-1',
  text: 'Name: Anna Marie Eriksson. DOB: 1990-04-02.',
  profileFacts: [{ fieldKey: 'applicant.givenNames', value: 'Anna Maria' }],
};

describe('AnthropicExtractionAdapter.checkConsistency (Part 8 AI-01 item 4)', () => {
  it('parses a well-formed forced tool-use response into flags', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            input: {
              flags: [
                {
                  description: 'Given names differ between the document and the profile',
                  confidence: 0.7,
                  rationale: '"Marie" on the document vs. "Maria" on file',
                },
              ],
            },
          },
        ],
        usage: { input_tokens: 15, output_tokens: 15 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(1);
    expect(outcome.result.flags[0]?.description).toContain('Given names differ');
    expect(outcome.result.usage.schemaVersion).toBe('inconsistency_flags_v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.tool_choice.name).toBe('submit_inconsistency_flags');
    expect(JSON.stringify(body)).toContain('Anna Maria');
  });

  it('reports zero flags as a genuine, valid, good outcome', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', input: { flags: [] } }],
        usage: { input_tokens: 8, output_tokens: 2 },
      }),
    );
    const adapter = new AnthropicExtractionAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(0);
  });

  it('reports refused when the model declines to call the forced tool', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I cannot help with this' }],
        usage: { input_tokens: 5, output_tokens: 5 },
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
