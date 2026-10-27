import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  AI_CONNECTION_DEFAULT_LAYERS,
  AI_RESPONSE_LIMIT_BYTES,
  AI_TOOLS,
  type AiToolDefinition,
  type Db,
  type KeyManagementPort,
  RATE_LIMITS,
  authenticateAiRequest,
  checkRateLimits,
  oauthScopeNames,
  runAiTool,
} from '@visastack/services';
import { aiConnectorEnabled, aiIssuer, aiResource, notFound } from './ai-connector';
import { createKeyManagementPort } from './providers';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';

/**
 * The AI context address, `/mcp` (ADR 0021 sections 1, 6 and 7): the Model Context Protocol over
 * stateless Streamable HTTP, through the official TypeScript SDK. Every request stands alone:
 *
 * - off unless `AI_CONNECTOR_ENABLED=true` ("not found");
 * - POST only (GET and DELETE answer 405: there are no sessions and no server-sent streams);
 * - a bearer token on every request, or 401 with the RFC 9728 pointer to the sign-in metadata;
 * - at most 64 KB in (413) and 60 requests a minute and 2,000 a day per connection (429);
 * - JSON answers, each tool answer within 50 KB, and a backstop on the whole response.
 *
 * Every rule about what may be read lives in the services (`withAiConnection` and `ai-tools`);
 * this file only speaks HTTP. Dependencies are injectable so tests run without a database.
 */

export interface McpEndpointDeps {
  readonly enabled: () => boolean;
  readonly withDb: <T>(work: (db: Db) => Promise<T>) => Promise<T>;
  readonly resource: () => string;
  readonly issuer: () => string;
  readonly encryption: () => KeyManagementPort | undefined;
}

const defaults: McpEndpointDeps = {
  enabled: () => aiConnectorEnabled(),
  withDb: withPublicDb,
  resource: aiResource,
  issuer: aiIssuer,
  encryption: createKeyManagementPort,
};

/** The most a request body may carry. Tool inputs are a few short fields. */
export const MCP_MAX_REQUEST_BYTES = 64 * 1024;
/** Backstop on a whole response: one tool answer is already held to 50 KB. */
export const MCP_MAX_RESPONSE_BYTES = AI_RESPONSE_LIMIT_BYTES + 4 * 1024;

/** What a new sign-in asks for by default; the consent screen decides what is actually shared. */
const CHALLENGE_SCOPE = [
  ...oauthScopeNames([...AI_CONNECTION_DEFAULT_LAYERS, 'document_list']),
  'offline_access',
].join(' ');

const NO_STORE = { 'cache-control': 'no-store' } as const;

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code, message }, id },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/**
 * 401 with the RFC 6750 / RFC 9728 challenge. Without a token the challenge carries no error code
 * (RFC 6750 section 3.1); with a bad one it says `invalid_token`, in plain words.
 */
