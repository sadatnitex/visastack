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
 * OpenAI Responses API adapter (master directive §8/§26 item 4, Release D):
 * the only concrete `AiExtractionPort` implementation. Sends ONLY the
 * already deterministically-extracted, size-capped text
 * (packages/services/src/extraction.ts) plus the canonical field-key
 * registry — never the original file bytes — for privacy minimization.
 *
 * Structured-output constrained (`json_schema`, `strict`) so the model can
 * only emit the exact proposal shape the service layer expects. The prompt
 * instructs it to ground every value in a verbatim quoted snippet and to
 * emit UNMAPPED/UNCERTAIN rather than invent a field key or an unsupported
 * value — the service layer (packages/services/src/ai.ts) still treats every
 * proposal as advisory: nothing here writes to the profile directly.
 */

const DEFAULT_MODEL = 'gpt-5.6-terra';
const DEFAULT_PROMPT_VERSION = '2026-07-29-v1';
/** Master directive §7 "PR 9": "initial reasoning effort low" — the pilot's required starting point, not just an operator-configurable option. */
const DEFAULT_REASONING_EFFORT = 'low';
const SCHEMA_VERSION = 'field_proposals_v1';
/** Part 8 AI-01 item 2 -- a separate prompt/schema version from extraction's own, tracked independently since the two tasks evolve on their own schedules. */
const CLASSIFY_PROMPT_VERSION = '2026-09-29-v1';
const CLASSIFY_SCHEMA_VERSION = 'document_classification_v1';
/** Part 8 AI-01 item 5 -- tracked independently of extraction's/classification's own prompt/schema version. */
const EXPLAIN_PROMPT_VERSION = '2026-09-29-v1';
const EXPLAIN_SCHEMA_VERSION = 'readiness_gap_explanation_v1';
/** Part 8 AI-01 item 4 -- tracked independently of every other task's own prompt/schema version. */
const INCONSISTENCY_PROMPT_VERSION = '2026-09-29-v1';
const INCONSISTENCY_SCHEMA_VERSION = 'inconsistency_flags_v1';
/** Official host, a plain literal never influenced by any admin/config input (Part 8 §7: "built-in adapters: official provider host locked"). */
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
/** Part 8 §11's named default request timeout. */
const DEFAULT_TIMEOUT_MS = 60_000;
const PROVIDER = 'openai';

const SYSTEM_PROMPT = `You extract structured field proposals from a single immigration-applicant document for a human to review and approve. You are NOT authorized to write anything directly — every proposal you make will be reviewed by a person before it can change any record.

Rules:
- Only propose values for field keys in the provided allowed list. If a value in the text doesn't correspond to any allowed field key, or you are unsure, set "type" to "UNMAPPED" or "UNCERTAIN" and leave "fieldKey" null — never invent a field key.
- Never invent a value that isn't actually present in the given text. Every proposal's "evidenceSnippet" must be an exact, verbatim substring copied from the document text that supports the value.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the value is correct, not a fixed number.
- If the document contains no extractable fields at all, return an empty "proposals" array.`;

/** Part 8 AI-01 item 2: a deterministic rules-based classifier already handles the confident cases; this prompt only ever runs on a genuine gap it left. */
const CLASSIFY_SYSTEM_PROMPT = `You suggest a document type for a single immigration-applicant document that a deterministic rules-based classifier could not confidently resolve. A human will review your suggestion before it is ever recorded anywhere -- you are NOT authorized to write anything directly.

Rules:
- Only suggest a type from the provided allowed list. If you are not reasonably confident, or the document does not genuinely match any allowed type, set "suggestedType" to null -- never guess.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the suggested type is correct, not a fixed number.
- "rationale" should briefly explain what in the text supports your suggestion (or why you could not decide, if "suggestedType" is null).`;

const CLASSIFY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestedType: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    rationale: { type: ['string', 'null'] },
  },
  required: ['suggestedType', 'confidence', 'rationale'],
  additionalProperties: false,
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
  additionalProperties: false,
} as const;

