import { describe, expect, it, vi } from 'vitest';
import { OpenAiExtractionAdapter } from './openai-extraction';

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

describe('OpenAiExtractionAdapter', () => {
  it('parses a well-formed structured-output response into proposals', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({
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
        }),
        usage: { total_tokens: 42 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]?.fieldKey).toBe('passport.number');
    expect(outcome.result.proposals[0]?.confidence).toBe(0.95);
    expect(outcome.result.usage.costUnits).toBe(42);
    expect(outcome.result.usage.modelVersion).toBe('gpt-5.6-terra');

    // Sends only the deterministic text + allowed keys — never raw file bytes.
    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('L898902C3');
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.strict).toBe(true);
    // Privacy minimization default: never let OpenAI retain the request unless opted in.
    expect(body.store).toBe(false);
    expect((requestInit.headers as Record<string, string>)['OpenAI-Project']).toBeUndefined();
  });

  it('honours projectId, reasoningEffort, and an explicit storeResponses opt-in', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({ proposals: [] }),
        usage: { total_tokens: 1 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({
      apiKey: 'sk-test',
      projectId: 'proj_123',
      reasoningEffort: 'high',
      storeResponses: true,
      fetchImpl,
    });
    await adapter.extract(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((requestInit.headers as Record<string, string>)['OpenAI-Project']).toBe('proj_123');
    const body = JSON.parse(requestInit.body as string);
    expect(body.store).toBe(true);
    expect(body.reasoning.effort).toBe('high');
  });

  it('falls back to walking output[].content[].text when output_text is absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output: [
          {
            content: [{ text: JSON.stringify({ proposals: [] }) }],
          },
        ],
        usage: { total_tokens: 7 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals).toHaveLength(0);
    expect(outcome.result.usage.costUnits).toBe(7);
  });

  it('coerces an out-of-enum type to UNCERTAIN rather than trusting an unexpected value', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({
          proposals: [{ type: 'NOT_A_REAL_TYPE', confidence: 0.5 }],
        }),
        usage: { total_tokens: 1 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals[0]?.type).toBe('UNCERTAIN');
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'slow down' }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it('reports upstream_error on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
  });

  it('reports upstream_error when fetch itself throws (network failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure'));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('DNS failure');
  });

  it('reports invalid_response when the payload has no recognizable output text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when the cited output text is not valid JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { output_text: 'not json at all', usage: { total_tokens: 1 } }),
      );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports timeout when the request exceeds the configured timeout, never hanging the caller', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl, timeoutMs: 20 });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('timeout');
    expect(outcome.provider).toBe('openai');
    // A timer can fire a millisecond early against the clock; this only has to show it waited.
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('reports auth_failed (never generic upstream_error) on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid api key' }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-bad', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports auth_failed on HTTP 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-bad', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports refused (never a silent empty proposal set) when the model returns a structured-output refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output: [{ content: [{ refusal: 'I cannot process this request' }] }],
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('cannot process');
  });

  it('reports truncated (never trusts partial JSON as complete) when the response status is incomplete', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output_text: JSON.stringify({ proposals: [] }),
        usage: { total_tokens: 100 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('captures the provider, provider request id, latency, and the input/output/cached token breakdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'resp_abc123',
        output_text: JSON.stringify({ proposals: [] }),
        usage: {
          total_tokens: 150,
          input_tokens: 100,
          output_tokens: 50,
          input_tokens_details: { cached_tokens: 20 },
        },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.usage.provider).toBe('openai');
    expect(outcome.result.usage.providerRequestId).toBe('resp_abc123');
    expect(outcome.result.usage.inputUnits).toBe(100);
    expect(outcome.result.usage.outputUnits).toBe(50);
    expect(outcome.result.usage.cachedUnits).toBe(20);
    expect(outcome.result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

const CLASSIFY_INPUT = {
  documentVersionId: 'doc-version-1',
  text: 'statement of account, opening balance, closing balance',
  allowedTypes: ['PASSPORT', 'BANK_STATEMENT', 'EMPLOYMENT_CERTIFICATE'],
};

describe('OpenAiExtractionAdapter.classify (Part 8 AI-01 item 2)', () => {
  it('parses a well-formed structured-output response into a suggestion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({
          suggestedType: 'BANK_STATEMENT',
          confidence: 0.85,
          rationale: 'mentions opening and closing balance',
        }),
        usage: { total_tokens: 20 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBe('BANK_STATEMENT');
    expect(outcome.result.confidence).toBe(0.85);
    expect(outcome.result.usage.costUnits).toBe(20);
    expect(outcome.result.usage.schemaVersion).toBe('document_classification_v1');
    // A distinct prompt version from extract()'s own -- the two tasks are cached independently.
    expect(outcome.result.usage.promptVersion).not.toBe('2026-07-29-v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('BANK_STATEMENT');
    expect(body.text.format.name).toBe('document_classification');
  });

  it('reports a null suggestedType as a genuine "could not classify", not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({ suggestedType: null, confidence: 0.1, rationale: 'unclear' }),
        usage: { total_tokens: 5 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBeNull();
  });

  it('reports refused when the model declines via the structured-output refusal field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output: [{ content: [{ refusal: 'cannot help with this' }] }],
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when the response was cut off before completing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 'incomplete',
        output_text: JSON.stringify({ suggestedType: null, confidence: 0, rationale: null }),
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'bad key' }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("classifyCacheKeyComponents never collides with extract()'s own cacheKeyComponents", () => {
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test' });
    const extractionComponents = adapter.cacheKeyComponents();
    const classifyComponents = adapter.classifyCacheKeyComponents();
    expect(classifyComponents.schemaVersion).not.toBe(extractionComponents.schemaVersion);
    expect(classifyComponents.promptVersion).not.toBe(extractionComponents.promptVersion);
  });
});

const EXPLAIN_INPUT = {
  requirementKind: 'DOCUMENT' as const,
  requirementKey: 'BANK_STATEMENT',
  state: 'CRITICAL_GAP' as const,
  citation: 'Route guide §4.2: proof of funds required.',
  optional: false,
};

describe('OpenAiExtractionAdapter.explain (Part 8 AI-01 item 5)', () => {
  it('parses a well-formed structured-output response into an explanation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({
          explanation: 'You need a recent bank statement to show you can support your trip.',
        }),
        usage: { total_tokens: 15 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.explanation).toContain('bank statement');
    expect(outcome.result.usage.schemaVersion).toBe('readiness_gap_explanation_v1');
    expect(outcome.result.usage.promptVersion).not.toBe('2026-07-29-v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('Route guide');
    expect(body.text.format.name).toBe('readiness_gap_explanation');
  });

  it('reports refused when the model declines via the structured-output refusal field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output: [{ content: [{ refusal: 'cannot help with this' }] }],
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when the response was cut off before completing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 'incomplete',
        output_text: JSON.stringify({ explanation: '' }),
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'slow down' }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it("explainCacheKeyComponents never collides with extract()'s or classify()'s own cache-key methods", () => {
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test' });
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

describe('OpenAiExtractionAdapter.checkConsistency (Part 8 AI-01 item 4)', () => {
  it('parses a well-formed structured-output response into flags', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({
          flags: [
            {
              description: 'Given names differ between the document and the profile',
              confidence: 0.7,
              rationale: '"Marie" on the document vs. "Maria" on file',
            },
          ],
        }),
        usage: { total_tokens: 30 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(1);
    expect(outcome.result.flags[0]?.description).toContain('Given names differ');
    expect(outcome.result.flags[0]?.confidence).toBe(0.7);
    expect(outcome.result.usage.costUnits).toBe(30);
    expect(outcome.result.usage.schemaVersion).toBe('inconsistency_flags_v1');
    // A distinct prompt version from every other task's own -- cached independently.
    expect(outcome.result.usage.promptVersion).not.toBe('2026-07-29-v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('Anna Maria');
    expect(body.text.format.name).toBe('inconsistency_flags');
  });

  it('reports zero flags as a genuine, valid, good outcome', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({ flags: [] }),
        usage: { total_tokens: 10 },
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(0);
  });

  it('reports refused when the model declines via the structured-output refusal field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output: [{ content: [{ refusal: 'cannot help with this' }] }],
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when the response was cut off before completing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 'incomplete',
        output_text: JSON.stringify({ flags: [] }),
      }),
    );
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'bad key' }));
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("inconsistencyCacheKeyComponents never collides with any other port's own cache-key method", () => {
    const adapter = new OpenAiExtractionAdapter({ apiKey: 'sk-test' });
    const extractionComponents = adapter.cacheKeyComponents();
    const classifyComponents = adapter.classifyCacheKeyComponents();
    const explainComponents = adapter.explainCacheKeyComponents();
    const inconsistencyComponents = adapter.inconsistencyCacheKeyComponents();
    expect(inconsistencyComponents.schemaVersion).not.toBe(extractionComponents.schemaVersion);
    expect(inconsistencyComponents.schemaVersion).not.toBe(classifyComponents.schemaVersion);
    expect(inconsistencyComponents.schemaVersion).not.toBe(explainComponents.schemaVersion);
  });
});
