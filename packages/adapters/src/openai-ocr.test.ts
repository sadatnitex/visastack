import { describe, expect, it, vi } from 'vitest';
import { OpenAiOcrAdapter } from './openai-ocr';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_INPUT = {
  documentVersionId: 'doc-version-1',
  imageBytes: new Uint8Array([1, 2, 3, 4]),
  contentType: 'image/png' as const,
};

describe('OpenAiOcrAdapter', () => {
  it('parses a well-formed structured-output response into text + review issues', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({
          text: 'PASSPORT\nSurname: ERIKSSON\nGiven Names: ANNA MARIA',
          reviewIssues: [],
        }),
        usage: { total_tokens: 42, input_tokens: 30, output_tokens: 12 },
      }),
    );
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toContain('ERIKSSON');
    expect(outcome.result.reviewIssues).toEqual([]);
    expect(outcome.result.usage.costUnits).toBe(42);
    expect(outcome.result.usage.modelVersion).toBe('gpt-5.6-terra');

    // Sends the image as a base64 data URI, never a bare/public URL -- and
    // never lets OpenAI retain the request unless explicitly opted in.
    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.store).toBe(false);
    const userContent = body.input[1].content;
    const imagePart = userContent.find((p: { type: string }) => p.type === 'input_image');
    expect(imagePart.image_url).toBe('data:image/png;base64,AQIDBA==');
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.strict).toBe(true);
  });

  it('honours projectId and an explicit storeResponses opt-in', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({ text: '', reviewIssues: ['missing_text'] }),
        usage: { total_tokens: 1 },
      }),
    );
    const adapter = new OpenAiOcrAdapter({
      apiKey: 'sk-test',
      projectId: 'proj_123',
      storeResponses: true,
      fetchImpl,
    });
    await adapter.performOcr(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((requestInit.headers as Record<string, string>)['OpenAI-Project']).toBe('proj_123');
    const body = JSON.parse(requestInit.body as string);
    expect(body.store).toBe(true);
  });

  it('reports every review issue the model names, filtering out anything outside the known set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({
          text: 'partial text',
          reviewIssues: ['low_quality', 'ambiguous_date', 'not_a_real_issue'],
        }),
        usage: { total_tokens: 1 },
      }),
    );
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.reviewIssues).toEqual(['low_quality', 'ambiguous_date']);
  });

  it('falls back to walking output[].content[].text when output_text is absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output: [{ content: [{ text: JSON.stringify({ text: 'hello', reviewIssues: [] }) }] }],
        usage: { total_tokens: 7 },
      }),
    );
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toBe('hello');
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'slow down' }));
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it('reports upstream_error on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
  });

  it('reports upstream_error when fetch itself throws (network failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure'));
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('DNS failure');
  });

  it('reports invalid_response when the payload has no recognizable output text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
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
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when "text" is missing from an otherwise well-formed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output_text: JSON.stringify({ reviewIssues: [] }),
        usage: { total_tokens: 1 },
      }),
    );
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports timeout when the request exceeds the configured timeout, never hanging the caller', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl, timeoutMs: 20 });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('timeout');
    expect(outcome.provider).toBe('openai');
    // A timer can fire a millisecond early against the clock; this only has to show it waited.
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('reports auth_failed (never generic upstream_error) on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid api key' }));
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-bad', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports auth_failed on HTTP 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-bad', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports refused (never a silent empty text) when the model returns a structured-output refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        output: [{ content: [{ refusal: 'I cannot process this image' }] }],
      }),
    );
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('cannot process');
  });

  it('reports truncated (never trusts partial JSON as complete) when the response status is incomplete', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 'incomplete',
        output_text: JSON.stringify({ text: 'partial', reviewIssues: [] }),
        usage: { total_tokens: 100 },
      }),
    );
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('captures the provider, provider request id, latency, and the input/output token breakdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'resp_abc123',
        output_text: JSON.stringify({ text: 'hello', reviewIssues: [] }),
        usage: { total_tokens: 150, input_tokens: 100, output_tokens: 50 },
      }),
    );
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.usage.provider).toBe('openai');
    expect(outcome.result.usage.providerRequestId).toBe('resp_abc123');
    expect(outcome.result.usage.inputUnits).toBe(100);
    expect(outcome.result.usage.outputUnits).toBe(50);
    expect(outcome.result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('cacheKeyComponents reports the configured model and prompt version', () => {
    const adapter = new OpenAiOcrAdapter({ apiKey: 'sk-test', model: 'gpt-5.9-vision' });
    expect(adapter.cacheKeyComponents()).toEqual({
      model: 'gpt-5.9-vision',
      promptVersion: '2026-09-28-v1',
    });
  });
});
