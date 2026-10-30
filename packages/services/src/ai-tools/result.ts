import type { z } from 'zod';
import type {
  AiCallRecord,
  AiContextGateway,
  AiWriteFailure,
  AiWriteGateway,
} from '../access/with-ai-connection';
import type { AiKnownToolName, AiSuggestionToolName } from '../ai-connection-scopes';

/**
 * How every AI tool answers (ADR 0021 sections 6 and 7): plain refusals as tool results, never an
 * empty success; a short summary plus the structured answer; and a 50 KB limit on the whole
 * answer, met by leaving whole entries out (or shortening one long text), never by cutting JSON.
 */

/** The answer to one tool call, as MCP `tools/call` returns it. No SDK types: it is plain data. */
export interface AiToolResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError?: true;
  /** Index signature the MCP SDK's result type requires. */
  readonly [key: string]: unknown;
}

/** Every tool reads, never changes anything, gives the same answer to the same question, and reaches nothing outside VisaStack. */
export const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const);

/**
 * The suggestion tools (S21, ADR 0021 extension): each call may leave something new for the person
 * (so it is not read-only, and calling twice may leave two), but none removes or overwrites
 * anything, and none reaches anything outside VisaStack.
 */
export const SUGGESTION_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const);

/** The limit on one tool answer, as the app receives it (ADR 0021 section 7). */
export const AI_RESPONSE_LIMIT_BYTES = 50 * 1024;
/** Room kept for the JSON-RPC envelope around the result. */
const ENVELOPE_BYTES = 512;

export const MESSAGES = {
  notShared:
    'Not shared with this AI app. You can change this in VisaStack under Sharing, AI Connections.',
  caseNotShared:
    'That case is not shared with this AI app. Use list_cases to see the cases you can read, or change this in VisaStack under Sharing, AI Connections.',
  caseUnavailable:
    'The case this AI app was connected to is no longer available. You can connect the app again in VisaStack.',
  documentReference:
    'That is not a document reference. References look like D-7K2Q9M; use list_documents to see them.',
  documentProtected:
    'The text of this kind of document is protected and is never shared with AI apps.',
  noText:
    'There is no shared text for that document. It may not have been read yet, or it is not part of what was shared with this AI app. You can change this in VisaStack under Sharing, AI Connections.',
  failed: 'VisaStack could not prepare this right now. Try again in a moment.',
  ended: 'This connection to VisaStack has ended. Connect the app again in VisaStack to continue.',
  shortened:
    'This answer was shortened to fit the size limit. Ask about one case, one section or one document at a time to see the rest.',
  tooLarge:
    'This answer is too large to send. Ask about one case, one section or one document at a time.',
  // The suggestion tools (S21).
  suggestionsOff:
    'This AI app cannot suggest changes. The person can turn on Suggest Changes for it in VisaStack under Sharing, AI Connections.',
  fieldNotOpen:
    'This AI app cannot suggest that detail. It may be outside the parts the person chose, protected, or not a detail VisaStack keeps. Use get_profile_section to see the details in a section and their names.',
  writeLimit:
    'This app has reached its limit of suggestions for today. Nothing was saved. The person can still make changes themselves in VisaStack.',
  caseFinished: 'That case is closed, so a reminder cannot be added to it. Nothing was saved.',
  notAvailableYet: 'Suggestions are not available in VisaStack yet. Nothing was saved.',
  featureOff:
    'This AI feature is turned off right now. Everything else works as usual. Nothing was saved.',
  consentNeeded:
    'The person has not turned on processing in VisaStack yet, so nothing can be saved for them. Nothing was saved.',
  invalidInput:
    'That could not be saved. Check the text is not empty and within the limits, and give a due date as YYYY-MM-DD from today onward.',
  documentNotOpen:
    'That document is not one this AI app can see. Use list_documents to see the documents and their references.',
  noCases:
    'Cases are not open to this AI app. The person can change this in VisaStack under Sharing, AI Connections.',
} as const;