/** Part 8 AI-01 item 4: compares a document against the applicant's OWN already-confirmed profile facts -- never a second document, never a re-determination of correctness. */
const INCONSISTENCY_SYSTEM_PROMPT = `You compare a single immigration-applicant document's text against that same applicant's own already-confirmed profile facts, looking for genuine possible contradictions a human should review. You are NOT deciding which side (the document or the profile) is correct -- only flagging where they seem to disagree.

Rules:
- Only flag a GENUINE apparent contradiction (e.g. a name, date, or number that conflicts) -- never a mere absence, omission, or a fact the profile simply doesn't cover.
- Never invent a profile fact or a document detail that isn't actually given to you.
- "confidence" is your genuine calibrated probability (0.0-1.0) that this is a real contradiction, not a fixed number.
- If you find no genuine contradictions, return an empty "flags" array -- this is the common, correct outcome.`;

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
          rationale: { type: ['string', 'null'] },
        },
        required: ['description', 'confidence', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['flags'],
  additionalProperties: false,
} as const;

interface JsonSchemaProposal {
  readonly type: string;
  readonly fieldKey: string | null;
  readonly value: string | null;
  readonly confidence: number;
  readonly rationale: string | null;
  readonly evidenceSnippet: string | null;
}

const PROPOSAL_SCHEMA = {
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
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
} as const;

export interface OpenAiExtractionAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Sent as the `OpenAI-Project` header for a project-scoped API key. */
  readonly projectId?: string;
  /** Reasoning effort for reasoning-capable models (e.g. "low"/"medium"/"high"); omitted if unset. */
  readonly reasoningEffort?: string;
  /**
   * Whether OpenAI may retain this request/response server-side. Defaults to
   * `false` (privacy minimization — master directive §8) unless explicitly
   * opted in via the `OPENAI_STORE_RESPONSES` env contract knob.
   */
  readonly storeResponses?: boolean;
  /** Part 8 §11's default is 60s; overridable (tests use a short value to prove the timeout path without a real 60s wait). */
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class OpenAiExtractionAdapter
  implements AiExtractionPort, AiClassifyPort, AiExplainPort, AiInconsistencyPort
{
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly projectId: string | undefined;
  private readonly reasoningEffort: string;
  private readonly storeResponses: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiExtractionAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.projectId = options.projectId;
    this.reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    this.storeResponses = options.storeResponses ?? false;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  cacheKeyComponents(): AiCacheKeyComponents {
    return {
      model: this.model,
      promptVersion: this.promptVersion,
      schemaVersion: SCHEMA_VERSION,
      reasoningEffort: this.reasoningEffort,
    };
  }

  async extract(input: AiExtractionInput): Promise<AiExtractionOutcome> {
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
                content: `Allowed field keys (JSON array - use ONLY these, or UNMAPPED/UNCERTAIN): ${JSON.stringify(input.allowedFieldKeys)}\n\nDocument text:\n"""\n${input.text}\n"""`,
              },
            ],
            reasoning: { effort: this.reasoningEffort },
            text: {
              format: {
                type: 'json_schema',
                name: 'field_proposals',
                schema: PROPOSAL_SCHEMA,
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
          // "Cost units" = tokens billed for this call — an honest, driftless
          // proxy for spend without hardcoding a dollar-per-token table here.
          costUnits: parsed.totalTokens,
          inputUnits: parsed.inputTokens,
          outputUnits: parsed.outputTokens,
          cachedUnits: parsed.cachedTokens,
          modelVersion: this.model,
          promptVersion: this.promptVersion,
          schemaVersion: SCHEMA_VERSION,
          provider: PROVIDER,
          ...(parsed.responseId ? { providerRequestId: parsed.responseId } : {}),
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
      reasoningEffort: this.reasoningEffort,
    };
  }

  async classify(input: AiClassifyInput): Promise<AiClassifyOutcome> {
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
              { role: 'developer', content: CLASSIFY_SYSTEM_PROMPT },
              {
                role: 'user',
                content: `Allowed document types (JSON array - use ONLY these, or null): ${JSON.stringify(input.allowedTypes)}\n\nDocument text:\n"""\n${input.text}\n"""`,
              },
            ],
            reasoning: { effort: this.reasoningEffort },
            text: {
              format: {
                type: 'json_schema',
                name: 'document_classification',
                schema: CLASSIFY_RESPONSE_SCHEMA,
                strict: true,
              },
            },
          }),
        }),
        this.timeoutMs,
        'OpenAI Responses API call (classification)',
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

    const parsed = parseClassificationPayload(payload);
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
          ...(parsed.responseId ? { providerRequestId: parsed.responseId } : {}),
          latencyMs,
        },
      },
    };
  }

  explainCacheKeyComponents(): AiCacheKeyComponents {
    return {
      model: this.model,
      promptVersion: EXPLAIN_PROMPT_VERSION,
      schemaVersion: EXPLAIN_SCHEMA_VERSION,
      reasoningEffort: this.reasoningEffort,
    };
  }

  async explain(input: AiExplainInput): Promise<AiExplainOutcome> {
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
              { role: 'developer', content: EXPLAIN_SYSTEM_PROMPT },
              {
                role: 'user',
                content: `Requirement kind: ${input.requirementKind}\nRequirement: ${input.requirementKey}\nStatus: ${input.state === 'CRITICAL_GAP' ? 'required and not yet met' : 'optional and not yet met'}\nCitation: """\n${input.citation}\n"""`,
              },
            ],
            reasoning: { effort: this.reasoningEffort },
            text: {
              format: {
                type: 'json_schema',
                name: 'readiness_gap_explanation',
                schema: EXPLAIN_RESPONSE_SCHEMA,
                strict: true,
              },
            },
          }),
        }),
        this.timeoutMs,
        'OpenAI Responses API call (explanation)',
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

    const parsed = parseExplanationPayload(payload);
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
          ...(parsed.responseId ? { providerRequestId: parsed.responseId } : {}),
          latencyMs,
        },
      },
    };
  }

  inconsistencyCacheKeyComponents(): AiCacheKeyComponents {
    return {
      model: this.model,
      promptVersion: INCONSISTENCY_PROMPT_VERSION,
      schemaVersion: INCONSISTENCY_SCHEMA_VERSION,
      reasoningEffort: this.reasoningEffort,
    };
  }

  async checkConsistency(input: AiInconsistencyInput): Promise<AiInconsistencyOutcome> {
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
              { role: 'developer', content: INCONSISTENCY_SYSTEM_PROMPT },
              {
                role: 'user',
                content: `Applicant's own confirmed profile facts (JSON array of fieldKey/value pairs): ${JSON.stringify(input.profileFacts)}\n\nDocument text:\n"""\n${input.text}\n"""`,
              },
            ],
            reasoning: { effort: this.reasoningEffort },
            text: {
              format: {
                type: 'json_schema',
                name: 'inconsistency_flags',
                schema: INCONSISTENCY_RESPONSE_SCHEMA,
                strict: true,
              },
            },
          }),
        }),
        this.timeoutMs,
        'OpenAI Responses API call (inconsistency check)',
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

    const parsed = parseInconsistencyPayload(payload);
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
          ...(parsed.responseId ? { providerRequestId: parsed.responseId } : {}),
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
  readonly input_tokens_details?: unknown;
}
interface RawInputTokensDetails {
  readonly cached_tokens?: unknown;
}
interface RawBody {
  readonly proposals?: unknown;
}
interface RawProposal {
  readonly type?: unknown;
  readonly confidence?: unknown;
}

