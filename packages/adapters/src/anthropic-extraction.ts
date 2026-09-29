import { PROPOSAL_TYPES, type ProposalType } from '@visastack/core';
import type {
  AiCacheKeyComponents,
  AiClassifyInput,
  AiClassifyOutcome,
  AiClassifyPort,
  AiExtractionInput,
  AiExtractionOutcome,
  AiExtractionPort,
  FieldProposal,
} from '@visastack/services';
import { withTimeout } from './timeout';

/**
 * Anthropic Messages API adapter (Part 8 §3: "ship production adapters for
 * ... Anthropic Claude API"). Sends ONLY the already deterministically-
 * extracted, size-capped text (packages/services/src/extraction.ts) plus the
 * canonical field-key registry -- never the original file bytes -- matching
 * `OpenAiExtractionAdapter`'s identical privacy-minimization discipline.
 *
 * Structured output via a single FORCED tool call (`tool_choice: {type:
 * "tool", name: ...}`) rather than OpenAI's native `json_schema`/`strict`
 * response-format mechanism, which the Messages API has no equivalent of --
 * Claude's tool-use schema-following is best-effort, not hard-enforced, a
 * real protocol difference recorded here per Part 8 §3 ("known
 * limitations"). The prompt instructs it to ground every value in a verbatim
 * quoted snippet and to emit UNMAPPED/UNCERTAIN rather than invent a field
 * key or an unsupported value -- the service layer
 * (packages/services/src/ai.ts) still treats every proposal as advisory:
 * nothing here writes to the profile directly.
 *
 * Provider notes (Part 8 §3's own required record):
 * - Docs: https://docs.anthropic.com/en/api/messages (checked 2026-09-28).
 * - API version: `2023-06-01` (the `anthropic-version` header) -- the stable
 *   Messages API generation this adapter targets.
 * - Structured-output mechanism: forced tool use (see above), not a native
 *   strict-schema response format.
 * - Vision/file behavior: not used by this adapter -- only deterministic
 *   plain text is ever sent, matching the OpenAI adapter's own scope.
 * - Retention/data-control: unlike OpenAI's per-call `store` flag, the
 *   Messages API has no per-request retention toggle -- `storeResponses` is
 *   accepted on this adapter for interface-shape parity with
 *   `OpenAiExtractionAdapter` but is currently a no-op; retention is
 *   governed by the account's own data processing agreement, outside this
 *   adapter's control.
 * - Known limitation: `reasoningEffort` is likewise accepted but currently
 *   unused -- Claude has no "low/medium/high" dial equivalent to OpenAI's
 *   `reasoning.effort` (its own "extended thinking" is a different
 *   mechanism, a token budget rather than a named effort level, and is
 *   deliberately not wired in this first version to keep the core
 *   extraction path simple and reliable).
 */

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_PROMPT_VERSION = '2026-09-28-v1';
const SCHEMA_VERSION = 'field_proposals_v1';
/** Part 8 AI-01 item 2 -- tracked independently of extraction's own prompt/schema version, matching `OpenAiExtractionAdapter`'s identical separation. */
const CLASSIFY_PROMPT_VERSION = '2026-09-29-v1';
const CLASSIFY_SCHEMA_VERSION = 'document_classification_v1';
const CLASSIFY_TOOL_NAME = 'submit_document_classification';
/** Official host, a plain literal never influenced by any admin/config input (Part 8 §7: "built-in adapters: official provider host locked"). */
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/** Part 8 §11's named default request timeout. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Generous enough for a full proposal array from a single document's worth of fields. */
const DEFAULT_MAX_TOKENS = 4096;
const PROVIDER = 'anthropic';
const TOOL_NAME = 'submit_field_proposals';

const SYSTEM_PROMPT = `You extract structured field proposals from a single immigration-applicant document for a human to review and approve. You are NOT authorized to write anything directly -- every proposal you make will be reviewed by a person before it can change any record.

Rules:
- Only propose values for field keys in the provided allowed list. If a value in the text doesn't correspond to any allowed field key, or you are unsure, set "type" to "UNMAPPED" or "UNCERTAIN" and leave "fieldKey" null -- never invent a field key.
- Never invent a value that isn't actually present in the given text. Every proposal's "evidenceSnippet" must be an exact, verbatim substring copied from the document text that supports the value.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the value is correct, not a fixed number.
- If the document contains no extractable fields at all, call the tool with an empty "proposals" array.
- You must always respond by calling the ${TOOL_NAME} tool -- never with plain text.`;