export function mcpChallenge(
  issuer: string,
  error?: { readonly code: 'invalid_token'; readonly description: string },
): Response {
  const parts = [
    ...(error ? [`error="${error.code}"`, `error_description="${error.description}"`] : []),
    `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    `scope="${CHALLENGE_SCOPE}"`,
  ];
  return jsonRpcError(
    401,
    -32001,
    error ? error.description : 'Sign in to VisaStack to connect this app.',
    null,
    { 'www-authenticate': `Bearer ${parts.join(', ')}` },
  );
}

const INVALID_TOKEN = {
  code: 'invalid_token',
  description: 'The access token is invalid, expired or turned off. Sign in again.',
} as const;

/** The bearer token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.trim().match(/^bearer +([A-Za-z0-9._~+/-]+=*)$/i);
  return match?.[1] ?? null;
}

/** Reads at most `limit` bytes; `null` when the body is larger (or unreadable). */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function tooLarge(): Response {
  return jsonRpcError(413, -32600, 'The request is too large.');
}

function requestId(body: unknown): string | number | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

/** One MCP server per request, with the five tools bound to this request's token. */
function buildServer(
  db: Db,
  context: {
    readonly token: string;
    readonly resource: string;
    readonly encryption: KeyManagementPort | undefined;
    readonly onUnauthorized: () => void;
  },
): McpServer {
  const server = new McpServer(
    { name: 'visastack', title: 'VisaStack', version: '1.0.0' },
    {
      instructions:
        'VisaStack holds one person’s own visa record. Every tool only reads what that person chose to share; nothing can be changed. Start with prepare_context.',
    },
  );
  for (const tool of AI_TOOLS as readonly AiToolDefinition[]) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (input: unknown) => {
        const outcome = await runAiTool(db, tool, input as never, {
          token: context.token,
          resource: context.resource,
          ...(context.encryption ? { encryption: context.encryption } : {}),
        });
        if (outcome.kind === 'unauthorized') context.onUnauthorized();
        return { ...outcome.result, content: [...outcome.result.content] };
      },
    );
  }
  return server;
}

/** `POST /mcp`. */
export async function handleMcpPost(
  request: Request,
  deps: McpEndpointDeps = defaults,
): Promise<Response> {
  if (!deps.enabled()) return notFound();
  const issuer = deps.issuer();
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (authorization === '') return mcpChallenge(issuer);
  const token = bearerToken(authorization);
  if (!token) return mcpChallenge(issuer, INVALID_TOKEN);
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MCP_MAX_REQUEST_BYTES) return tooLarge();
  const resource = deps.resource();

  try {
    return await deps.withDb(async (db) => {
      const caller = await authenticateAiRequest(db, { token, resource });
      if (!caller) return mcpChallenge(issuer, INVALID_TOKEN);

      const limit = await checkRateLimits(db, [
        {
          input: { subjectId: caller.connectionId, action: 'ai.mcp_minute', label: 'ai' },
          config: RATE_LIMITS.AI_CONNECTION_MINUTE,
        },
        {
          input: { subjectId: caller.connectionId, action: 'ai.mcp_day', label: 'ai' },
          config: RATE_LIMITS.AI_CONNECTION_DAY,
        },
      ]);
      if (!limit.allowed) {
        return jsonRpcError(429, -32000, 'Too many requests. Try again in a minute.', null, {
          'retry-after': '60',
        });
      }

      const raw = await readLimited(request, MCP_MAX_REQUEST_BYTES);
      if (raw === null) return tooLarge();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return jsonRpcError(400, -32700, 'The request is not valid JSON.');
      }
      // One message per request, so the per-connection limit counts every tool call.
      if (Array.isArray(body)) {
        return jsonRpcError(400, -32600, 'Send one message at a time.');
      }

      let unauthorized = false;
      const server = buildServer(db, {
        token,
        resource,
        encryption: deps.encryption(),
        onUnauthorized: () => {
          unauthorized = true;
        },
      });
      // No session id generator: stateless, every request stands alone.
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request, { parsedBody: body });
        // The connection ended between the first check and the tool call: sign in again.
        if (unauthorized) return mcpChallenge(issuer, INVALID_TOKEN);
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MCP_MAX_RESPONSE_BYTES) {
          return jsonRpcError(
            200,
            -32603,
            'The answer is too large to send. Ask about one case, one section or one document at a time.',
            requestId(body),
          );
        }
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'no-store');
        return new Response(response.status === 204 ? null : text, {
          status: response.status,
          headers,
        });
      } finally {
        await server.close().catch(() => undefined);
      }
    });
  } catch (error) {
    reportServerError('aiContextEndpoint', error, { step: 'request failed' });
    return jsonRpcError(503, -32603, 'VisaStack is not available right now. Try again later.');
  }
}

/** GET, DELETE and anything else: no sessions and no streams in stateless mode. */
export function mcpMethodNotAllowed(deps: Pick<McpEndpointDeps, 'enabled'> = defaults): Response {
  if (!deps.enabled()) return notFound();
  return jsonRpcError(405, -32000, 'Use POST.', null, { allow: 'POST' });
}
