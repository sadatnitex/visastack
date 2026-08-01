import { PROPOSAL_TYPES, type ProposalType } from '@visastack/core';
import type {
  AiCacheKeyComponents,
  AiExtractionInput,
  AiExtractionOutcome,
  AiExtractionPort,
  FieldProposal,
} from '@visastack/services';

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
const RESPONSES_URL = 'https://api.openai.com/v1/responses';

const SYSTEM_PROMPT = `You extract structured field proposals from a single immigration-applicant document for a human to review and approve. You are NOT authorized to write anything directly — every proposal you make will be reviewed by a person before it can change any record.

Rules:
- Only propose values for field keys in the provided allowed list. If a value in the text doesn't correspond to any allowed field key, or you are unsure, set "type" to "UNMAPPED" or "UNCERTAIN" and leave "fieldKey" null — never invent a field key.
- Never invent a value that isn't actually present in the given text. Every proposal's "evidenceSnippet" must be an exact, verbatim substring copied from the document text that supports the value.
- "confidence" is your genuine calibrated probability (0.0-1.0) that the value is correct, not a fixed number.
- If the document contains no extractable fields at all, return an empty "proposals" array.`;

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
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class OpenAiExtractionAdapter implements AiExtractionPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly projectId: string | undefined;
  private readonly reasoningEffort: string;
  private readonly storeResponses: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiExtractionAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.projectId = options.projectId;
    this.reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    this.storeResponses = options.storeResponses ?? false;
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
    let response: Response;
    try {
      response = await this.fetchImpl(RESPONSES_URL, {
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
              content: `Allowed field keys (JSON array — use ONLY these, or UNMAPPED/UNCERTAIN): ${JSON.stringify(input.allowedFieldKeys)}\n\nDocument text:\n"""\n${input.text}\n"""`,
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
      });
    } catch (error) {
      return {
        ok: false,
        code: 'upstream_error',
        message: error instanceof Error ? error.message : 'network error calling OpenAI',
      };
    }

    if (response.status === 429) {
      return { ok: false, code: 'rate_limited', message: 'OpenAI rate limit exceeded' };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        code: 'upstream_error',
        message: `OpenAI responded ${response.status}: ${body.slice(0, 500)}`,
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
      };
    }

    const parsed = parseResponsesPayload(payload);
    if (!parsed) {
      return {
        ok: false,
        code: 'invalid_response',
        message: 'OpenAI response had an unexpected shape',
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
          modelVersion: this.model,
          promptVersion: this.promptVersion,
          schemaVersion: SCHEMA_VERSION,
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
  readonly output_text?: unknown;
  readonly output?: unknown;
  readonly usage?: unknown;
}
interface RawOutputItem {
  readonly content?: unknown;
}
interface RawContentPart {
  readonly text?: unknown;
}
interface RawUsage {
  readonly total_tokens?: unknown;
}
interface RawBody {
  readonly proposals?: unknown;
}
interface RawProposal {
  readonly type?: unknown;
  readonly confidence?: unknown;
}

function parseResponsesPayload(
  payload: unknown,
): { proposals: JsonSchemaProposal[]; totalTokens: number } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const outputText = extractOutputText(payload as RawResponsesPayload);
  if (outputText === undefined) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(outputText);
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const proposalsRaw = (body as RawBody).proposals;
  if (!Array.isArray(proposalsRaw)) return undefined;

  const proposals = proposalsRaw.filter((p): p is JsonSchemaProposal => {
    if (typeof p !== 'object' || p === null) return false;
    const candidate = p as RawProposal;
    return typeof candidate.type === 'string' && typeof candidate.confidence === 'number';
  });

  const usage = (payload as RawResponsesPayload).usage;
  const totalTokens =
    typeof usage === 'object' &&
    usage !== null &&
    typeof (usage as RawUsage).total_tokens === 'number'
      ? ((usage as RawUsage).total_tokens as number)
      : 0;

  return { proposals, totalTokens };
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
