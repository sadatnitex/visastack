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
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(20);
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
