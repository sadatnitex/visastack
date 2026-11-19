import { describe, expect, it, vi } from 'vitest';
import {
  anthropicUsageUnits,
  callStructured,
  readStructuredReply,
  structuredRequestBody,
} from './anthropic-messages';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
};

interface SentBody {
  readonly model?: unknown;
  readonly max_tokens?: unknown;
  readonly system?: unknown;
  readonly messages?: unknown;
  readonly output_config?: unknown;
  readonly cache_control?: unknown;
}

interface SystemBlock {
  readonly cache_control?: unknown;
}

function body(overrides: Partial<Parameters<typeof structuredRequestBody>[0]> = {}) {
  return structuredRequestBody({
    model: 'claude-sonnet-5-5',
    maxTokens: 16_000,
    system: 'A fixed instruction that never changes between requests.',
    content: 'Per-document text: passport L898902C3.',
    schema: SCHEMA,
    effort: 'medium',
    ...overrides,
  }) as SentBody;
}

function reply(usage: Record<string, unknown> | undefined): unknown {
  return {
    id: 'msg_1',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ answer: 'ok' }) }],
    ...(usage ? { usage } : {}),
  };
}

describe('structuredRequestBody prompt caching', () => {
  it('sends the system prompt as a text block array with the cache breakpoint on its last block', () => {
    const sent = body();
    expect(Array.isArray(sent.system)).toBe(true);
    const system = sent.system as SystemBlock[];
    expect(system).toHaveLength(1);
    expect(system[0]).toEqual({
      type: 'text',
      text: 'A fixed instruction that never changes between requests.',
      cache_control: { type: 'ephemeral' },
    });
    expect(system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('never puts a cache breakpoint on the per-document content, and sets no request-level automatic breakpoint', () => {
    for (const content of [
      'Per-document text',
      [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
    ]) {
      const sent = body({ content });
      expect(JSON.stringify(sent.messages)).not.toContain('cache_control');
      expect(sent.messages).toEqual([{ role: 'user', content }]);
      // A top-level cache_control would move the breakpoint onto the last block, the document.
      expect(sent.cache_control).toBeUndefined();
    }
  });

  it('keeps the model, token ceiling, answer schema and effort exactly as before', () => {
    const sent = body();
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.max_tokens).toBe(16_000);
    expect(sent.output_config).toEqual({
      format: { type: 'json_schema', schema: SCHEMA },
      effort: 'medium',
    });
    expect(body({ effort: undefined }).output_config).toEqual({
      format: { type: 'json_schema', schema: SCHEMA },
    });
  });

  it('gives byte-identical system blocks for two different documents, so nothing per-request is cached', () => {
    const first = body({ content: 'Document A: Anna Maria Eriksson, 1990-04-02.' });
    const second = body({ content: 'Document B: Rahim Uddin, 1985-11-30.' });
    expect(JSON.stringify(first.system)).toBe(JSON.stringify(second.system));
    expect(JSON.stringify(first.system)).not.toContain('Eriksson');
    expect(JSON.stringify(second.system)).not.toContain('Rahim');
  });
});

describe('readStructuredReply usage', () => {
  it('maps cache reads and cache writes separately from uncached input', () => {
    const reading = readStructuredReply(
      reply({
        input_tokens: 40,
        output_tokens: 12,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 520,
      }),
    );
    expect(reading).toMatchObject({
      kind: 'json',
      inputTokens: 40,
      outputTokens: 12,
      cachedTokens: 300,
      cacheWriteTokens: 520,
    });
  });

  it('maps absent or malformed cache fields, and an absent usage block, to 0', () => {
    expect(readStructuredReply(reply({ input_tokens: 5, output_tokens: 2 }))).toMatchObject({
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(
      readStructuredReply(
        reply({
          input_tokens: 5,
          output_tokens: 2,
          cache_read_input_tokens: '9',
          cache_creation_input_tokens: null,
        }),
      ),
    ).toMatchObject({ inputTokens: 5, cachedTokens: 0, cacheWriteTokens: 0 });
    expect(readStructuredReply(reply(undefined))).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('never lets a negative or non-finite count into the usage record', () => {
    expect(
      readStructuredReply(
        reply({
          input_tokens: -3,
          output_tokens: Number.POSITIVE_INFINITY,
          cache_read_input_tokens: Number.NaN,
          cache_creation_input_tokens: -1,
        }),
      ),
    ).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 });
  });
});

describe('anthropicUsageUnits', () => {
  it('counts every input token the request processed: uncached, written to the cache and read from it', () => {
    expect(
      anthropicUsageUnits({
        inputTokens: 40,
        outputTokens: 12,
        cachedTokens: 300,
        cacheWriteTokens: 520,
      }),
    ).toEqual({ costUnits: 872, inputUnits: 860, outputUnits: 12, cachedUnits: 300 });
  });

  it('is unchanged from the old meaning when nothing was cached', () => {
    expect(
      anthropicUsageUnits({
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toEqual({ costUnits: 150, inputUnits: 100, outputUnits: 50, cachedUnits: 0 });
  });
});

describe('callStructured', () => {
  it('still fails closed through upstream_error when Anthropic refuses the request with a 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'bad' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const outcome = await callStructured({
      apiKey: 'sk-ant-test',
      body: body(),
      timeoutMs: 5_000,
      fetchImpl,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('upstream_error');
    expect(outcome.message).toContain('400');
  });

  it('sends the cached system block on the wire unchanged', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(reply({ input_tokens: 1, output_tokens: 1 })), { status: 200 }),
      );
    const sentBody = body();
    const outcome = await callStructured({
      apiKey: 'sk-ant-test',
      body: sentBody,
      timeoutMs: 5_000,
      fetchImpl,
    });
    expect(outcome.ok).toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(sentBody);
    expect(JSON.parse(init.body as string).system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
