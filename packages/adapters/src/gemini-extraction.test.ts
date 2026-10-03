import { describe, expect, it, vi } from 'vitest';
import { GeminiExtractionAdapter } from './gemini-extraction';

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

describe('GeminiExtractionAdapter', () => {
  it('parses a well-formed JSON-mode response into proposals', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
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
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12, totalTokenCount: 42 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]?.fieldKey).toBe('passport.number');
    expect(outcome.result.proposals[0]?.confidence).toBe(0.95);
    expect(outcome.result.usage.costUnits).toBe(42);
    expect(outcome.result.usage.inputUnits).toBe(30);
    expect(outcome.result.usage.outputUnits).toBe(12);
    expect(outcome.result.usage.modelVersion).toBe('gemini-3.5-flash');
    expect(outcome.result.usage.provider).toBe('gemini');

    // Sends only the deterministic text + allowed keys -- never raw file bytes.
    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    );
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('L898902C3');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect((requestInit.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
  });

  it('never sets responseSchema nullable (a documented source of real 400s), and never requires the four optional fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ proposals: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    await adapter.extract(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    const schema = body.generationConfig.responseSchema;
    expect(JSON.stringify(schema)).not.toContain('nullable');
    expect(schema.properties.proposals.items.required).toEqual(['type', 'confidence']);
  });

  it('honours an explicit model override', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ proposals: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({
      apiKey: 'AIza-test',
      model: 'gemini-3.8-flash',
      fetchImpl,
    });
    await adapter.extract(VALID_INPUT);

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
  });

  it('accepts but does not act on reasoningEffort/storeResponses -- no equivalent exists on this provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ proposals: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({
      apiKey: 'AIza-test',
      reasoningEffort: 'high',
      storeResponses: true,
      fetchImpl,
    });
    await adapter.extract(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.thinkingConfig).toBeUndefined();
    expect(body.store).toBeUndefined();
    expect(adapter.cacheKeyComponents().reasoningEffort).toBeUndefined();
  });

  it('coerces an out-of-enum type to UNCERTAIN rather than trusting an unexpected value', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    proposals: [{ type: 'NOT_A_REAL_TYPE', confidence: 0.5 }],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.proposals[0]?.type).toBe('UNCERTAIN');
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: { message: 'slow down' } }));
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it('reports upstream_error on a non-2xx response unrelated to the API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
  });

  it('reports upstream_error when fetch itself throws (network failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure'));
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('DNS failure');
  });

  it('reports invalid_response when the payload has no candidates and no promptFeedback at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when the cited text is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: 'not json at all' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports timeout when the request exceeds the configured timeout, never hanging the caller', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl, timeoutMs: 20 });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('timeout');
    expect(outcome.provider).toBe('gemini');
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(20);
  });

  it('reports auth_failed on HTTP 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: { message: 'unauthorized' } }));
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-bad', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports auth_failed (never generic upstream_error) on Gemini\'s own HTTP 400 + "API key not valid" shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
        },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-bad', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports upstream_error (not auth_failed) for an ordinary malformed-request HTTP 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: { code: 400, message: 'Invalid model name', status: 'INVALID_ARGUMENT' },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
  });

  it('reports refused when the whole prompt is blocked (promptFeedback.blockReason, no candidates at all)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('SAFETY');
  });

  it('reports refused (never a silent empty proposal set) when a candidate finishes for a non-normal reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'PROHIBITED_CONTENT' }],
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('PROHIBITED_CONTENT');
  });

  it('reports truncated (never trusts a partial fragment as complete) when finishReason is MAX_TOKENS', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          { content: { parts: [{ text: '{"proposals": [' }] }, finishReason: 'MAX_TOKENS' },
        ],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 4096, totalTokenCount: 4596 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('captures the provider, latency, and the input/output/cached token breakdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ proposals: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
          cachedContentTokenCount: 20,
        },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.extract(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.usage.provider).toBe('gemini');
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

describe('GeminiExtractionAdapter.classify (Part 8 AI-01 item 2)', () => {
  it('parses a well-formed JSON-mode response into a suggestion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    suggestedType: 'BANK_STATEMENT',
                    confidence: 0.85,
                    rationale: 'mentions opening and closing balance',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBe('BANK_STATEMENT');
    expect(outcome.result.confidence).toBe(0.85);
    expect(outcome.result.usage.schemaVersion).toBe('document_classification_v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.generationConfig.responseSchema.required).toEqual(['confidence']);
    expect(JSON.stringify(body)).toContain('BANK_STATEMENT');
  });

  it('reports a null suggestedType when the model omits it entirely', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ confidence: 0.1 }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {},
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.suggestedType).toBeNull();
  });

  it('reports refused on a non-normal finish reason', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when MAX_TOKENS was reached', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on the documented "API key not valid" HTTP 400 shape', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.classify(CLASSIFY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("classifyCacheKeyComponents never collides with extract()'s own cacheKeyComponents", () => {
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test' });
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

describe('GeminiExtractionAdapter.explain (Part 8 AI-01 item 5)', () => {
  it('parses a well-formed JSON-mode response into an explanation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    explanation:
                      'You need a recent bank statement to show you can support your trip.',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.explanation).toContain('bank statement');
    expect(outcome.result.usage.schemaVersion).toBe('readiness_gap_explanation_v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('Route guide');
  });

  it('reports refused on a non-normal finish reason', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when MAX_TOKENS was reached', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on the documented "API key not valid" HTTP 400 shape', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.explain(EXPLAIN_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("explainCacheKeyComponents never collides with extract()'s or classify()'s own cache-key methods", () => {
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test' });
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

describe('GeminiExtractionAdapter.checkConsistency (Part 8 AI-01 item 4)', () => {
  it('parses a well-formed JSON-mode response into flags', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    flags: [
                      {
                        description: 'Given names differ between the document and the profile',
                        confidence: 0.7,
                        rationale: '"Marie" on the document vs. "Maria" on file',
                      },
                    ],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 12, totalTokenCount: 24 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(1);
    expect(outcome.result.flags[0]?.description).toContain('Given names differ');
    expect(outcome.result.usage.schemaVersion).toBe('inconsistency_flags_v1');

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(JSON.stringify(body)).toContain('Anna Maria');
  });

  it('reports zero flags as a genuine, valid, good outcome', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ flags: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 },
      }),
    );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.flags).toHaveLength(0);
  });

  it('reports refused on a non-normal finish reason', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
  });

  it('reports truncated when MAX_TOKENS was reached', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('reports auth_failed on the documented "API key not valid" HTTP 400 shape', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
      );
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.checkConsistency(INCONSISTENCY_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it("inconsistencyCacheKeyComponents never collides with any other port's own cache-key method", () => {
    const adapter = new GeminiExtractionAdapter({ apiKey: 'AIza-test' });
    const extractionComponents = adapter.cacheKeyComponents();
    const classifyComponents = adapter.classifyCacheKeyComponents();
    const explainComponents = adapter.explainCacheKeyComponents();
    const inconsistencyComponents = adapter.inconsistencyCacheKeyComponents();
    expect(inconsistencyComponents.schemaVersion).not.toBe(extractionComponents.schemaVersion);
    expect(inconsistencyComponents.schemaVersion).not.toBe(classifyComponents.schemaVersion);
    expect(inconsistencyComponents.schemaVersion).not.toBe(explainComponents.schemaVersion);
  });
});
