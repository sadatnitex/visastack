import type {
  AiOcrCacheKeyComponents,
  AiOcrInput,
  AiOcrOutcome,
  AiOcrPort,
  OcrReviewIssueCode,
} from '@visastack/services';
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  anthropicEffortFor,
  anthropicFailure,
  anthropicInvalidShape,
  callStructured,
  matchEnumValue,
  structuredRequestBody,
} from './anthropic-messages';

/**
 * Anthropic Messages API OCR adapter (Part 8 §9: "configured evaluated
 * vision model"). Structurally parallel to `AnthropicExtractionAdapter` --
 * same Messages API endpoint, same JSON-outputs structured-output mechanism
 * (`anthropic-messages.ts`), same timeout/error-classification shape -- but
 * sends a vision
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
 * `output_config.format` exactly the way the text-only adapter already uses
 * it -- vision does not change the structured-output mechanism.
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
 * - Structured-output mechanism: JSON outputs (`output_config.format`),
 *   identical to the text-only adapter (checked 2026-10-30).
 * - Supported image types for this adapter: `image/png`/`image/jpeg` only,
 *   matching `AiOcrContentType` -- the Messages API itself also accepts
 *   `image/gif`/`image/webp`, but nothing in this codebase's upload/preview
 *   pipeline ever produces those for `renderOcrSourceImage`'s output.
 * - `storeResponses` is accepted-but-no-op, the identical documented
 *   limitation `AnthropicExtractionAdapter` already records (no per-request
 *   retention toggle). `reasoningEffort` is sent as `output_config.effort`
 *   to models that take it, and is then part of the cache key.
 */

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_PROMPT_VERSION = '2026-10-30-v1';
/** Part 8 §11's named default request timeout, matching every other adapter's own. */
const DEFAULT_TIMEOUT_MS = 60_000;
const PROVIDER = 'anthropic';

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
- Answer only with the JSON object the response format describes -- never with plain text.`;

const OCR_ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    reviewIssues: {
      type: 'array',
      items: { type: 'string', enum: [...REVIEW_ISSUE_CODES] },
    },
  },
  required: ['text', 'reviewIssues'],
  additionalProperties: false,
} as const;

export interface AnthropicOcrAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Sent as `output_config.effort` to models that take it; see the class doc comment. */
  readonly reasoningEffort?: string;
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
  private readonly effort: string | undefined;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicOcrAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.effort = anthropicEffortFor(this.model, options.reasoningEffort);
    this.maxTokens = options.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  cacheKeyComponents(): AiOcrCacheKeyComponents {
    return {
      provider: PROVIDER,
      model: this.model,
      promptVersion: this.promptVersion,
      ...(this.effort ? { reasoningEffort: this.effort } : {}),
    };
  }

  async performOcr(input: AiOcrInput): Promise<AiOcrOutcome> {
    const answer = await callStructured({
      apiKey: this.apiKey,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      body: structuredRequestBody({
        model: this.model,
        maxTokens: this.maxTokens,
        system: SYSTEM_PROMPT,
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
        schema: OCR_ANSWER_SCHEMA,
        effort: this.effort,
      }),
    });
    if (!answer.ok) return anthropicFailure(answer);
    const raw = answer.value as RawOcrAnswer;
    if (typeof raw.text !== 'string' || !Array.isArray(raw.reviewIssues)) {
      return anthropicInvalidShape(answer.latencyMs);
    }
    const reviewIssues = raw.reviewIssues
      .filter((v): v is string => typeof v === 'string')
      .map((v) => matchEnumValue(REVIEW_ISSUE_CODES, v))
      .filter((v): v is OcrReviewIssueCode => v !== undefined);

    return {
      ok: true,
      result: {
        text: raw.text,
        reviewIssues,
        usage: {
          costUnits: answer.inputTokens + answer.outputTokens,
          inputUnits: answer.inputTokens,
          outputUnits: answer.outputTokens,
          modelVersion: this.model,
          promptVersion: this.promptVersion,
          provider: PROVIDER,
          ...(answer.messageId ? { providerRequestId: answer.messageId } : {}),
          latencyMs: answer.latencyMs,
        },
      },
    };
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// Declared (non-index-signature) shape for the untrusted answer -- same
// defensive-parsing discipline as `anthropic-extraction.ts`'s own.
interface RawOcrAnswer {
  readonly text?: unknown;
  readonly reviewIssues?: unknown;
}