type ParsedResponsesPayload =
  | {
      readonly kind: 'proposals';
      readonly proposals: JsonSchemaProposal[];
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
      readonly responseId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

function parseResponsesPayload(payload: unknown): ParsedResponsesPayload {
  if (typeof payload !== 'object' || payload === null) return { kind: 'invalid' };
  const record = payload as RawResponsesPayload;

  // A response cut off before completing (`max_output_tokens` reached) may
  // still contain SOMETHING that happens to parse as JSON below -- but it
  // was never actually finished, so it must never be trusted as a complete
  // set of proposals (Part 8 §4's own named "truncation" failure mode).
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
  const proposalsRaw = (body as RawBody).proposals;
  if (!Array.isArray(proposalsRaw)) return { kind: 'invalid' };

  const proposals = proposalsRaw.filter((p): p is JsonSchemaProposal => {
    if (typeof p !== 'object' || p === null) return false;
    const candidate = p as RawProposal;
    return typeof candidate.type === 'string' && typeof candidate.confidence === 'number';
  });

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const totalTokens = typeof rawUsage?.total_tokens === 'number' ? rawUsage.total_tokens : 0;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;
  const inputDetails =
    typeof rawUsage?.input_tokens_details === 'object' && rawUsage.input_tokens_details !== null
      ? (rawUsage.input_tokens_details as RawInputTokensDetails)
      : undefined;
  const cachedTokens =
    typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : 0;

  return {
    kind: 'proposals',
    proposals,
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    ...(typeof record.id === 'string' ? { responseId: record.id } : {}),
  };
}

interface RawClassificationBody {
  readonly suggestedType?: unknown;
  readonly confidence?: unknown;
  readonly rationale?: unknown;
}

type ParsedClassificationPayload =
  | {
      readonly kind: 'classification';
      readonly suggestedType: string | null;
      readonly confidence: number;
      readonly rationale?: string;
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
      readonly responseId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Reuses `extractOutputText`/`extractRefusal` below unchanged -- both are already generic over `RawResponsesPayload`, not proposal-shaped. */
function parseClassificationPayload(payload: unknown): ParsedClassificationPayload {
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
  const candidate = body as RawClassificationBody;
  if (typeof candidate.confidence !== 'number') return { kind: 'invalid' };
  const suggestedType =
    typeof candidate.suggestedType === 'string' ? candidate.suggestedType : null;

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const totalTokens = typeof rawUsage?.total_tokens === 'number' ? rawUsage.total_tokens : 0;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;
  const inputDetails =
    typeof rawUsage?.input_tokens_details === 'object' && rawUsage.input_tokens_details !== null
      ? (rawUsage.input_tokens_details as RawInputTokensDetails)
      : undefined;
  const cachedTokens =
    typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : 0;

  return {
    kind: 'classification',
    suggestedType,
    confidence: candidate.confidence,
    ...(typeof candidate.rationale === 'string' ? { rationale: candidate.rationale } : {}),
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    ...(typeof record.id === 'string' ? { responseId: record.id } : {}),
  };
}

interface RawExplanationBody {
  readonly explanation?: unknown;
}

type ParsedExplanationPayload =
  | {
      readonly kind: 'explanation';
      readonly explanation: string;
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
      readonly responseId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Reuses `extractOutputText`/`extractRefusal` below unchanged, the same way `parseClassificationPayload` does. */
function parseExplanationPayload(payload: unknown): ParsedExplanationPayload {
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
  const candidate = body as RawExplanationBody;
  if (typeof candidate.explanation !== 'string') return { kind: 'invalid' };

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const totalTokens = typeof rawUsage?.total_tokens === 'number' ? rawUsage.total_tokens : 0;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;
  const inputDetails =
    typeof rawUsage?.input_tokens_details === 'object' && rawUsage.input_tokens_details !== null
      ? (rawUsage.input_tokens_details as RawInputTokensDetails)
      : undefined;
  const cachedTokens =
    typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : 0;

  return {
    kind: 'explanation',
    explanation: candidate.explanation,
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    ...(typeof record.id === 'string' ? { responseId: record.id } : {}),
  };
}

interface JsonSchemaFlag {
  readonly description: string;
  readonly confidence: number;
  readonly rationale: string | null;
}

interface RawInconsistencyBody {
  readonly flags?: unknown;
}
interface RawFlag {
  readonly description?: unknown;
  readonly confidence?: unknown;
}

type ParsedInconsistencyPayload =
  | {
      readonly kind: 'flags';
      readonly flags: JsonSchemaFlag[];
      readonly totalTokens: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
      readonly responseId?: string;
    }
  | { readonly kind: 'refusal'; readonly message: string }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'invalid' };

/** Reuses `extractOutputText`/`extractRefusal` below unchanged, the same way `parseClassificationPayload`/`parseExplanationPayload` do. */
function parseInconsistencyPayload(payload: unknown): ParsedInconsistencyPayload {
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
  const flagsRaw = (body as RawInconsistencyBody).flags;
  if (!Array.isArray(flagsRaw)) return { kind: 'invalid' };

  const flags = flagsRaw.filter((f): f is JsonSchemaFlag => {
    if (typeof f !== 'object' || f === null) return false;
    const candidate = f as RawFlag;
    return typeof candidate.description === 'string' && typeof candidate.confidence === 'number';
  });

  const usage = record.usage;
  const rawUsage = typeof usage === 'object' && usage !== null ? (usage as RawUsage) : undefined;
  const totalTokens = typeof rawUsage?.total_tokens === 'number' ? rawUsage.total_tokens : 0;
  const inputTokens = typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0;
  const outputTokens = typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0;
  const inputDetails =
    typeof rawUsage?.input_tokens_details === 'object' && rawUsage.input_tokens_details !== null
      ? (rawUsage.input_tokens_details as RawInputTokensDetails)
      : undefined;
  const cachedTokens =
    typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : 0;

  return {
    kind: 'flags',
    flags,
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    ...(typeof record.id === 'string' ? { responseId: record.id } : {}),
  };
}

/** The Responses API exposes a convenience `output_text`; fall back to walking `output`. */
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

/**
 * A structured-output refusal shows up as its own `refusal` string field on
 * a content part -- a distinct, positive signal from OpenAI that the model
 * declined to answer, never to be confused with a null/missing value or
 * treated as just another `invalid_response` (Part 8 §4's own named
 * "refusal" failure mode).
 */
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
