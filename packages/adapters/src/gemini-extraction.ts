import { PROPOSAL_TYPES, type ProposalType } from '@visastack/core';
import type {
  AiCacheKeyComponents,
  AiClassifyInput,
  AiClassifyOutcome,
  AiClassifyPort,
  AiExplainInput,
  AiExplainOutcome,
  AiExplainPort,
  AiExtractionInput,
  AiExtractionOutcome,
  AiExtractionPort,
  AiInconsistencyFlag,
  AiInconsistencyInput,
  AiInconsistencyOutcome,
  AiInconsistencyPort,
  FieldProposal,
} from '@visastack/services';
import { withTimeout } from './timeout';

/**
 * Google Gemini API adapter (Part 8 §3: "ship production adapters for
 * ... Google Gemini API"), the last of the three directive-named providers.
 * Sends ONLY the already deterministically-extracted, size-capped text
 * (packages/services/src/extraction.ts) plus the canonical field-key
 * registry -- never the original file bytes -- matching
 * `OpenAiExtractionAdapter`/`AnthropicExtractionAdapter`'s identical
 * privacy-minimization discipline.
 *
 * Structured output via Gemini's own native `responseMimeType: "application/
 * json"` + `responseSchema` (`generationConfig`) -- closer to OpenAI's
 * strict-schema mechanism than Anthropic's forced-tool-use workaround, since
 * Gemini has a real JSON-mode response format. The prompt instructs it to
 * ground every value in a verbatim quoted snippet and to emit UNMAPPED/
 * UNCERTAIN rather than invent a field key or an unsupported value -- the
 * service layer (packages/services/src/ai.ts) still treats every proposal as
 * advisory: nothing here writes to the profile directly.
 *
 * Provider notes (Part 8 §3's own required record), verified against
 * current Google documentation/ecosystem sources at implementation time
 * (2026-09-28) rather than assumed from the other two adapters' shape:
 * - Docs: https://ai.google.dev/api/generate-content (the domain itself is
 *   blocked by this sandbox's own egress policy -- verified instead via
 *   web search of its indexed content and current community/SDK sources,
 *   not a live fetch of the page itself; this is a materially weaker
 *   verification than the OpenAI/Anthropic adapters got and should be
 *   confirmed against a live fetch of the official docs before this adapter
 *   is treated as fully production-hardened).
 * - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/
 *   {model}:generateContent`, authenticated via the `x-goog-api-key` header
 *   (not a bearer token, and not the API key as a URL query parameter, which
 *   Google's own docs also support but which would leak the key into
 *   server/proxy access logs).
 * - Structured-output mechanism: `generationConfig.responseMimeType:
 *   "application/json"` + `responseSchema` (a real subset of the OpenAPI 3.0
 *   Schema object, not full JSON Schema).
 * - Known limitation: `responseSchema`'s own `nullable: true` keyword is
 *   documented but has real-world reports of causing HTTP 400s in practice
 *   -- this adapter deliberately never sets it, instead leaving
 *   `fieldKey`/`value`/`rationale`/`evidenceSnippet` out of the schema's
 *   `required` array so the model may omit them, and parses the response
 *   defensively regardless of whether a given run omits, nulls, or strings
 *   each of those fields.
 * - Known limitation: unlike OpenAI's/Anthropic's clean 401/403 auth-failure
 *   codes, an invalid Gemini API key is reported as HTTP 400 with
 *   `error.message` containing "API key not valid" -- handled as a
 *   dedicated `auth_failed` case distinguished from an ordinary malformed-
 *   request 400, which stays `upstream_error`.
 * - Known limitation: `reasoningEffort` is accepted but currently unused --
 *   Gemini has no "low/medium/high" dial equivalent (its own "thinking"
 *   models take a token budget via `generationConfig.thinkingConfig`, a
 *   different mechanism, deliberately not mapped in this first version to
 *   keep the core extraction path simple and reliable, the same reasoning
 *   `AnthropicExtractionAdapter` already documents for its own extended
 *   thinking).
 * - Retention/data-control: no per-call retention toggle is exposed on this
 *   endpoint either -- `storeResponses` is accepted for interface-shape
 *   parity but is currently a no-op, the same shape as the Anthropic
 *   adapter's identical limitation.
 * - Vision/file behavior: not used by this adapter -- only deterministic
 *   plain text is ever sent, matching the other two adapters' own scope.
 */

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_PROMPT_VERSION = '2026-09-28-v1';
const SCHEMA_VERSION = 'field_proposals_v1';
/** Part 8 AI-01 item 2 -- tracked independently of extraction's own prompt/schema version, matching the other two adapters' identical separation. */
const CLASSIFY_PROMPT_VERSION = '2026-09-29-v1';
const CLASSIFY_SCHEMA_VERSION = 'document_classification_v1';
/** Part 8 AI-01 item 5 -- tracked independently of extraction's/classification's own prompt/schema version. */
const EXPLAIN_PROMPT_VERSION = '2026-09-29-v1';
const EXPLAIN_SCHEMA_VERSION = 'readiness_gap_explanation_v1';
/** Part 8 AI-01 item 4 -- tracked independently of every other task's own prompt/schema version. */
const INCONSISTENCY_PROMPT_VERSION = '2026-09-29-v1';
const INCONSISTENCY_SCHEMA_VERSION = 'inconsistency_flags_v1';
/** Official host, a plain literal never influenced by any admin/config input (Part 8 §7: "built-in adapters: official provider host locked"). */
const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Part 8 §11's named default request timeout. */
const DEFAULT_TIMEOUT_MS = 60_000;
const PROVIDER = 'gemini';