/** Part 8 AI-01 item 2: a deterministic rules-based classifier already handles the confident cases; this prompt only ever runs on a genuine gap it left. */
const CLASSIFY_SYSTEM_PROMPT = `You suggest a document type for a single immigration-applicant document that a deterministic rules-based classifier could not confidently resolve. A human will review your suggestion before it is ever recorded anywhere -- you are NOT authorized to write anything directly.

Rules:
- Only suggest a type from the provided allowed list. If you are not reasonably confident, or the document does not genuinely match any allowed type, set "suggestedType" to null -- never guess.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the suggested type is correct, not a fixed number.
- "rationale" should briefly explain what in the text supports your suggestion (or why you could not decide, if "suggestedType" is null).
- You must always respond by calling the ${CLASSIFY_TOOL_NAME} tool -- never with plain text.`;

const CLASSIFY_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    suggestedType: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    rationale: { type: ['string', 'null'] },
  },
  required: ['suggestedType', 'confidence', 'rationale'],
} as const;

interface ToolProposal {
  readonly type: string;
  readonly fieldKey: string | null;
  readonly value: string | null;
  readonly confidence: number;
  readonly rationale: string | null;
  readonly evidenceSnippet: string | null;
}

const PROPOSAL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...PROPOSAL_TYPES] },
          fieldKey: { type: ['string', 'null'] },
          value: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          rationale: { type: ['string', 'null'] },
          evidenceSnippet: { type: ['string', 'null'] },
        },
        required: ['type', 'fieldKey', 'value', 'confidence', 'rationale', 'evidenceSnippet'],
      },
    },
  },
  required: ['proposals'],
} as const;

export interface AnthropicExtractionAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Accepted for interface-shape parity with `OpenAiExtractionAdapter`; currently unused (see class doc comment -- Claude has no equivalent effort dial). */
  readonly reasoningEffort?: string;
  /** Accepted for interface-shape parity; currently a no-op (see class doc comment -- no per-call Messages API retention toggle exists). */
  readonly storeResponses?: boolean;
  readonly maxTokens?: number;
  /** Part 8 §11's default is 60s; overridable (tests use a short value to prove the timeout path without a real 60s wait). */
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class AnthropicExtractionAdapter implements AiExtractionPort, AiClassifyPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicExtractionAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  cacheKeyComponents(): AiCacheKeyComponents {
    return {
      model: this.model,
      promptVersion: this.promptVersion,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  async extract(input: AiExtractionInput): Promise<AiExtractionOutcome> {
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
                content: `Allowed field keys (JSON array - use ONLY these, or UNMAPPED/UNCERTAIN): ${JSON.stringify(input.allowedFieldKeys)}\n\nDocument text:\n"""\n${input.text}\n"""`,
              },
            ],
            tools: [
              {
                name: TOOL_NAME,
                description: 'Submit the extracted field proposals for this document.',
                input_schema: PROPOSAL_INPUT_SCHEMA,
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

    const proposals: FieldProposal[] = parsed.proposals.map((p) => ({
      type: toProposalType(p.type),
      ...(p.fieldKey ? { fieldKey: p.fieldKey } : {}),
      ...(p.value ? { value: p.value } : {}),
      confidence: p.confidence,
      ...(p.rationale ? { rationale: p.rationale } : {}),
      ...(p.evidenceSnippet ? { evidenceSnippet: p.evidenceSnippet } : {}),
    }));

    return {
      ok: true,
      result: {
        proposals,
        usage: {
          costUnits: parsed.totalTokens,
          inputUnits: parsed.inputTokens,
          outputUnits: parsed.outputTokens,
          cachedUnits: parsed.cachedTokens,
          modelVersion: this.model,
          promptVersion: this.promptVersion,
          schemaVersion: SCHEMA_VERSION,
          provider: PROVIDER,
          ...(parsed.messageId ? { providerRequestId: parsed.messageId } : {}),
          latencyMs,
        },
      },
    };
  }

  classifyCacheKeyComponents(): AiCacheKeyComponents {
    return {
      model: this.model,
      promptVersion: CLASSIFY_PROMPT_VERSION,
      schemaVersion: CLASSIFY_SCHEMA_VERSION,
    };
  }

  async classify(input: AiClassifyInput): Promise<AiClassifyOutcome> {
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
            system: CLASSIFY_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: `Allowed document types (JSON array - use ONLY these, or null): ${JSON.stringify(input.allowedTypes)}\n\nDocument text:\n"""\n${input.text}\n"""`,
              },
            ],
            tools: [
              {
                name: CLASSIFY_TOOL_NAME,
                description: 'Submit the suggested document type for this document.',
                input_schema: CLASSIFY_INPUT_SCHEMA,
              },
            ],
            tool_choice: { type: 'tool', name: CLASSIFY_TOOL_NAME },
          }),
        }),
        this.timeoutMs,
        'Anthropic Messages API call (classification)',
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

    const parsed = parseClassificationMessagesPayload(payload);
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
        suggestedType: parsed.suggestedType,
        confidence: parsed.confidence,
        ...(parsed.rationale ? { rationale: parsed.rationale } : {}),
        usage: {
          costUnits: parsed.totalTokens,
          inputUnits: parsed.inputTokens,
          outputUnits: parsed.outputTokens,
          cachedUnits: parsed.cachedTokens,
          modelVersion: this.model,
          promptVersion: CLASSIFY_PROMPT_VERSION,
          schemaVersion: CLASSIFY_SCHEMA_VERSION,
          provider: PROVIDER,
          ...(parsed.messageId ? { providerRequestId: parsed.messageId } : {}),
          latencyMs,
        },
      },
    };
  }
}

