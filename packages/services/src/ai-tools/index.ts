import { type AiAdmission, withAiConnection } from '../access/with-ai-connection';
import type { Db } from '../db';
import type { KeyManagementPort } from '../ports';
import { getDocumentText } from './get-document-text';
import { getProfileSection } from './get-profile-section';
import { listCases } from './list-cases';
import { listDocuments } from './list-documents';
import { prepareContext } from './prepare-context';
import {
  type AiToolDefinition,
  type AiToolResult,
  MESSAGES,
  describeResult,
  refusal,
} from './result';

/**
 * The AI connector's five read-only tools (ADR 0021 section 6). Each one runs only through
 * `withAiConnection`, here, and sees only the gateway it hands over.
 */
export const AI_TOOLS = [
  prepareContext,
  listCases,
  getProfileSection,
  listDocuments,
  getDocumentText,
] as const satisfies readonly AiToolDefinition[];

export type AiToolName = (typeof AI_TOOLS)[number]['name'];

export interface RunAiToolInput {
  readonly token: string;
  readonly resource: string;
  /** The deployment's pilot-access rule (see `AiAdmission`). */
  readonly admission: AiAdmission;
  readonly encryption?: KeyManagementPort;
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
export async function runAiTool<Tool extends AiToolDefinition>(
  db: Db,
  tool: Tool,
  input: Parameters<Tool['run']>[1],
  request: RunAiToolInput,
): Promise<AiToolOutcome> {
  try {
    const outcome = await withAiConnection(
      db,
      {
        token: request.token,
        resource: request.resource,
        tool: tool.name,
        admission: request.admission,
        ...(request.encryption ? { encryption: request.encryption } : {}),
        ...(request.now ? { now: request.now } : {}),
      },
      (gateway) => tool.run(gateway, input),
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
  type AiToolDefinition,
  type AiToolResult,
  refusal as aiToolRefusal,
} from './result';
