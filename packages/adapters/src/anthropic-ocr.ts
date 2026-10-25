import type {
  AiOcrCacheKeyComponents,
  AiOcrInput,
  AiOcrOutcome,
  AiOcrPort,
  OcrReviewIssueCode,
} from '@visastack/services';
import { withTimeout } from './timeout';

/**
 * Anthropic Messages API OCR adapter (Part 8 §9: "configured evaluated
 * vision model"). Structurally parallel to `AnthropicExtractionAdapter` --
 * same Messages API endpoint, same forced tool-use structured-output
 * mechanism, same timeout/error-classification shape -- but sends a vision
 * `image` content block instead of plain text, since OCR has no
 * deterministically-extracted text to send in the first place. Verified
 * against the current Claude vision docs at implementation time
 * (`https://platform.claude.com/docs/en/build-with-claude/vision`, checked
 * 2026-09-28; the legacy `docs.anthropic.com` host is blocked by this
 * sandbox's egress policy, so this adapter was built from that live fetch,
 * not assumed from the text-only adapter's own shape): the image content
 * block is `{type: "image", source: {type: "base64", media_type, data}}`,
 * placed before the accompanying text block per the docs' own stated
 * "images before text" guidance, and coexists in the same request with
 * `tools`/`tool_choice` exactly the way the text-only adapter already uses
 * them -- vision does not change the structured-output mechanism.
 *
 * This is the same deliberate reversal of `AnthropicExtractionAdapter`'s
 * "never send raw file bytes" discipline that `OpenAiOcrAdapter` already
 * makes, for the identical reason (see `packages/services/src/ocr.ts`'s own
 * doc comment): OCR has no text to extract from, so image bytes must leave
 * the server by design. Images are sent as base64-embedded content blocks,
 * never as a publicly-fetchable URL source.
 *
 * Provider notes (Part 8 §3's own required record):
 * - Docs: https://platform.claude.com/docs/en/build-with-claude/vision
 *   (checked 2026-09-28, live fetch).
 * - API version: `2023-06-01` (the `anthropic-version` header), the same
 *   generation `AnthropicExtractionAdapter` targets.
 * - Structured-output mechanism: forced tool use, identical to the
 *   text-only adapter.
 * - Supported image types for this adapter: `image/png`/`image/jpeg` only,
 *   matching `AiOcrContentType` -- the Messages API itself also accepts
 *   `image/gif`/`image/webp`, but nothing in this codebase's upload/preview
 *   pipeline ever produces those for `renderOcrSourceImage`'s output.
 * - `storeResponses`/`reasoningEffort` are accepted-but-no-op, the identical
 *   documented limitation `AnthropicExtractionAdapter` already records (no
 *   per-request retention toggle; no effort dial on this API).
 */

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_PROMPT_VERSION = '2026-09-28-v1';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/** Part 8 §11's named default request timeout, matching every other adapter's own. */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4096;
const PROVIDER = 'anthropic';
const TOOL_NAME = 'submit_ocr_result';

const REVIEW_ISSUE_CODES = [
  'low_quality',
  'ambiguous_date',
  'unsupported_script',
  'missing_text',
] as const;

const SYSTEM_PROMPT = `You perform OCR (optical character recognition) on a single scanned document image for an immigration case-management system. Transcribe ALL visible text on the page, verbatim, exactly as it appears -- do not summarize, translate, correct spelling, or infer missing characters.

Rules:
- Transcribe every visible character, number, and word exactly as printed or written, preserving line breaks where they aid readability.
- If the image quality makes any text genuinely illegible, include "low_quality" in "reviewIssues" and transcribe only what you can confidently read.
- If a date on the page is ambiguous (an unclear format, a smudged digit, or a date that could be read more than one way), include "ambiguous_date" in "reviewIssues".
- If any text is in a script you cannot confidently transcribe, include "unsupported_script" in "reviewIssues" and transcribe only what you can.
- If the image contains no legible text at all, set "text" to an empty string and include "missing_text" in "reviewIssues".
- Never invent text that is not actually visible in the image.
- You must always respond by calling the ${TOOL_NAME} tool -- never with plain text.`;

const OCR_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    reviewIssues: {
      type: 'array',
      items: { type: 'string', enum: [...REVIEW_ISSUE_CODES] },
    },
  },
  required: ['text', 'reviewIssues'],
} as const;

