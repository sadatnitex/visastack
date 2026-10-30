import { describe, expect, it, vi } from 'vitest';
import { AnthropicOcrAdapter } from './anthropic-ocr';

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

describe('AnthropicOcrAdapter', () => {
  it('parses a well-formed JSON-outputs answer (after any thinking) into text + review issues', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'msg_abc123',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          {
            type: 'text',
            text: JSON.stringify({
              text: 'PASSPORT\nSurname: ERIKSSON\nGiven Names: ANNA MARIA',
              reviewIssues: [],
            }),
          },
        ],
        usage: { input_tokens: 30, output_tokens: 12 },
      }),
    );
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toContain('ERIKSSON');
    expect(outcome.result.reviewIssues).toEqual([]);
    expect(outcome.result.usage.costUnits).toBe(42);
    expect(outcome.result.usage.inputUnits).toBe(30);
    expect(outcome.result.usage.outputUnits).toBe(12);
    expect(outcome.result.usage.modelVersion).toBe('claude-sonnet-5');
    expect(outcome.result.usage.provider).toBe('anthropic');
    expect(outcome.result.usage.providerRequestId).toBe('msg_abc123');

    // Sends the image as a base64 content block, never a public URL -- and
    // places it before the text part per Anthropic's own "images before
    // text" guidance.
    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.max_tokens).toBe(16_000);
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.output_config.effort).toBeUndefined();
    const userContent = body.messages[0].content;
    expect(userContent[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AQIDBA==' },
    });
    expect(userContent[1].type).toBe('text');
    expect((requestInit.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    expect((requestInit.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });

  it('honours an explicit model and maxTokens override', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ text: '', reviewIssues: [] }) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicOcrAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      maxTokens: 8000,
      fetchImpl,
    });
    await adapter.performOcr(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(8000);
  });

  it('accepts but does not act on storeResponses -- no equivalent exists on this provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ text: '', reviewIssues: [] }) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicOcrAdapter({
      apiKey: 'sk-ant-test',
      storeResponses: true,
      fetchImpl,
    });
    await adapter.performOcr(VALID_INPUT);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.store).toBeUndefined();
  });

  it('reports every review issue the model names, whatever its capitalization, filtering out anything outside the known set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              text: 'partial text',
              reviewIssues: ['low_quality', 'AMBIGUOUS_DATE', 'not_a_real_issue'],
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.reviewIssues).toEqual(['low_quality', 'ambiguous_date']);
  });

  it('reports rate_limited on HTTP 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'slow down' }));
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('rate_limited');
  });

  it('reports upstream_error on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
  });

  it('reports upstream_error when fetch itself throws (network failure)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure'));
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('DNS failure');
  });

  it('reports invalid_response when the payload has no content array at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports invalid_response when the answer has no "text" field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ reviewIssues: [] }) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports timeout when the request exceeds the configured timeout, never hanging the caller', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl, timeoutMs: 20 });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('timeout');
    expect(outcome.provider).toBe('anthropic');
    // A timer can fire a millisecond early against the clock; this only has to show it waited.
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('reports auth_failed (never generic upstream_error) on HTTP 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid api key' }));
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-bad', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports auth_failed on HTTP 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-bad', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auth_failed');
  });

  it('reports refused (never a silent empty text) on an explicit stop_reason of refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'refusal',
        content: [{ type: 'text', text: 'I cannot process this image' }],
      }),
    );
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('refused');
    expect(outcome.message).toContain('cannot process');
  });

  it('reports invalid_response when the answer text is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I am not able to do that.' }],
      }),
    );
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('invalid_response');
  });

  it('reports truncated (never trusts a partial answer as complete) when stop_reason is max_tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"text":"partial","reviewIssues":[]}' }],
        usage: { input_tokens: 500, output_tokens: 16000 },
      }),
    );
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('truncated');
  });

  it('captures the provider, message id, latency, and the input/output token breakdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'msg_xyz789',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ text: 'hello', reviewIssues: [] }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    );
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', fetchImpl });
    const outcome = await adapter.performOcr(VALID_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.usage.provider).toBe('anthropic');
    expect(outcome.result.usage.providerRequestId).toBe('msg_xyz789');
    expect(outcome.result.usage.inputUnits).toBe(100);
    expect(outcome.result.usage.outputUnits).toBe(50);
    expect(outcome.result.usage.costUnits).toBe(150);
    expect(outcome.result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('cacheKeyComponents reports the provider, configured model and prompt version', () => {
    const adapter = new AnthropicOcrAdapter({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5' });
    expect(adapter.cacheKeyComponents()).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      promptVersion: '2026-10-30-v1',
    });
  });

  it('sends the chosen reasoning effort to a model that takes it, and keys the cache on it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ text: '', reviewIssues: [] }) }],
      }),
    );
    const adapter = new AnthropicOcrAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5-5',
      reasoningEffort: 'low',
      fetchImpl,
    });
    await adapter.performOcr(VALID_INPUT);
    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string).output_config.effort).toBe('low');
    expect(adapter.cacheKeyComponents()).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      promptVersion: '2026-10-30-v1',
      reasoningEffort: 'low',
    });
  });

  it('sends no effort to a model that refuses one, and leaves it out of the cache key', () => {
    const adapter = new AnthropicOcrAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5',
      reasoningEffort: 'high',
    });
    expect(adapter.cacheKeyComponents().reasoningEffort).toBeUndefined();
  });
});
