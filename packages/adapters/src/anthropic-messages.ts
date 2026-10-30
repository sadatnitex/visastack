/**
 * What the Anthropic adapters (`anthropic-extraction.ts`, `anthropic-ocr.ts`) share about
 * talking to the Messages API: the request shape for a structured JSON answer, and the reading
 * of the reply.
 *
 * Structured output uses the Messages API's own JSON outputs (`output_config.format` with a
 * `json_schema`, checked against
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs on 2026-10-30): the
 * reply is constrained to the schema and arrives as JSON in the text block. It replaced a forced
 * tool call (`tool_choice: {type: "tool"}`) because Claude Opus 5.5, Claude Sonnet 5.5 and
 * Claude Fable 5.1 refuse forced tool calls with a 400, while JSON outputs are available on
 * every model. Thinking, which those models always do first, is unaffected: the schema governs
 * only the final answer, and thinking blocks are skipped when the reply is read.
 */

import { withTimeout } from './timeout';

/** Official host, a plain literal never influenced by any admin/config input (Part 8 §7: "built-in adapters: official provider host locked"). */
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Room for the answer AND any thinking before it: on the models that always think, thinking
 * counts against `max_tokens`, so the old 4096 could cut a long document's answer off. A ceiling,
 * not a target: only what the model actually writes is billed.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000;

const EFFORT_LEVELS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Models that reject `output_config.effort`: Claude 3 and earlier, Claude Opus/Sonnet 4.0 and
 * Opus 4.1, and Claude Sonnet 4.5 and Haiku 4.5. Every model after them takes it, so a model id
 * this list does not know (a newer one) gets it.
 */
const NO_EFFORT_MODEL =
  /^claude-(?:3|instant|(?:haiku|sonnet)-4-5|(?:opus|sonnet)-4(?:-[01])?(?:-\d{8})?$)/;

/**
 * The effort level to send for this model, or undefined to leave the model's own default. Only
 * the admin's chosen level is ever sent, and only to a model that accepts one; a value another
 * provider uses (for example OpenAI's "minimal") is ignored rather than sent and refused.
 */
export function anthropicEffortFor(
  model: string,
  reasoningEffort: string | undefined,
): string | undefined {
  if (!reasoningEffort || !EFFORT_LEVELS.has(reasoningEffort)) return undefined;
  return NO_EFFORT_MODEL.test(model) ? undefined : reasoningEffort;
}

export interface StructuredRequestInput {
  readonly model: string;
  readonly maxTokens: number;
  readonly system: string;
  readonly content: string | readonly unknown[];
  /** A JSON Schema: every object needs `additionalProperties: false` and no number or length limits. */
  readonly schema: object;
  readonly effort?: string | undefined;
}

/** The Messages API request body asking for one JSON answer that matches `schema`. */
export function structuredRequestBody(input: StructuredRequestInput): object {
  return {
    model: input.model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: 'user', content: input.content }],
    output_config: {
      format: { type: 'json_schema', schema: input.schema },
      ...(input.effort ? { effort: input.effort } : {}),
    },
  };
}

export interface StructuredUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly messageId?: string;
}

export type StructuredReading =
  | ({ readonly kind: 'json'; readonly value: object } & StructuredUsage)
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

