import type {
  AiOcrCacheKeyComponents,
  AiOcrInput,
  AiOcrOutcome,
  AiOcrPort,
  OcrReviewIssueCode,
} from '@visastack/services';
import { withTimeout } from './timeout';

/**
 * Google Gemini `generateContent` OCR adapter (Part 8 §9: "configured
 * evaluated vision model"), the last of the three directive-named OCR
 * providers. Structurally parallel to `GeminiExtractionAdapter` -- same
 * endpoint, same `x-goog-api-key` header, same `responseMimeType`/
 * `responseSchema` structured-output mechanism -- but adds an inline image
 * part to the request instead of sending only text, since OCR has no
 * deterministically-extracted text to send in the first place.
 *
 * Provider notes (Part 8 §3's own required record), verified via web search
 * of Google's own documentation/ecosystem sources at implementation time
 * (2026-09-28) -- `ai.google.dev` is blocked by this sandbox's egress
 * policy, the identical limitation `GeminiExtractionAdapter`'s own doc
 * comment already records, so this is the same materially weaker
 * verification that adapter itself flags, not a live fetch:
 * - Docs: https://ai.google.dev/gemini-api/docs/image-understanding.
 * - Inline image data is a `part` alongside the text part:
 *   `{inlineData: {mimeType, data}}` -- camelCase, matching the proto-JSON
 *   field names `GeminiExtractionAdapter`'s own request body already uses
 *   consistently throughout (`generationConfig`, `responseMimeType`,
 *   `systemInstruction`); some indexed examples show snake_case
 *   (`inline_data`/`mime_type`), which protobuf-JSON deserialization
 *   commonly also accepts as an input alias, but camelCase is the
 *   documented, canonical field name and was chosen for consistency with
 *   the rest of this file's own already-integrated style.
 * - This coexists in the same request as `responseMimeType`/
 *   `responseSchema` structured output exactly the way the text-only
 *   adapter already uses them -- vision does not change the
 *   structured-output mechanism.
 * - `storeResponses`/`reasoningEffort` are accepted-but-no-op, the identical
 *   documented limitation `GeminiExtractionAdapter` already records.
 * - Known limitation carried over unchanged from the text adapter: an
 *   invalid API key surfaces as HTTP 400 with `error.message` containing
 *   "API key not valid", handled the same dedicated way.
 */

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_PROMPT_VERSION = '2026-09-28-v1';
const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Part 8 §11's named default request timeout, matching every other adapter's own. */
const DEFAULT_TIMEOUT_MS = 60_000;
const PROVIDER = 'gemini';

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
- Never invent text that is not actually visible in the image.`;

// Deliberately no `nullable: true` anywhere, the same known limitation
// `GeminiExtractionAdapter`'s own doc comment records for its schema.
const OCR_RESPONSE_SCHEMA = {
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

export interface GeminiOcrAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Accepted for interface-shape parity with the other adapters; currently a no-op (see class doc comment). */
  readonly storeResponses?: boolean;
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class GeminiOcrAdapter implements AiOcrPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiOcrAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
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
        this.fetchImpl(`${API_BASE_URL}/${this.model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [
              {
                role: 'user',
                parts: [
                  { text: 'Transcribe this document image.' },
                  {
                    inlineData: { mimeType: input.contentType, data: toBase64(input.imageBytes) },
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: OCR_RESPONSE_SCHEMA,
            },
          }),
        }),
        this.timeoutMs,
        'Gemini generateContent API call',
      );
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const timedOut = error instanceof Error && error.message.includes('timed out after');
      return {
        ok: false,
        code: timedOut ? 'timeout' : 'upstream_error',
        message: error instanceof Error ? error.message : 'network error calling Gemini',
        provider: PROVIDER,
        latencyMs,
      };
    }
    const latencyMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'auth_failed',
        message: `Gemini rejected the configured API key (status ${response.status})`,
        provider: PROVIDER,
        latencyMs,
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        code: 'rate_limited',
        message: 'Gemini rate limit exceeded',
        provider: PROVIDER,
        latencyMs,
      };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 400 && body.includes('API key not valid')) {
        return {
          ok: false,
          code: 'auth_failed',
          message: 'Gemini rejected the configured API key (status 400: API key not valid)',
          provider: PROVIDER,
          latencyMs,
        };
      }
      return {
        ok: false,
        code: 'upstream_error',
        message: `Gemini responded ${response.status}: ${body.slice(0, 500)}`,
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
        message: 'Gemini response was not valid JSON',
        provider: PROVIDER,
        latencyMs,
      };
    }

    const parsed = parseGenerateContentPayload(payload);
    if (parsed.kind === 'invalid') {
      return {
        ok: false,
        code: 'invalid_response',
        message: 'Gemini response had an unexpected shape',
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
        message: 'Gemini response was truncated before completing (MAX_TOKENS reached)',
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
// same defensive-parsing discipline as `gemini-extraction.ts`'s own.
interface RawGenerateContentPayload {
  readonly candidates?: unknown;
  readonly promptFeedback?: unknown;
  readonly usageMetadata?: unknown;
}
interface RawCandidate {
  readonly content?: unknown;
  readonly finishReason?: unknown;
}
interface RawContent {
  readonly parts?: unknown;
}
interface RawPart {
  readonly text?: unknown;
}
interface RawPromptFeedback {
  readonly blockReason?: unknown;
}
interface RawUsageMetadata {
  readonly promptTokenCount?: unknown;
  readonly candidatesTokenCount?: unknown;
}
interface RawBody {
  readonly text?: unknown;
  readonly reviewIssues?: unknown;
}

type ParsedGenerateContentPayload =
  | {
      readonly kind: 'result';
      readonly text: string;
      readonly reviewIssues: readonly OcrReviewIssueCode[];
      readonly inputTokens: number;
      readonly outputTokens: number;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Finish reasons that mean the model completed normally; anything else on a present candidate is treated as a content-related refusal, never silently as empty text. */
const NORMAL_FINISH_REASONS = new Set(['STOP', 'FINISH_REASON_UNSPECIFIED']);

function parseGenerateContentPayload(payload: unknown): ParsedGenerateContentPayload {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawGenerateContentPayload;

  const candidates = Array.isArray(record.candidates)
    ? (record.candidates as RawCandidate[])
    : undefined;
  const candidate = candidates?.[0];

  if (!candidate) {
    const feedback =
      typeof record.promptFeedback === 'object' && record.promptFeedback !== null
        ? (record.promptFeedback as RawPromptFeedback)
        : undefined;
    if (typeof feedback?.blockReason === 'string') {
      return { kind: 'refusal', message: `Gemini blocked the prompt: ${feedback.blockReason}` };
    }
    return { kind: 'invalid' };
  }

  if (candidate.finishReason === 'MAX_TOKENS') return { kind: 'truncated' };

  const finishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason : 'STOP';
  if (!NORMAL_FINISH_REASONS.has(finishReason)) {
    return { kind: 'refusal', message: `Gemini declined to complete normally: ${finishReason}` };
  }

  const content =
    typeof candidate.content === 'object' && candidate.content !== null
      ? (candidate.content as RawContent)
      : undefined;
  const parts = Array.isArray(content?.parts) ? (content.parts as RawPart[]) : undefined;
  const text = parts?.find((part) => typeof part.text === 'string')?.text;
  if (typeof text !== 'string') return { kind: 'invalid' };

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof body !== 'object' || body === null) return { kind: 'invalid' };
  const rawBody = body as RawBody;
  if (typeof rawBody.text !== 'string') return { kind: 'invalid' };
  if (!Array.isArray(rawBody.reviewIssues)) return { kind: 'invalid' };

  const reviewIssues = rawBody.reviewIssues
    .filter((v): v is string => typeof v === 'string')
    .map(toReviewIssue)
    .filter((v): v is OcrReviewIssueCode => v !== undefined);

  const usage =
    typeof record.usageMetadata === 'object' && record.usageMetadata !== null
      ? (record.usageMetadata as RawUsageMetadata)
      : undefined;
  const inputTokens = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
  const outputTokens =
    typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;

  return { kind: 'result', text: rawBody.text, reviewIssues, inputTokens, outputTokens };
}
