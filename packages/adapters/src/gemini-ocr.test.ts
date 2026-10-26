import { describe, expect, it, vi } from 'vitest';
import { GeminiOcrAdapter } from './gemini-ocr';

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

describe('GeminiOcrAdapter', () => {
  it('parses a well-formed JSON-mode response into text + review issues', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    text: 'PASSPORT\nSurname: ERIKSSON\nGiven Names: ANNA MARIA',
                    reviewIssues: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toContain('ERIKSSON');
    expect(outcome.result.reviewIssues).toEqual([]);
    expect(outcome.result.usage.costUnits).toBe(42);
    expect(outcome.result.usage.inputUnits).toBe(30);
    expect(outcome.result.usage.outputUnits).toBe(12);
    expect(outcome.result.usage.modelVersion).toBe('gemini-3.5-flash');
    expect(outcome.result.usage.provider).toBe('gemini');

    // Sends the image as an inline base64 part, never a public URL.
    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    );
    const body = JSON.parse(requestInit.body as string);
    const userParts = body.contents[0].parts;
    const imagePart = userParts.find((p: { inlineData?: unknown }) => p.inlineData);
    expect(imagePart.inlineData).toEqual({ mimeType: 'image/png', data: 'AQIDBA==' });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect((requestInit.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
  });

  it("never sets responseSchema nullable, matching the text-extraction adapter's own documented limitation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ text: '', reviewIssues: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    await adapter.performOcr(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    const schema = body.generationConfig.responseSchema;
    expect(JSON.stringify(schema)).not.toContain('nullable');
    expect(schema.required).toEqual(['text', 'reviewIssues']);
  });

  it('honours an explicit model override', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ text: '', reviewIssues: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );
    const adapter = new GeminiOcrAdapter({
      apiKey: 'AIza-test',
      model: 'gemini-3.8-flash',
      fetchImpl,
    });
    await adapter.performOcr(VALID_INPUT);

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
  });

  it('accepts but does not act on storeResponses -- no equivalent exists on this provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ text: '', reviewIssues: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', storeResponses: true, fetchImpl });
    await adapter.performOcr(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.store).toBeUndefined();
  });

  it('reports every review issue the model names, filtering out anything outside the known set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    text: 'partial text',
                    reviewIssues: ['low_quality', 'ambiguous_date', 'not_a_real_issue'],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.reviewIssues).toEqual(['low_quality', 'ambiguous_date']);
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: { message: 'slow down' } }));
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it('reports upstream_error on a non-2xx response unrelated to the API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
  });

  it('reports upstream_error when fetch itself throws (network failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure'));
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('DNS failure');
  });

  it('reports invalid_response when the payload has no candidates and no promptFeedback at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when the cited text is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: 'not json at all' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when "text" is missing from an otherwise well-formed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ reviewIssues: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports timeout when the request exceeds the configured timeout, never hanging the caller', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl, timeoutMs: 20 });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('timeout');
    expect(outcome.provider).toBe('gemini');
    // A timer can fire a millisecond early against the clock; this only has to show it waited.
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('reports auth_failed on HTTP 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: { message: 'unauthorized' } }));
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-bad', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
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
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-bad', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
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
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
  });

  it('reports refused when the whole prompt is blocked (promptFeedback.blockReason, no candidates at all)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('SAFETY');
  });

  it('reports refused (never a silent empty text) when a candidate finishes for a non-normal reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'PROHIBITED_CONTENT' }],
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('PROHIBITED_CONTENT');
  });

  it('reports truncated (never trusts a partial fragment as complete) when finishReason is MAX_TOKENS', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          { content: { parts: [{ text: '{"text": "partial' }] }, finishReason: 'MAX_TOKENS' },
        ],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 4096 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('captures the provider and the input/output token breakdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ text: 'hello', reviewIssues: [] }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      }),
    );
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.usage.provider).toBe('gemini');
    expect(outcome.result.usage.inputUnits).toBe(100);
    expect(outcome.result.usage.outputUnits).toBe(50);
    expect(outcome.result.usage.costUnits).toBe(150);
    expect(outcome.result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('cacheKeyComponents reports the provider, configured model and prompt version', () => {
    const adapter = new GeminiOcrAdapter({ apiKey: 'AIza-test', model: 'gemini-3.8-flash' });
    expect(adapter.cacheKeyComponents()).toEqual({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      promptVersion: '2026-09-28-v1',
    });
  });
});