export interface AnthropicOcrAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Accepted for interface-shape parity with the other adapters; currently a no-op (see class doc comment). */
  readonly storeResponses?: boolean;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class AnthropicOcrAdapter implements AiOcrPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicOcrAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  cacheKeyComponents(): AiOcrCacheKeyComponents {
    return { provider: PROVIDER, model: this.model, promptVersion: this.promptVersion };
  }

  async performOcr(input: AiOcrInput): Promise<AiOcrOutcome> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await withTimeout(
        this.fetchImpl(MESSAGES_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: this.maxTokens,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: input.contentType,
                      data: toBase64(input.imageBytes),
                    },
                  },
                  { type: 'text', text: 'Transcribe this document image.' },
                ],
              },
            ],
            tools: [
              {
                name: TOOL_NAME,
                description: 'Submit the OCR result for this document image.',
                input_schema: OCR_INPUT_SCHEMA,
              },
            ],
            tool_choice: { type: 'tool', name: TOOL_NAME },
          }),
        }),
        this.timeoutMs,
        'Anthropic Messages API call',
      );
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const timedOut = error instanceof Error && error.message.includes('timed out after');
      return {
        ok: false,
        code: timedOut ? 'timeout' : 'upstream_error',
        message: error instanceof Error ? error.message : 'network error calling Anthropic',
        provider: PROVIDER,
        latencyMs,
      };
    }
    const latencyMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'auth_failed',
        message: `Anthropic rejected the configured API key (status ${response.status})`,
        provider: PROVIDER,
        latencyMs,
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        code: 'rate_limited',
        message: 'Anthropic rate limit exceeded',
        provider: PROVIDER,
        latencyMs,
      };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        code: 'upstream_error',
        message: `Anthropic responded ${response.status}: ${body.slice(0, 500)}`,
        provider: PROVIDER,
        latencyMs,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        code: 'invalid_response',
        message: 'Anthropic response was not valid JSON',
        provider: PROVIDER,
        latencyMs,
      };
    }

    const parsed = parseMessagesPayload(payload);
    if (parsed.kind === 'invalid') {
      return {
        ok: false,
        code: 'invalid_response',
        message: 'Anthropic response had an unexpected shape',
        provider: PROVIDER,
        latencyMs,
      };
    }
    if (parsed.kind === 'refusal') {
      return { ok: false, code: 'refused', message: parsed.message, provider: PROVIDER, latencyMs };
    }
    if (parsed.kind === 'truncated') {
      return {
        ok: false,
        code: 'truncated',
        message: 'Anthropic response was truncated before completing (max_tokens reached)',
        provider: PROVIDER,
        latencyMs,
      };
    }

    return {
      ok: true,
      result: {
        text: parsed.text,
        reviewIssues: parsed.reviewIssues,
        usage: {
          costUnits: parsed.inputTokens + parsed.outputTokens,
          inputUnits: parsed.inputTokens,
          outputUnits: parsed.outputTokens,
          modelVersion: this.model,
          promptVersion: this.promptVersion,
          provider: PROVIDER,
          ...(parsed.messageId ? { providerRequestId: parsed.messageId } : {}),
          latencyMs,
        },
      },
    };
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function toReviewIssue(value: string): OcrReviewIssueCode | undefined {
  return (REVIEW_ISSUE_CODES as readonly string[]).includes(value)
    ? (value as OcrReviewIssueCode)
    : undefined;
}

// Declared (non-index-signature) shapes for the untrusted response payload --
// same defensive-parsing discipline as `anthropic-extraction.ts`'s own.
interface RawMessagesPayload {
  readonly id?: unknown;
  readonly stop_reason?: unknown;
  readonly content?: unknown;
  readonly usage?: unknown;
}
interface RawContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly input?: unknown;
}
interface RawUsage {
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
}
interface RawToolInput {
  readonly text?: unknown;
  readonly reviewIssues?: unknown;
}

type ParsedMessagesPayload =
  | {
      readonly kind: 'result';
      readonly text: string;
      readonly reviewIssues: readonly OcrReviewIssueCode[];
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly messageId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

function parseMessagesPayload(payload: unknown): ParsedMessagesPayload {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawMessagesPayload;

  // Same "never trust a partial tool_use block" discipline as
  // `anthropic-extraction.ts`'s own identical check.
  if (record.stop_reason === 'max_tokens') return { kind: 'truncated' };

  const content = Array.isArray(record.content) ? (record.content as RawContentBlock[]) : undefined;
  if (!content) return { kind: 'invalid' };

  const toolUse = content.find(
    (block) => typeof block === 'object' && block !== null && block.type === 'tool_use',
  );

  if (record.stop_reason === 'refusal' || !toolUse) {
    const textBlock = content.find(
      (block) => typeof block === 'object' && block !== null && typeof block.text === 'string',
    );
    return {
      kind: 'refusal',
      message:
        typeof textBlock?.text === 'string' && textBlock.text.length > 0
          ? textBlock.text
          : 'Anthropic declined to call the required tool',
    };
  }

  const toolInput = toolUse.input;
  if (typeof toolInput !== 'object' || toolInput === null) return { kind: 'invalid' };
  const rawInput = toolInput as RawToolInput;
  if (typeof rawInput.text !== 'string') return { kind: 'invalid' };
  if (!Array.isArray(rawInput.reviewIssues)) return { kind: 'invalid' };

  const reviewIssues = rawInput.reviewIssues
    .filter((v): v is string => typeof v === 'string')
    .map(toReviewIssue)
    .filter((v): v is OcrReviewIssueCode => v !== undefined);

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;

  return {
    kind: 'result',
    text: rawInput.text,
    reviewIssues,
    inputTokens,
    outputTokens,
    ...(typeof record.id === 'string' ? { messageId: record.id } : {}),
  };
}
