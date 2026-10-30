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
 * Anthropic Messages API adapter (Part 8 §3: "ship production adapters for
 * ... Anthropic Claude API"). Sends ONLY the already deterministically-
 * extracted, size-capped text (packages/services/src/extraction.ts) plus the
 * canonical field-key registry -- never the original file bytes -- matching
 * `OpenAiExtractionAdapter`'s identical privacy-minimization discipline.
 *
 * Structured output via the Messages API's JSON outputs
 * (`output_config.format`, see `anthropic-messages.ts`): the answer is
 * constrained to the schema below, so it always has the expected shape. The
 * prompt instructs the model to ground every value in a verbatim quoted
 * snippet and to emit UNMAPPED/UNCERTAIN rather than invent a field key or an
 * unsupported value -- the schema enforces the shape, never the truth, and
 * the service layer (packages/services/src/ai.ts) still treats every
 * proposal as advisory: nothing here writes to the profile directly.
 *
 * Provider notes (Part 8 §3's own required record):
 * - Docs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 *   (checked 2026-10-30).
 * - API version: `2023-06-01` (the `anthropic-version` header) -- the stable
 *   Messages API generation this adapter targets.
 * - Structured-output mechanism: JSON outputs (`output_config.format`),
 *   available on every model. It replaced a forced tool call, which Claude
 *   Opus 5.5, Claude Sonnet 5.5 and Claude Fable 5.1 refuse.
 * - Vision/file behavior: not used by this adapter -- only deterministic
 *   plain text is ever sent, matching the OpenAI adapter's own scope.
 * - Retention/data-control: unlike OpenAI's per-call `store` flag, the
 *   Messages API has no per-request retention toggle -- `storeResponses` is
 *   accepted on this adapter for interface-shape parity with
 *   `OpenAiExtractionAdapter` but is currently a no-op; retention is
 *   governed by the account's own data processing agreement, outside this
 *   adapter's control.
 * - `reasoningEffort` is sent as `output_config.effort` to models that take
 *   it (`anthropicEffortFor`), and is then part of every cache key, since a
 *   different effort can give a different answer. Unset leaves the model's
 *   own default. Models that always think first (Claude Opus 5.5, Claude
 *   Sonnet 5.5) have no way to turn thinking off; effort is the dial.
 */

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_PROMPT_VERSION = '2026-10-30-v1';
const SCHEMA_VERSION = 'field_proposals_v1';
/** Part 8 AI-01 item 2 -- tracked independently of extraction's own prompt/schema version, matching `OpenAiExtractionAdapter`'s identical separation. */
const CLASSIFY_PROMPT_VERSION = '2026-10-30-v1';
const CLASSIFY_SCHEMA_VERSION = 'document_classification_v1';
/** Part 8 AI-01 item 5 -- tracked independently of extraction's/classification's own prompt/schema version. */
const EXPLAIN_PROMPT_VERSION = '2026-10-30-v1';
const EXPLAIN_SCHEMA_VERSION = 'readiness_gap_explanation_v1';
/** Part 8 AI-01 item 4 -- tracked independently of every other task's own prompt/schema version. */
const INCONSISTENCY_PROMPT_VERSION = '2026-10-30-v1';
const INCONSISTENCY_SCHEMA_VERSION = 'inconsistency_flags_v1';
/** Part 8 §11's named default request timeout. */
const DEFAULT_TIMEOUT_MS = 60_000;
const PROVIDER = 'anthropic';

const SYSTEM_PROMPT = `You extract structured field proposals from a single immigration-applicant document for a human to review and approve. You are NOT authorized to write anything directly -- every proposal you make will be reviewed by a person before it can change any record.

Rules:
- Only propose values for field keys in the provided allowed list. If a value in the text doesn't correspond to any allowed field key, or you are unsure, set "type" to "UNMAPPED" or "UNCERTAIN" and leave "fieldKey" null -- never invent a field key.
- Never invent a value that isn't actually present in the given text. Every proposal's "evidenceSnippet" must be an exact, verbatim substring copied from the document text that supports the value.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the value is correct, not a fixed number.
- If the document contains no extractable fields at all, answer with an empty "proposals" array.
- Answer only with the JSON object the response format describes -- never with plain text.`;

/** Part 8 AI-01 item 2: a deterministic rules-based classifier already handles the confident cases; this prompt only ever runs on a genuine gap it left. */
const CLASSIFY_SYSTEM_PROMPT = `You suggest a document type for a single immigration-applicant document that a deterministic rules-based classifier could not confidently resolve. A human will review your suggestion before it is ever recorded anywhere -- you are NOT authorized to write anything directly.

Rules:
- Only suggest a type from the provided allowed list. If you are not reasonably confident, or the document does not genuinely match any allowed type, set "suggestedType" to null -- never guess.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the suggested type is correct, not a fixed number.
- "rationale" should briefly explain what in the text supports your suggestion (or why you could not decide, if "suggestedType" is null).
- Answer only with the JSON object the response format describes -- never with plain text.`;

const CLASSIFY_ANSWER_SCHEMA = {
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
- Ground every claim in the given citation text; do not invent legal consequences beyond what it implies.
- Answer only with the JSON object the response format describes -- never with plain text.`;

const EXPLAIN_ANSWER_SCHEMA = {
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
- If you find no genuine contradictions, answer with an empty "flags" array -- this is the common, correct outcome.
- Answer only with the JSON object the response format describes -- never with plain text.`;

const INCONSISTENCY_ANSWER_SCHEMA = {
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

interface AnswerProposal {
  readonly type: string;
  readonly fieldKey: string | null;
  readonly value: string | null;
  readonly confidence: number;
  readonly rationale: string | null;
  readonly evidenceSnippet: string | null;
}

const PROPOSAL_ANSWER_SCHEMA = {
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

export interface AnthropicExtractionAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Sent as `output_config.effort` to models that take it; see the class doc comment. */
  readonly reasoningEffort?: string;
  /** Accepted for interface-shape parity; currently a no-op (see class doc comment -- no per-call Messages API retention toggle exists). */
  readonly storeResponses?: boolean;
  readonly maxTokens?: number;
  /** Part 8 §11's default is 60s; overridable (tests use a short value to prove the timeout path without a real 60s wait). */
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class AnthropicExtractionAdapter
  implements AiExtractionPort, AiClassifyPort, AiExplainPort, AiInconsistencyPort
{
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly effort: string | undefined;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicExtractionAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.effort = anthropicEffortFor(this.model, options.reasoningEffort);
    this.maxTokens = options.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The cache key parts every task shares: who answers, and at what effort. */
  private keyParts(): Pick<AiCacheKeyComponents, 'provider' | 'model' | 'reasoningEffort'> {
    return {
      provider: PROVIDER,
      model: this.model,
      ...(this.effort ? { reasoningEffort: this.effort } : {}),
    };
  }

  /** One structured call: the system prompt, the user content and the answer schema. */
  private call(system: string, content: string, schema: object) {
    return callStructured({
      apiKey: this.apiKey,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      body: structuredRequestBody({
        model: this.model,
        maxTokens: this.maxTokens,
        system,
        content,
        schema,
        effort: this.effort,
      }),
    });
  }

  /** Usage shared by every task's result; the caller adds its own prompt and schema versions. */
  private usage(answer: StructuredAnswer) {
    return {
      costUnits: answer.inputTokens + answer.outputTokens,
      inputUnits: answer.inputTokens,
      outputUnits: answer.outputTokens,
      cachedUnits: answer.cachedTokens,
      modelVersion: this.model,
      provider: PROVIDER,
      ...(answer.messageId ? { providerRequestId: answer.messageId } : {}),
      latencyMs: answer.latencyMs,
    };
  }

  cacheKeyComponents(): AiCacheKeyComponents {
    return {
      ...this.keyParts(),
      promptVersion: this.promptVersion,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  async extract(input: AiExtractionInput): Promise<AiExtractionOutcome> {
    const answer = await this.call(
      SYSTEM_PROMPT,
      `Allowed field keys (JSON array - use ONLY these, or UNMAPPED/UNCERTAIN): ${JSON.stringify(input.allowedFieldKeys)}\n\nDocument text:\n"""\n${input.text}\n"""`,
      PROPOSAL_ANSWER_SCHEMA,
    );
    if (!answer.ok) return anthropicFailure(answer);
    const proposalsRaw = (answer.value as RawProposalAnswer).proposals;
    if (!Array.isArray(proposalsRaw)) return anthropicInvalidShape(answer.latencyMs);

    const proposals: FieldProposal[] = proposalsRaw
      .filter((p): p is AnswerProposal => {
        if (typeof p !== 'object' || p === null) return false;
        const candidate = p as RawProposal;
        return typeof candidate.type === 'string' && typeof candidate.confidence === 'number';
      })
      .map((p) => ({
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
          ...this.usage(answer),
          promptVersion: this.promptVersion,
          schemaVersion: SCHEMA_VERSION,
        },
      },
    };
  }

  classifyCacheKeyComponents(): AiCacheKeyComponents {
    return {
      ...this.keyParts(),
      promptVersion: CLASSIFY_PROMPT_VERSION,
      schemaVersion: CLASSIFY_SCHEMA_VERSION,
    };
  }

  async classify(input: AiClassifyInput): Promise<AiClassifyOutcome> {
    const answer = await this.call(
      CLASSIFY_SYSTEM_PROMPT,
      `Allowed document types (JSON array - use ONLY these, or null): ${JSON.stringify(input.allowedTypes)}\n\nDocument text:\n"""\n${input.text}\n"""`,
      CLASSIFY_ANSWER_SCHEMA,
    );
    if (!answer.ok) return anthropicFailure(answer);
    const candidate = answer.value as RawClassificationAnswer;
    if (typeof candidate.confidence !== 'number') return anthropicInvalidShape(answer.latencyMs);

    return {
      ok: true,
      result: {
        suggestedType: typeof candidate.suggestedType === 'string' ? candidate.suggestedType : null,
        confidence: candidate.confidence,
        ...(typeof candidate.rationale === 'string' && candidate.rationale
          ? { rationale: candidate.rationale }
          : {}),
        usage: {
          ...this.usage(answer),
          promptVersion: CLASSIFY_PROMPT_VERSION,
          schemaVersion: CLASSIFY_SCHEMA_VERSION,
        },
      },
    };
  }

  explainCacheKeyComponents(): AiCacheKeyComponents {
    return {
      ...this.keyParts(),
      promptVersion: EXPLAIN_PROMPT_VERSION,
      schemaVersion: EXPLAIN_SCHEMA_VERSION,
    };
  }

  async explain(input: AiExplainInput): Promise<AiExplainOutcome> {
    const answer = await this.call(
      EXPLAIN_SYSTEM_PROMPT,
      `Requirement kind: ${input.requirementKind}\nRequirement: ${input.requirementKey}\nStatus: ${input.state === 'CRITICAL_GAP' ? 'required and not yet met' : 'optional and not yet met'}\nCitation: """\n${input.citation}\n"""`,
      EXPLAIN_ANSWER_SCHEMA,
    );
    if (!answer.ok) return anthropicFailure(answer);
    const candidate = answer.value as RawExplanationAnswer;
    if (typeof candidate.explanation !== 'string') return anthropicInvalidShape(answer.latencyMs);

    return {
      ok: true,
      result: {
        explanation: candidate.explanation,
        usage: {
          ...this.usage(answer),
          promptVersion: EXPLAIN_PROMPT_VERSION,
          schemaVersion: EXPLAIN_SCHEMA_VERSION,
        },
      },
    };
  }

  inconsistencyCacheKeyComponents(): AiCacheKeyComponents {
    return {
      ...this.keyParts(),
      promptVersion: INCONSISTENCY_PROMPT_VERSION,
      schemaVersion: INCONSISTENCY_SCHEMA_VERSION,
    };
  }

  async checkConsistency(input: AiInconsistencyInput): Promise<AiInconsistencyOutcome> {
    const answer = await this.call(
      INCONSISTENCY_SYSTEM_PROMPT,
      `Applicant's own confirmed profile facts (JSON array of fieldKey/value pairs): ${JSON.stringify(input.profileFacts)}\n\nDocument text:\n"""\n${input.text}\n"""`,
      INCONSISTENCY_ANSWER_SCHEMA,
    );
    if (!answer.ok) return anthropicFailure(answer);
    const flagsRaw = (answer.value as RawInconsistencyAnswer).flags;
    if (!Array.isArray(flagsRaw)) return anthropicInvalidShape(answer.latencyMs);

    const flags: AiInconsistencyFlag[] = flagsRaw
      .filter((f): f is AnswerFlag => {
        if (typeof f !== 'object' || f === null) return false;
        const candidate = f as RawFlag;
        return (
          typeof candidate.description === 'string' && typeof candidate.confidence === 'number'
        );
      })
      .map((f) => ({
        description: f.description,
        confidence: f.confidence,
        ...(f.rationale ? { rationale: f.rationale } : {}),
      }));

    return {
      ok: true,
      result: {
        flags,
        usage: {
          ...this.usage(answer),
          promptVersion: INCONSISTENCY_PROMPT_VERSION,
          schemaVersion: INCONSISTENCY_SCHEMA_VERSION,
        },
      },
    };
  }
}

type StructuredAnswer = Extract<Awaited<ReturnType<typeof callStructured>>, { ok: true }>;

function toProposalType(value: string): ProposalType {
  return matchEnumValue(PROPOSAL_TYPES, value) ?? 'UNCERTAIN';
}

// Declared (non-index-signature) shapes for the untrusted answer, so
// narrowing reads as plain dot-access instead of bracket-indexed casts.
interface RawProposalAnswer {
  readonly proposals?: unknown;
}
interface RawProposal {
  readonly type?: unknown;
  readonly confidence?: unknown;
}
interface RawClassificationAnswer {
  readonly suggestedType?: unknown;
  readonly confidence?: unknown;
  readonly rationale?: unknown;
}
interface RawExplanationAnswer {
  readonly explanation?: unknown;
}
interface AnswerFlag {
  readonly description: string;
  readonly confidence: number;
  readonly rationale: string | null;
}
interface RawInconsistencyAnswer {
  readonly flags?: unknown;
}
interface RawFlag {
  readonly description?: unknown;
  readonly confidence?: unknown;
}