function toProposalType(value: string): ProposalType {
  return (PROPOSAL_TYPES as readonly string[]).includes(value)
    ? (value as ProposalType)
    : 'UNCERTAIN';
}

// Declared (non-index-signature) shapes for the untrusted response payload,
// so narrowing reads as plain dot-access instead of bracket-indexed casts.
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
  readonly cache_read_input_tokens?: unknown;
}
interface RawToolInput {
  readonly proposals?: unknown;
}
interface RawProposal {
  readonly type?: unknown;
  readonly confidence?: unknown;
}

type ParsedMessagesPayload =
  | {
      readonly kind: 'proposals';
      readonly proposals: ToolProposal[];
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
      readonly messageId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

function parseMessagesPayload(payload: unknown): ParsedMessagesPayload {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawMessagesPayload;

  // A response cut off before completing (`max_tokens` reached) may still
  // contain a partial tool_use block that happens to look plausible -- but
  // it was never actually finished, so it must never be trusted as a
  // complete set of proposals (Part 8 §4's own named "truncation" failure
  // mode, the same discipline as the OpenAI adapter's `status: "incomplete"`).
  if (record.stop_reason === 'max_tokens') return { kind: 'truncated' };

  const content = Array.isArray(record.content) ? (record.content as RawContentBlock[]) : undefined;
  if (!content) return { kind: 'invalid' };

  const toolUse = content.find(
    (block) => typeof block === 'object' && block !== null && block.type === 'tool_use',
  );

  // `tool_choice` forces the model to call the tool; a normal-looking stop
  // (not max_tokens) that nonetheless produced no tool_use block, or an
  // explicit `stop_reason: "refusal"`, both mean the model declined to
  // comply rather than that something is structurally broken -- surfaced as
  // a positive `refused` signal, never silently treated as zero proposals
  // (Part 8 §4's own named "refusal" failure mode).
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
  const proposalsRaw = (toolInput as RawToolInput).proposals;
  if (!Array.isArray(proposalsRaw)) return { kind: 'invalid' };

  const proposals = proposalsRaw.filter((p): p is ToolProposal => {
    if (typeof p !== 'object' || p === null) return false;
    const candidate = p as RawProposal;
    return typeof candidate.type === 'string' && typeof candidate.confidence === 'number';
  });

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;
  const cachedTokens =
    typeof rawUsage?.cache_read_input_tokens === 'number' ? rawUsage.cache_read_input_tokens : 0;

  return {
    kind: 'proposals',
    proposals,
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    ...(typeof record.id === 'string' ? { messageId: record.id } : {}),
  };
}

interface RawClassificationToolInput {
  readonly suggestedType?: unknown;
  readonly confidence?: unknown;
  readonly rationale?: unknown;
}

type ParsedClassificationMessagesPayload =
  | {
      readonly kind: 'classification';
      readonly suggestedType: string | null;
      readonly confidence: number;
      readonly rationale?: string;
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
      readonly messageId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Structurally mirrors `parseMessagesPayload` above -- same tool-use/refusal/truncation detection, a differently-shaped tool input. */
function parseClassificationMessagesPayload(payload: unknown): ParsedClassificationMessagesPayload {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawMessagesPayload;

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
  const candidate = toolInput as RawClassificationToolInput;
  if (typeof candidate.confidence !== 'number') return { kind: 'invalid' };
  const suggestedType =
    typeof candidate.suggestedType === 'string' ? candidate.suggestedType : null;

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;
  const cachedTokens =
    typeof rawUsage?.cache_read_input_tokens === 'number' ? rawUsage.cache_read_input_tokens : 0;

  return {
    kind: 'classification',
    suggestedType,
    confidence: candidate.confidence,
    ...(typeof candidate.rationale === 'string' ? { rationale: candidate.rationale } : {}),
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    ...(typeof record.id === 'string' ? { messageId: record.id } : {}),
  };
}
