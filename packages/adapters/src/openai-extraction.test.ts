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
});