const SYSTEM_PROMPT = `You extract structured field proposals from a single immigration-applicant document for a human to review and approve. You are NOT authorized to write anything directly -- every proposal you make will be reviewed by a person before it can change any record.

Rules:
- Only propose values for field keys in the provided allowed list. If a value in the text doesn't correspond to any allowed field key, or you are unsure, set "type" to "UNMAPPED" or "UNCERTAIN" and leave "fieldKey" unset -- never invent a field key.
- Never invent a value that isn't actually present in the given text. Every proposal's "evidenceSnippet" must be an exact, verbatim substring copied from the document text that supports the value.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the value is correct, not a fixed number.
- If the document contains no extractable fields at all, return an empty "proposals" array.`;

/** Part 8 AI-01 item 2: a deterministic rules-based classifier already handles the confident cases; this prompt only ever runs on a genuine gap it left. */
const CLASSIFY_SYSTEM_PROMPT = `You suggest a document type for a single immigration-applicant document that a deterministic rules-based classifier could not confidently resolve. A human will review your suggestion before it is ever recorded anywhere -- you are NOT authorized to write anything directly.

Rules:
- Only suggest a type from the provided allowed list. If you are not reasonably confident, or the document does not genuinely match any allowed type, omit "suggestedType" entirely -- never guess.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the suggested type is correct, not a fixed number.
- "rationale" should briefly explain what in the text supports your suggestion (or why you could not decide, if you omitted "suggestedType").`;

// Deliberately no `nullable: true` (see class doc comment's own "known
// limitation") -- `suggestedType`/`rationale` are simply left out of
// `required`, letting the model omit them, exactly like the extraction
// schema's own fieldKey/value/rationale/evidenceSnippet above.
const CLASSIFY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestedType: { type: 'string' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['confidence'],
} as const;

/** Part 8 AI-01 item 5: explains an ALREADY-DETERMINED gap -- never a second opinion on whether it applies, which stays entirely deterministic (`computeReadiness`, packages/services/src/missions.ts). */
const EXPLAIN_SYSTEM_PROMPT = `You explain, in plain, empathetic language, why a single already-determined visa-application requirement gap matters. The determination itself was already made deterministically before you were called -- you are NOT deciding whether the requirement is met, only explaining what it means in plain words, grounded in the citation you are given.

Rules:
- Write 2-4 sentences, plain language, addressed directly to the applicant ("you").
- Never invent facts about the applicant's own situation -- you were given none.
- Never state or imply a probability of approval or rejection.
- Ground every claim in the given citation text; do not invent legal consequences beyond what it implies.`;

const EXPLAIN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
  },
  required: ['explanation'],
} as const;

/** Part 8 AI-01 item 4: compares a document against the applicant's OWN already-confirmed profile facts -- never a second document, never a re-determination of correctness. */
const INCONSISTENCY_SYSTEM_PROMPT = `You compare a single immigration-applicant document's text against that same applicant's own already-confirmed profile facts, looking for genuine possible contradictions a human should review. You are NOT deciding which side (the document or the profile) is correct -- only flagging where they seem to disagree.

Rules:
- Only flag a GENUINE apparent contradiction (e.g. a name, date, or number that conflicts) -- never a mere absence, omission, or a fact the profile simply doesn't cover.
- Never invent a profile fact or a document detail that isn't actually given to you.
- "confidence" is your genuine calibrated probability (0.0-1.0) that this is a real contradiction, not a fixed number.
- If you find no genuine contradictions, return an empty "flags" array -- this is the common, correct outcome.`;