// Declared (non-index-signature) shapes for the untrusted response payload,
// so narrowing reads as plain dot-access instead of bracket-indexed casts.
interface RawMessagesPayload {
  readonly id?: unknown;
  readonly stop_reason?: unknown;
  readonly stop_details?: unknown;
  readonly content?: unknown;
  readonly usage?: unknown;
}
interface RawContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
}
interface RawStopDetails {
  readonly explanation?: unknown;
}
interface RawUsage {
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
  readonly cache_read_input_tokens?: unknown;
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Reads a Messages API reply to a `structuredRequestBody` request. Fails closed in every case
 * that is not a complete answer:
 * - `max_tokens` reached: `truncated`, even if the text happens to parse, since an answer cut
 *   off part way is never trusted as complete (Part 8 §4's named "truncation" failure mode).
 * - `stop_reason: "refusal"`, or no answer text at all: `refused`, never a silent empty answer
 *   (Part 8 §4's named "refusal" failure mode).
 * - Answer text that is not a JSON object: `invalid`.
 * Thinking blocks are skipped; only `text` blocks make up the answer.
 */
export function readStructuredReply(payload: unknown): StructuredReading {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawMessagesPayload;
  if (record.stop_reason === 'max_tokens') return { kind: 'truncated' };

  const content = Array.isArray(record.content) ? (record.content as RawContentBlock[]) : undefined;
  if (!content) return { kind: 'invalid' };
  const text = content
    .filter((block) => typeof block === 'object' && block !== null && block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');

  if (record.stop_reason === 'refusal' || text.trim().length === 0) {
    const details =
      typeof record.stop_details === 'object' && record.stop_details !== null
        ? (record.stop_details as RawStopDetails)
        : undefined;
    const explanation = typeof details?.explanation === 'string' ? details.explanation : '';
    return {
      kind: 'refusal',
      message: explanation || text.trim() || 'Anthropic declined to answer',
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'invalid' };
  }

  const usage =
    typeof record.usage === 'object' && record.usage !== null
      ? (record.usage as RawUsage)
      : undefined;
  return {
    kind: 'json',
    value,
    inputTokens: tokenCount(usage?.input_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
    cachedTokens: tokenCount(usage?.cache_read_input_tokens),
    ...(typeof record.id === 'string' ? { messageId: record.id } : {}),
  };
}

/** The failure codes an Anthropic call itself can produce; a subset of both the AI and the OCR error code unions. */
export type AnthropicCallErrorCode =
  | 'upstream_error'
  | 'invalid_response'
  | 'rate_limited'
  | 'timeout'
  | 'auth_failed'
  | 'refused'
  | 'truncated';

export type StructuredCallOutcome =
  | ({ readonly ok: true; readonly value: object; readonly latencyMs: number } & StructuredUsage)
  | {
      readonly ok: false;
      readonly code: AnthropicCallErrorCode;
      readonly message: string;
      readonly latencyMs: number;
    };

export interface StructuredCallInput {
  readonly apiKey: string;
  readonly body: object;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
}

/**
 * Sends one `structuredRequestBody` request and classifies the result: a network failure or
 * timeout, an HTTP error (401/403 as `auth_failed`, 429 as `rate_limited`), an unreadable body,
 * or `readStructuredReply`'s own verdict. The caller only checks the answer's shape.
 */
export async function callStructured(input: StructuredCallInput): Promise<StructuredCallOutcome> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await withTimeout(
      input.fetchImpl(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': input.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(input.body),
      }),
      input.timeoutMs,
      'Anthropic Messages API call',
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.message.includes('timed out after');
    return {
      ok: false,
      code: timedOut ? 'timeout' : 'upstream_error',
      message: error instanceof Error ? error.message : 'network error calling Anthropic',
      latencyMs: Date.now() - startedAt,
    };
  }
  const latencyMs = Date.now() - startedAt;
  const fail = (code: AnthropicCallErrorCode, message: string): StructuredCallOutcome => ({
    ok: false,
    code,
    message,
    latencyMs,
  });

  if (response.status === 401 || response.status === 403) {
    return fail(
      'auth_failed',
      `Anthropic rejected the configured API key (status ${response.status})`,
    );
  }
  if (response.status === 429) return fail('rate_limited', 'Anthropic rate limit exceeded');
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return fail('upstream_error', `Anthropic responded ${response.status}: ${body.slice(0, 500)}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fail('invalid_response', 'Anthropic response was not valid JSON');
  }
  const reading = readStructuredReply(payload);
  switch (reading.kind) {
    case 'invalid':
      return fail('invalid_response', 'Anthropic response had an unexpected shape');
    case 'refusal':
      return fail('refused', reading.message);
    case 'truncated':
      return fail(
        'truncated',
        'Anthropic response was truncated before completing (max_tokens reached)',
      );
    case 'json': {
      const { kind: _kind, ...answer } = reading;
      return { ok: true, latencyMs, ...answer };
    }
  }
}

/** An adapter's failure outcome for a failed call; every port's failure has this shape. */
export function anthropicFailure(failure: {
  readonly code: AnthropicCallErrorCode;
  readonly message: string;
  readonly latencyMs: number;
}) {
  return {
    ok: false as const,
    code: failure.code,
    message: failure.message,
    provider: 'anthropic',
    latencyMs: failure.latencyMs,
  };
}

/** A JSON answer that is missing a field the task needs: never treated as an empty answer. */
export function anthropicInvalidShape(latencyMs: number) {
  return anthropicFailure({
    code: 'invalid_response',
    message: 'Anthropic response had an unexpected shape',
    latencyMs,
  });
}

/** Matches a reply's enum value to one of `allowed` ignoring case: JSON outputs keep the value but not always its capitalization. */
export function matchEnumValue<T extends string>(
  allowed: readonly T[],
  value: string,
): T | undefined {
  const lower = value.toLowerCase();
  return allowed.find((candidate) => candidate.toLowerCase() === lower);
}
