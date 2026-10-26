import type {
  AiOcrCacheKeyComponents,
  AiOcrContentType,
  AiOcrInput,
  AiOcrOutcome,
  AiOcrPort,
  OcrReviewIssueCode,
} from '@visastack/services';
import { withTimeout } from './timeout';

/**
 * OpenAI Responses API OCR adapter (Part 8 §9: "configured evaluated vision
 * model"). Structurally parallel to `OpenAiExtractionAdapter` -- same
 * Responses API endpoint, same `json_schema`/`strict` structured-output
 * mechanism, same timeout/error-classification shape -- but sends an actual
 * image content part instead of deterministically-extracted text, since OCR
 * has no text to extract from in the first place. This is a deliberate,
 * explicit reversal of `OpenAiExtractionAdapter`'s own "never send raw file
 * bytes" privacy-minimization discipline (see `packages/services/src/ocr.ts`'s
 * own doc comment) -- image bytes are sent as a base64 data URI, the
 * Responses API's own documented multimodal input mechanism, never as a
 * publicly-fetchable URL.
 */

const DEFAULT_MODEL = 'gpt-5.6-terra';
const DEFAULT_PROMPT_VERSION = '2026-09-28-v1';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
/** Part 8 §11's named default request timeout, matching `OpenAiExtractionAdapter`'s own. */
const DEFAULT_TIMEOUT_MS = 60_000;
const PROVIDER = 'openai';

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

const OCR_RESULT_SCHEMA = {
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

export interface OpenAiOcrAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Sent as the `OpenAI-Project` header for a project-scoped API key. */
  readonly projectId?: string;
  /** Whether OpenAI may retain this request/response server-side; defaults to `false` (privacy minimization), matching `OpenAiExtractionAdapter`'s own default. */
  readonly storeResponses?: boolean;
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class OpenAiOcrAdapter implements AiOcrPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly projectId: string | undefined;
  private readonly storeResponses: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiOcrAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.projectId = options.projectId;
    this.storeResponses = options.storeResponses ?? false;
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
        this.fetchImpl(RESPONSES_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            ...(this.projectId ? { 'OpenAI-Project': this.projectId } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            store: this.storeResponses,
            input: [
              { role: 'developer', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: 'Transcribe this document image.' },
                  {
                    type: 'input_image',
                    image_url: toDataUri(input.contentType, input.imageBytes),
                  },
                ],
              },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'ocr_result',
                schema: OCR_RESULT_SCHEMA,
                strict: true,
              },
            },
          }),
        }),
        this.timeoutMs,
        'OpenAI Responses API call',
      );
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const timedOut = error instanceof Error && error.message.includes('timed out after');
      return {
        ok: false,
        code: timedOut ? 'timeout' : 'upstream_error',
        message: error instanceof Error ? error.message : 'network error calling OpenAI',
        provider: PROVIDER,
        latencyMs,
      };
    }
    const latencyMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'auth_failed',
        message: `OpenAI rejected the configured API key (status ${response.status})`,
        provider: PROVIDER,
        latencyMs,
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        code: 'rate_limited',
        message: 'OpenAI rate limit exceeded',
        provider: PROVIDER,
        latencyMs,
      };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        code: 'upstream_error',
        message: `OpenAI responded ${response.status}: ${body.slice(0, 500)}`,
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
        message: 'OpenAI response was not valid JSON',
        provider: PROVIDER,
        latencyMs,
      };
    }

    const parsed = parseResponsesPayload(payload);
    if (parsed.kind === 'invalid') {
      return {
        ok: false,
        code: 'invalid_response',
        message: 'OpenAI response had an unexpected shape',
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
        message: 'OpenAI response was truncated before completing (max_output_tokens reached)',
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
          costUnits: parsed.totalTokens,
          inputUnits: parsed.inputTokens,
          outputUnits: parsed.outputTokens,
          modelVersion: this.model,
          promptVersion: this.promptVersion,
          provider: PROVIDER,
          ...(parsed.responseId ? { providerRequestId: parsed.responseId } : {}),
          latencyMs,
        },
      },
    };
  }
}

function toDataUri(contentType: AiOcrContentType, bytes: Uint8Array): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function toReviewIssue(value: string): OcrReviewIssueCode | undefined {
  return (REVIEW_ISSUE_CODES as readonly string[]).includes(value)
    ? (value as OcrReviewIssueCode)
    : undefined;
}

// Declared (non-index-signature) shapes for the untrusted response payload --
// same defensive-parsing discipline as `openai-extraction.ts`'s own.
interface RawResponsesPayload {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly output_text?: unknown;
  readonly output?: unknown;
  readonly usage?: unknown;
}
interface RawOutputItem {
  readonly content?: unknown;
}
interface RawContentPart {
  readonly text?: unknown;
  readonly refusal?: unknown;
}
interface RawUsage {
  readonly total_tokens?: unknown;
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
}
interface RawBody {
  readonly text?: unknown;
  readonly reviewIssues?: unknown;
}

type ParsedResponsesPayload =
  | {
      readonly kind: 'result';
      readonly text: string;
      readonly reviewIssues: readonly OcrReviewIssueCode[];
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly responseId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

function parseResponsesPayload(payload: unknown): ParsedResponsesPayload {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawResponsesPayload;

  if (record.status === 'incomplete') return { kind: 'truncated' };

  const refusal = extractRefusal(record);
  if (refusal !== undefined) return { kind: 'refusal', message: refusal };

  const outputText = extractOutputText(record);
  if (outputText === undefined) return { kind: 'invalid' };

  let body: unknown;
  try {
    body = JSON.parse(outputText);
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

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const totalTokens = typeof rawUsage?.total_tokens === 'number' ? rawUsage.total_tokens : 0;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;

  return {
    kind: 'result',
    text: rawBody.text,
    reviewIssues,
    totalTokens,
    inputTokens,
    outputTokens,
    ...(typeof record.id === 'string' ? { responseId: record.id } : {}),
  };
}

function extractOutputText(record: RawResponsesPayload): string | undefined {
  if (typeof record.output_text === 'string') return record.output_text;
  const output = record.output;
  if (!Array.isArray(output)) return undefined;
  for (const item of output as readonly RawOutputItem[]) {
    if (typeof item !== 'object' || item === null) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as readonly RawContentPart[]) {
      if (typeof part === 'object' && part !== null && typeof part.text === 'string') {
        return part.text;
      }
    }
  }
  return undefined;
}

function extractRefusal(record: RawResponsesPayload): string | undefined {
  const output = record.output;
  if (!Array.isArray(output)) return undefined;
  for (const item of output as readonly RawOutputItem[]) {
    if (typeof item !== 'object' || item === null) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as readonly RawContentPart[]) {
      if (typeof part === 'object' && part !== null && typeof part.refusal === 'string') {
        return part.refusal;
      }
    }
  }
  return undefined;
}
