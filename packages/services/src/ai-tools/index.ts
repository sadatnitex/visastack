import {
  type AiAdmission,
  type AiFileDeps,
  type AiGateRequest,
  withAiConnection,
  withAiFileConnection,
  withAiSuggestionConnection,
} from '../access/with-ai-connection';
import type { Db } from '../db';
import type { KeyManagementPort } from '../ports';
import { addReminder } from './add-reminder';
import { getDocumentFile } from './get-document-file';
import { getDocumentText } from './get-document-text';
import { getProfileSection } from './get-profile-section';
import { listCases } from './list-cases';
import { listDocuments } from './list-documents';
import { prepareContext } from './prepare-context';
import {
  type AiToolResult,
  type AnyAiToolDefinition,
  MESSAGES,
  describeResult,
  refusal,
} from './result';
import { saveDraft } from './save-draft';
import { suggestProfileUpdate } from './suggest-profile-update';

/**
 * The AI connector's tools: the five read-only ones (ADR 0021 section 6), the read-only file tool
 * (S20, "Original Files"), then the three suggestion tools (S21, ADR 0021 extension), which work
 * only while the person has turned on "Suggest Changes". Each one runs only through the AI gate,
 * here, and sees only the gateway it hands over: a read tool never gets the writes, and only the
 * file tool gets files.
 */
export const AI_TOOLS = [
  prepareContext,
  listCases,
  getProfileSection,
  listDocuments,
  getDocumentText,
  getDocumentFile,
  suggestProfileUpdate,
  saveDraft,
  addReminder,
] as const satisfies readonly AnyAiToolDefinition[];

export type AiToolName = (typeof AI_TOOLS)[number]['name'];

export interface RunAiToolInput {
  readonly token: string;
  readonly resource: string;
  /** The deployment's pilot-access rule (see `AiAdmission`). */
  readonly admission: AiAdmission;
  readonly encryption?: KeyManagementPort;
  /** The private storage and Safe Copy renderer, for the file tool (S20). */
  readonly files?: AiFileDeps;
  readonly now?: Date;
}

export type AiToolOutcome =
  | { readonly kind: 'answered'; readonly result: AiToolResult }
  /** The token, the connection, the admission or the owner's access is no longer good: 401. */
  | { readonly kind: 'unauthorized'; readonly result: AiToolResult }
  /**
   * Something broke part-way. The app gets a plain refusal; `error` is for the server log only,
   * never for the app (it may hold database text).
   */
  | { readonly kind: 'failed'; readonly result: AiToolResult; readonly error: unknown };

/**
 * Runs one tool for the connection behind the token, with input the MCP layer already checked
 * against the tool's input schema. Never throws.
 */
export async function runAiTool<Tool extends AnyAiToolDefinition>(
  db: Db,
  tool: Tool,
  input: Parameters<Tool['run']>[1],
  request: RunAiToolInput,
): Promise<AiToolOutcome> {
  try {
    const gate: AiGateRequest = {
      token: request.token,
      resource: request.resource,
      tool: tool.name,
      admission: request.admission,
      ...(request.encryption ? { encryption: request.encryption } : {}),
      ...(request.files ? { files: request.files } : {}),
      ...(request.now ? { now: request.now } : {}),
    };
    const outcome =
      tool.kind === 'suggestion'
        ? await withAiSuggestionConnection(
            db,
            gate,
            (gateway) => tool.run(gateway, input as never),
            describeResult,
          )
        : tool.kind === 'file'
          ? await withAiFileConnection(
              db,
              gate,
              (gateway) => tool.run(gateway, input as never),
              describeResult,
            )
          : await withAiConnection(
              db,
              gate,
              (gateway) => tool.run(gateway, input as never),
              describeResult,
            );
    if (!outcome.ok) return { kind: 'unauthorized', result: refusal(MESSAGES.ended) };
    return { kind: 'answered', result: outcome.value };
  } catch (error) {
    return { kind: 'failed', result: refusal(MESSAGES.failed), error };
  }
}

export {
  AI_RESPONSE_LIMIT_BYTES,
  MESSAGES as AI_TOOL_MESSAGES,
  SUGGESTION_ANNOTATIONS,
  type AiFileToolDefinition,
  type AnyAiToolDefinition,
  type AiSuggestionToolDefinition,
  type AiToolDefinition,
  type AiToolResult,
  refusal as aiToolRefusal,
} from './result';
