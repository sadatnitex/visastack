import { withAiConnection } from '../access/with-ai-connection';
import type { Db } from '../db';
import type { KeyManagementPort } from '../ports';
import { getDocumentText } from './get-document-text';
import { getProfileSection } from './get-profile-section';
import { listCases } from './list-cases';
import { listDocuments } from './list-documents';
import { prepareContext } from './prepare-context';
import { type AiToolDefinition, type AiToolResult, MESSAGES, refusal } from './result';

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
  readonly encryption?: KeyManagementPort;
  readonly now?: Date;
}

export type AiToolOutcome =
  | { readonly kind: 'answered'; readonly result: AiToolResult }
  /** The token, the connection or the owner's access is no longer good: answer 401. */
  | { readonly kind: 'unauthorized'; readonly result: AiToolResult };

/**
 * Runs one tool for the connection behind the token, with input the MCP layer already checked
 * against the tool's input schema.
 */
export async function runAiTool<Tool extends AiToolDefinition>(
  db: Db,
  tool: Tool,
  input: Parameters<Tool['run']>[1],
  request: RunAiToolInput,
): Promise<AiToolOutcome> {
  const outcome = await withAiConnection(
    db,
    {
      token: request.token,
      resource: request.resource,
      tool: tool.name,
      ...(request.encryption ? { encryption: request.encryption } : {}),
      ...(request.now ? { now: request.now } : {}),
    },
    (gateway) => tool.run(gateway, input),
  );
  if (!outcome.ok) return { kind: 'unauthorized', result: refusal(MESSAGES.ended) };
  return { kind: 'answered', result: outcome.value };
}

export { AI_RESPONSE_LIMIT_BYTES, type AiToolDefinition, type AiToolResult } from './result';