/** The plain answer to a suggestion, draft or reminder that was not saved. */
export function writeRefusal(reason: AiWriteFailure): AiToolResult {
  switch (reason) {
    case 'suggestions_not_granted':
      return refusal(MESSAGES.suggestionsOff);
    case 'not_available':
      return refusal(MESSAGES.notAvailableYet);
    case 'feature_off':
      return refusal(MESSAGES.featureOff);
    case 'consent_required':
      return refusal(MESSAGES.consentNeeded);
    case 'write_limit':
      return refusal(MESSAGES.writeLimit);
    case 'field_not_shared':
      return refusal(MESSAGES.fieldNotOpen);
    case 'case_finished':
      return refusal(MESSAGES.caseFinished);
    case 'invalid_input':
      return refusal(MESSAGES.invalidInput);
    case 'cases_not_granted':
      return refusal(MESSAGES.noCases);
    case 'case_not_shared':
      return refusal(MESSAGES.caseNotShared);
    case 'case_unavailable':
      return refusal(MESSAGES.caseUnavailable);
    case 'document_not_shared':
      return refusal(MESSAGES.documentNotOpen);
    case 'layer_not_granted':
    case 'document_list_not_granted':
      return refusal(MESSAGES.notShared);
    case 'failed':
      return refusal(MESSAGES.failed);
  }
}