// Deliberately no `nullable: true` (see class doc comment's own "known
// limitation") -- "rationale" is simply left out of `required`, letting the
// model omit it, exactly like the other two schemas above.
const INCONSISTENCY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['description', 'confidence'],
      },
    },
  },
  required: ['flags'],
} as const;

interface JsonProposal {
  readonly type: string;
  readonly fieldKey?: string | null;
  readonly value?: string | null;
  readonly confidence: number;
  readonly rationale?: string | null;
  readonly evidenceSnippet?: string | null;
}

// Deliberately no `nullable: true` anywhere (see class doc comment's own
// "known limitation") -- the four optional fields are simply left out of
// `required`, letting the model omit them rather than forcing a null.
const PROPOSAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...PROPOSAL_TYPES] },
          fieldKey: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
          evidenceSnippet: { type: 'string' },
        },
        required: ['type', 'confidence'],
      },
    },
  },
  required: ['proposals'],
} as const;

export interface GeminiExtractionAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Accepted for interface-shape parity with the other adapters; currently unused (see class doc comment -- Gemini has no equivalent effort dial). */
  readonly reasoningEffort?: string;
  /** Accepted for interface-shape parity; currently a no-op (see class doc comment -- no per-call retention toggle exists on this endpoint). */
  readonly storeResponses?: boolean;
  /** Part 8 §11's default is 60s; overridable (tests use a short value to prove the timeout path without a real 60s wait). */
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class GeminiExtractionAdapter
  implements AiExtractionPort, AiClassifyPort, AiExplainPort, AiInconsistencyPort
{
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiExtractionAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  cacheKeyComponents(): AiCacheKeyComponents {
    return {
      provider: PROVIDER,
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
                  {
                    text: `Allowed field keys (JSON array - use ONLY these, or UNMAPPED/UNCERTAIN): ${JSON.stringify(input.allowedFieldKeys)}\n\nDocument text:\n"""\n${input.text}\n"""`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: PROPOSAL_RESPONSE_SCHEMA,
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
      // Unlike OpenAI/Anthropic's clean 401/403, an invalid Gemini API key
      // is reported as a plain HTTP 400 -- distinguished from an ordinary
      // malformed-request 400 (which stays upstream_error) only by this
      // specific, documented message text.
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
          latencyMs,
        },
      },
    };
  }

  classifyCacheKeyComponents(): AiCacheKeyComponents {
    return {
      provider: PROVIDER,
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
        this.fetchImpl(`${API_BASE_URL}/${this.model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: CLASSIFY_SYSTEM_PROMPT }] },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Allowed document types (JSON array - use ONLY these, or omit "suggestedType"): ${JSON.stringify(input.allowedTypes)}\n\nDocument text:\n"""\n${input.text}\n"""`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: CLASSIFY_RESPONSE_SCHEMA,
            },
          }),
        }),
        this.timeoutMs,
        'Gemini generateContent API call (classification)',
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

    const parsed = parseClassificationGenerateContentPayload(payload);
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
          latencyMs,
        },
      },
    };
  }

  explainCacheKeyComponents(): AiCacheKeyComponents {
    return {
      provider: PROVIDER,
      model: this.model,
      promptVersion: EXPLAIN_PROMPT_VERSION,
      schemaVersion: EXPLAIN_SCHEMA_VERSION,
    };
  }

  async explain(input: AiExplainInput): Promise<AiExplainOutcome> {
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
            systemInstruction: { parts: [{ text: EXPLAIN_SYSTEM_PROMPT }] },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Requirement kind: ${input.requirementKind}\nRequirement: ${input.requirementKey}\nStatus: ${input.state === 'CRITICAL_GAP' ? 'required and not yet met' : 'optional and not yet met'}\nCitation: """\n${input.citation}\n"""`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: EXPLAIN_RESPONSE_SCHEMA,
            },
          }),
        }),
        this.timeoutMs,
        'Gemini generateContent API call (explanation)',
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

    const parsed = parseExplanationGenerateContentPayload(payload);
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
        explanation: parsed.explanation,
        usage: {
          costUnits: parsed.totalTokens,
          inputUnits: parsed.inputTokens,
          outputUnits: parsed.outputTokens,
          cachedUnits: parsed.cachedTokens,
          modelVersion: this.model,
          promptVersion: EXPLAIN_PROMPT_VERSION,
          schemaVersion: EXPLAIN_SCHEMA_VERSION,
          provider: PROVIDER,
          latencyMs,
        },
      },
    };
  }

  inconsistencyCacheKeyComponents(): AiCacheKeyComponents {
    return {
      provider: PROVIDER,
      model: this.model,
      promptVersion: INCONSISTENCY_PROMPT_VERSION,
      schemaVersion: INCONSISTENCY_SCHEMA_VERSION,
    };
  }

  async checkConsistency(input: AiInconsistencyInput): Promise<AiInconsistencyOutcome> {
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
            systemInstruction: { parts: [{ text: INCONSISTENCY_SYSTEM_PROMPT }] },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Applicant's own confirmed profile facts (JSON array of fieldKey/value pairs): ${JSON.stringify(input.profileFacts)}\n\nDocument text:\n"""\n${input.text}\n"""`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: INCONSISTENCY_RESPONSE_SCHEMA,
            },
          }),
        }),
        this.timeoutMs,
        'Gemini generateContent API call (inconsistency check)',
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

    const parsed = parseInconsistencyGenerateContentPayload(payload);
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

    const flags: AiInconsistencyFlag[] = parsed.flags.map((f) => ({
      description: f.description,
      confidence: f.confidence,
      ...(f.rationale ? { rationale: f.rationale } : {}),
    }));

    return {
      ok: true,
      result: {
        flags,
        usage: {
          costUnits: parsed.totalTokens,
          inputUnits: parsed.inputTokens,
          outputUnits: parsed.outputTokens,
          cachedUnits: parsed.cachedTokens,
          modelVersion: this.model,
          promptVersion: INCONSISTENCY_PROMPT_VERSION,
          schemaVersion: INCONSISTENCY_SCHEMA_VERSION,
          provider: PROVIDER,
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
  readonly totalTokenCount?: unknown;
  readonly cachedContentTokenCount?: unknown;
}
interface RawBody {
  readonly proposals?: unknown;
}
interface RawProposal {
  readonly type?: unknown;
  readonly confidence?: unknown;
}

type ParsedGenerateContentPayload =
  | {
      readonly kind: 'proposals';
      readonly proposals: JsonProposal[];
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Finish reasons that mean the model completed normally; anything else on a present candidate is treated as a content-related refusal, never silently as zero proposals. */
const NORMAL_FINISH_REASONS = new Set(['STOP', 'FINISH_REASON_UNSPECIFIED']);

function parseGenerateContentPayload(payload: unknown): ParsedGenerateContentPayload {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawGenerateContentPayload;

  const candidates = Array.isArray(record.candidates)
    ? (record.candidates as RawCandidate[])
    : undefined;
  const candidate = candidates?.[0];

  // The whole prompt can be blocked before any candidate is even generated
  // (`promptFeedback.blockReason`, e.g. a safety filter) -- checked first
  // since that case has no candidate to inspect at all.
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

  // A response cut off before completing (`MAX_TOKENS` reached) may still
  // contain a partial JSON fragment that happens to look plausible -- but it
  // was never actually finished, so it must never be trusted as a complete
  // set of proposals (Part 8 §4's own named "truncation" failure mode, the
  // same discipline as the other two adapters' own truncation handling).
  if (candidate.finishReason === 'MAX_TOKENS') return { kind: 'truncated' };

  // Any other non-normal finish reason (SAFETY, RECITATION,
  // PROHIBITED_CONTENT, and any future content-filter reason this adapter
  // doesn't yet name individually) means the model didn't complete normally
  // for a content-related reason -- surfaced as a positive `refused` signal,
  // never silently treated as zero proposals (Part 8 §4's own named
  // "refusal" failure mode).
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
  const proposalsRaw = (body as RawBody).proposals;
  if (!Array.isArray(proposalsRaw)) return { kind: 'invalid' };

  const proposals = proposalsRaw.filter((p): p is JsonProposal => {
    if (typeof p !== 'object' || p === null) return false;
    const candidateProposal = p as RawProposal;
    return (
      typeof candidateProposal.type === 'string' && typeof candidateProposal.confidence === 'number'
    );
  });

  const usage =
    typeof record.usageMetadata === 'object' && record.usageMetadata !== null
      ? (record.usageMetadata as RawUsageMetadata)
      : undefined;
  const inputTokens = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
  const outputTokens =
    typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;
  const totalTokens =
    typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : inputTokens + outputTokens;
  const cachedTokens =
    typeof usage?.cachedContentTokenCount === 'number' ? usage.cachedContentTokenCount : 0;

  return { kind: 'proposals', proposals, totalTokens, inputTokens, outputTokens, cachedTokens };
}

interface RawClassificationBody {
  readonly suggestedType?: unknown;
  readonly confidence?: unknown;
  readonly rationale?: unknown;
}

type ParsedClassificationGenerateContentPayload =
  | {
      readonly kind: 'classification';
      readonly suggestedType: string | null;
      readonly confidence: number;
      readonly rationale?: string;
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Structurally mirrors `parseGenerateContentPayload` above -- same candidate/finish-reason/block-reason detection, a differently-shaped JSON body. */
function parseClassificationGenerateContentPayload(
  payload: unknown,
): ParsedClassificationGenerateContentPayload {
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
  const candidateBody = body as RawClassificationBody;
  if (typeof candidateBody.confidence !== 'number') return { kind: 'invalid' };
  const suggestedType =
    typeof candidateBody.suggestedType === 'string' ? candidateBody.suggestedType : null;

  const usage =
    typeof record.usageMetadata === 'object' && record.usageMetadata !== null
      ? (record.usageMetadata as RawUsageMetadata)
      : undefined;
  const inputTokens = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
  const outputTokens =
    typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;
  const totalTokens =
    typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : inputTokens + outputTokens;
  const cachedTokens =
    typeof usage?.cachedContentTokenCount === 'number' ? usage.cachedContentTokenCount : 0;

  return {
    kind: 'classification',
    suggestedType,
    confidence: candidateBody.confidence,
    ...(typeof candidateBody.rationale === 'string' ? { rationale: candidateBody.rationale } : {}),
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
  };
}

interface RawExplanationBody {
  readonly explanation?: unknown;
}

type ParsedExplanationGenerateContentPayload =
  | {
      readonly kind: 'explanation';
      readonly explanation: string;
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Structurally mirrors `parseClassificationGenerateContentPayload` above -- same candidate/finish-reason/block-reason detection, a differently-shaped JSON body. */
function parseExplanationGenerateContentPayload(
  payload: unknown,
): ParsedExplanationGenerateContentPayload {
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
  const candidateBody = body as RawExplanationBody;
  if (typeof candidateBody.explanation !== 'string') return { kind: 'invalid' };

  const usage =
    typeof record.usageMetadata === 'object' && record.usageMetadata !== null
      ? (record.usageMetadata as RawUsageMetadata)
      : undefined;
  const inputTokens = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
  const outputTokens =
    typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;
  const totalTokens =
    typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : inputTokens + outputTokens;
  const cachedTokens =
    typeof usage?.cachedContentTokenCount === 'number' ? usage.cachedContentTokenCount : 0;

  return {
    kind: 'explanation',
    explanation: candidateBody.explanation,
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
  };
}

interface JsonFlag {
  readonly description: string;
  readonly confidence: number;
  readonly rationale?: string | null;
}

interface RawInconsistencyBody {
  readonly flags?: unknown;
}
interface RawFlag {
  readonly description?: unknown;
  readonly confidence?: unknown;
}

type ParsedInconsistencyGenerateContentPayload =
  | {
      readonly kind: 'flags';
      readonly flags: JsonFlag[];
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Structurally mirrors `parseExplanationGenerateContentPayload` above -- same candidate/finish-reason/block-reason detection, a differently-shaped JSON body. */
function parseInconsistencyGenerateContentPayload(
  payload: unknown,
): ParsedInconsistencyGenerateContentPayload {
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
  const flagsRaw = (body as RawInconsistencyBody).flags;
  if (!Array.isArray(flagsRaw)) return { kind: 'invalid' };

  const flags = flagsRaw.filter((f): f is JsonFlag => {
    if (typeof f !== 'object' || f === null) return false;
    const candidateFlag = f as RawFlag;
    return (
      typeof candidateFlag.description === 'string' && typeof candidateFlag.confidence === 'number'
    );
  });

  const usage =
    typeof record.usageMetadata === 'object' && record.usageMetadata !== null
      ? (record.usageMetadata as RawUsageMetadata)
      : undefined;
  const inputTokens = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
  const outputTokens =
    typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;
  const totalTokens =
    typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : inputTokens + outputTokens;
  const cachedTokens =
    typeof usage?.cachedContentTokenCount === 'number' ? usage.cachedContentTokenCount : 0;

  return { kind: 'flags', flags, totalTokens, inputTokens, outputTokens, cachedTokens };
}