export function refusal(message: string): AiToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function build(summary: string, structured: Record<string, unknown>): AiToolResult {
  // The structured answer is also sent as text, as the protocol recommends for apps that only read text.
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(structured)}` }],
    structuredContent: structured,
  };
}

/** Keys whose contents are never shortened: they are small and they explain the answer. */
const KEEP = new Set(['guidance', 'notice', 'omitted', 'notShared']);
/** Shorter texts are dropped with their entry rather than cut. */
const MIN_CUT_CHARS = 200;

type Target =
  | { readonly kind: 'array'; readonly array: unknown[]; readonly size: number }
  | {
      readonly kind: 'text';
      readonly holder: Record<string, unknown>;
      readonly key: string;
      readonly size: number;
    };

/** The largest list or long text in the answer: the place where leaving something out helps most. */
function largestTarget(root: Record<string, unknown>): Target | null {
  let best: Target | null = null;
  const consider = (target: Target) => {
    if (!best || target.size > best.size) best = target;
  };
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      // A list of one counts for half, so one long text inside it is shortened rather than dropped.
      if (node.length > 0) {
        consider({ kind: 'array', array: node, size: bytes(node) / (node.length > 1 ? 1 : 2) });
      }
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const holder = node as Record<string, unknown>;
    for (const [key, child] of Object.entries(holder)) {
      if (KEEP.has(key)) continue;
      if (typeof child === 'string' && child.length > MIN_CUT_CHARS) {
        consider({ kind: 'text', holder, key, size: Buffer.byteLength(child, 'utf8') });
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  return best;
}

/**
 * Leave out just enough to save `excess` bytes of the structured answer: whole entries from the end of the largest list, or
 * the end of the longest text (by whole characters, marked `truncated` where the entry says so).
 */
function shrink(target: Target, excess: number): void {
  const goal = Math.max(1, excess);
  if (target.kind === 'array') {
    let saved = 0;
    while (target.array.length > 0 && saved < goal) {
      saved += bytes(target.array.pop()) + 1;
    }
    return;
  }
  const characters = Array.from(String(target.holder[target.key]));
  let keep = characters.length;
  let saved = 0;
  while (keep > 0 && saved < goal) {
    keep -= 1;
    saved += Buffer.byteLength(characters[keep] ?? '', 'utf8');
  }
  target.holder[target.key] = characters.slice(0, keep).join('');
  if (typeof Reflect.get(target.holder, 'truncated') === 'boolean') {
    Reflect.set(target.holder, 'truncated', true);
  }
}

/**
 * A successful answer within the size limit. When the whole answer does not fit, entries are
 * left out from the end (most recent lists keep their first entries) and a plain notice says so.
 */
export function answer(
  summary: string,
  structured: Record<string, unknown>,
  limit: number = AI_RESPONSE_LIMIT_BYTES,
): AiToolResult {
  const budget = limit - ENVELOPE_BYTES;
  const whole = build(summary, structured);
  if (bytes(whole) <= budget) return whole;

  const copy: Record<string, unknown> = {
    ...(structuredClone(structured) as Record<string, unknown>),
    notice: MESSAGES.shortened,
  };
  const shortSummary = `${summary} ${MESSAGES.shortened}`;
  for (let round = 0; round < 500; round += 1) {
    const result = build(shortSummary, copy);
    const size = bytes(result);
    if (size <= budget) return result;
    const target = largestTarget(copy);
    if (!target) break;
    // The text copy repeats the structured answer (escaped), so a byte saved there saves more
    // than one in the whole: aim at the structured share of what is over.
    const share = bytes(copy) / size;
    shrink(target, Math.ceil((size - budget) * share));
  }
  return refusal(MESSAGES.tooLarge);
}

/** One read-only tool: what the app is told about it, and what it does with the gateway. */
export interface AiToolDefinition<Input extends z.ZodObject = z.ZodObject> {
  /** One of `AI_TOOL_NAMES`: the only names audit records and telemetry may hold. */
  readonly name: AiKnownToolName;
  readonly kind?: never;
  readonly title: string;
  /** Plain words: what it gives back and when to use it. */
  readonly description: string;
  readonly inputSchema: Input;
  readonly outputSchema: z.ZodObject;
  readonly annotations: typeof READ_ONLY_ANNOTATIONS;
  /** Gets the gateway and nothing else: no database, no proof, no other record. */
  run(gateway: AiContextGateway, input: z.infer<Input>): Promise<AiToolResult>;
}

/**
 * One suggestion tool (S21): the same shape, with the write gateway, whose three writes only ever
 * leave a suggestion, a draft or a reminder for the person.
 */
export interface AiSuggestionToolDefinition<Input extends z.ZodObject = z.ZodObject> {
  readonly name: AiSuggestionToolName;
  readonly kind: 'suggestion';
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Input;
  readonly outputSchema: z.ZodObject;
  readonly annotations: typeof SUGGESTION_ANNOTATIONS;
  run(gateway: AiWriteGateway, input: z.infer<Input>): Promise<AiToolResult>;
}

/** Any tool the server lists: one of the five read tools or one of the three suggestion tools. */
export type AnyAiToolDefinition = AiToolDefinition | AiSuggestionToolDefinition;

function listLength(holder: unknown, key: string): number {
  if (typeof holder !== 'object' || holder === null) return 0;
  const list = Reflect.get(holder, key);
  return Array.isArray(list) ? list.length : 0;
}

/**
 * What an answer actually gave back, for the audit: section names and counts, read from the
 * answer as sent (after the size limit), never a value. A refusal the tool did not record itself
 * is either "too large" or a failure.
 */
export function describeResult(result: AiToolResult): AiCallRecord {
  if (result.isError) {
    const text = result.content[0]?.text;
    return { kind: 'denied', reason: text === MESSAGES.tooLarge ? 'too_large' : 'failed' };
  }
  const body = result.structuredContent ?? {};
  const profile = Reflect.get(body, 'profile');
  const profileLists =
    typeof profile === 'object' && profile !== null ? Object.values(profile) : [];
  const section = Reflect.get(body, 'section');
  const layers = [
    ...(typeof profile === 'object' && profile !== null ? Object.keys(profile) : []),
    ...(typeof section === 'string' ? [section] : []),
  ];
  const text = Reflect.get(body, 'text');
  return {
    kind: 'served',
    layers,
    cases: listLength(body, 'cases'),
    values:
      listLength(Reflect.get(body, 'person'), 'basics') +
      profileLists.reduce<number>((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0) +
      listLength(body, 'values'),
    documents: listLength(body, 'documents'),
    documentTexts: listLength(body, 'documentText') + (typeof text === 'string' ? 1 : 0),
  };
}
