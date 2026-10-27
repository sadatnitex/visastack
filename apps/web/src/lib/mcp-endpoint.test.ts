import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  limits: vi.fn(),
  run: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@visastack/services', async (importActual) => {
  const actual = await importActual<typeof import('@visastack/services')>();
  return {
    ...actual,
    authenticateAiRequest: mocks.authenticate,
    checkRateLimits: mocks.limits,
    runAiTool: mocks.run,
  };
});
vi.mock('./public-db', () => ({ withPublicDb: vi.fn() }));
vi.mock('./providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('./server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('./base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));

const { MCP_MAX_REQUEST_BYTES, bearerToken, handleMcpPost, mcpMethodNotAllowed } = await import(
  './mcp-endpoint'
);
const { RATE_LIMITS } = await import('@visastack/services');

const ISSUER = 'https://vs.example.test';
const RESOURCE = `${ISSUER}/mcp`;
const TOKEN = `vsa_${'a'.repeat(43)}`;
const deps = (enabled = true) => ({
  enabled: () => enabled,
  withDb: <T>(work: (db: never) => Promise<T>) => work({} as never),
  resource: () => RESOURCE,
  issuer: () => ISSUER,
  encryption: () => undefined,
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(RESOURCE, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
};
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const callTool = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name, arguments: args },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ connectionId: 'conn-1', clientHost: 'claude.ai' });
  mocks.limits.mockResolvedValue({ allowed: true });
  mocks.run.mockResolvedValue({
    kind: 'answered',
    result: {
      content: [{ type: 'text', text: 'One case.' }],
      structuredContent: { cases: [], casesNotShown: 0 },
    },
  });
});

describe('the AI context address: switch and methods', () => {
  it('answers "not found" to everything while the connector is off', async () => {
    expect((await handleMcpPost(post(INITIALIZE), deps(false))).status).toBe(404);
    expect(mcpMethodNotAllowed({ enabled: () => false }).status).toBe(404);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('answers 405 to GET and DELETE: stateless, POST only', () => {
    const response = mcpMethodNotAllowed({ enabled: () => true });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('the AI context address: sign-in challenge', () => {
  it('without a token, points the app at the sign-in metadata (RFC 9728) with the scope', async () => {
    const response = await handleMcpPost(post(INITIALIZE, { authorization: '' }), deps());
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource", scope="visastack.identity visastack.travel_documents visastack.document_list offline_access"`,
    );
    expect(challenge).not.toContain('error=');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('with a dead token, says invalid_token in plain words', async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await handleMcpPost(post(INITIALIZE), deps());
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(
      /^Bearer error="invalid_token", error_description="[^"]+", resource_metadata="https:\/\/vs\.example\.test\/\.well-known\/oauth-protected-resource", scope="[^"]+"$/,
    );
    expect(mocks.authenticate).toHaveBeenCalledWith({}, { token: TOKEN, resource: RESOURCE });
  });

  it('treats a header that is not a bearer token as a dead token', async () => {
    const response = await handleMcpPost(post(INITIALIZE, { authorization: 'Basic abc' }), deps());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(bearerToken('bearer  abc.def')).toBe('abc.def');
    expect(bearerToken('Bearer a b')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('asks for a new sign-in when the connection ends during the call', async () => {
    mocks.run.mockResolvedValue({
      kind: 'unauthorized',
      result: { content: [{ type: 'text', text: 'ended' }], isError: true },
    });
    const response = await handleMcpPost(post(callTool('list_cases')), deps());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});

describe('the AI context address: limits', () => {
  it('refuses a body over 64 KB, declared or streamed (413)', async () => {
    const declared = await handleMcpPost(
      post(INITIALIZE, { 'content-length': String(MCP_MAX_REQUEST_BYTES + 1) }),
      deps(),
    );
    expect(declared.status).toBe(413);
    const huge = { ...INITIALIZE, params: { ...INITIALIZE.params, pad: 'x'.repeat(70_000) } };
    const streamed = await handleMcpPost(post(huge), deps());
    expect(streamed.status).toBe(413);
  });

  it('limits each connection to 60 a minute and 2,000 a day (429)', async () => {
    mocks.limits.mockResolvedValue({ allowed: false, reason: 'too many' });
    const response = await handleMcpPost(post(INITIALIZE), deps());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    const [, checks] = mocks.limits.mock.calls[0] ?? [];
    expect(checks).toEqual([
      {
        input: { subjectId: 'conn-1', action: 'ai.mcp_minute', label: 'ai' },
        config: RATE_LIMITS.AI_CONNECTION_MINUTE,
      },
      {
        input: { subjectId: 'conn-1', action: 'ai.mcp_day', label: 'ai' },
        config: RATE_LIMITS.AI_CONNECTION_DAY,
      },
    ]);
    expect(RATE_LIMITS.AI_CONNECTION_MINUTE).toEqual({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.AI_CONNECTION_DAY).toEqual({ limit: 2_000, windowMs: 86_400_000 });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter itself fails', async () => {
    mocks.limits.mockRejectedValue(new Error('database down'));
    const response = await handleMcpPost(post(callTool('list_cases')), deps());
    expect(response.status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('database down');
  });

  it('replaces an oversized answer with a plain error instead of cutting it', async () => {
    mocks.run.mockResolvedValue({
      kind: 'answered',
      result: {
        content: [{ type: 'text', text: 'x'.repeat(80_000) }],
        structuredContent: { cases: [], casesNotShown: 0 },
      },
    });
    const response = await handleMcpPost(post(callTool('list_cases')), deps());
    const body = (await response.json()) as { id: number; error: { message: string } };
    expect(body.id).toBe(3);
    expect(body.error.message).toMatch(/too large/);
  });

  it('refuses a batch, so the limit counts every tool call', async () => {
    const response = await handleMcpPost(
      post([callTool('list_cases'), callTool('list_cases')]),
      deps(),
    );
    expect(response.status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('answers a body that is not JSON with a parse error', async () => {
    const response = await handleMcpPost(post('{not json'), deps());
    expect(response.status).toBe(400);
  });
});

describe('the AI context address: protocol', () => {
  it('initializes statelessly with JSON and no session id', async () => {
    const response = await handleMcpPost(post(INITIALIZE), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('mcp-session-id')).toBeNull();
    const body = (await response.json()) as {
      result: { serverInfo: { name: string }; capabilities: { tools?: object } };
    };
    expect(body.result.serverInfo.name).toBe('visastack');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('lists the five tools with titles, read-only annotations and output schemas', async () => {
    const response = await handleMcpPost(post(LIST), deps());
    const body = (await response.json()) as {
      result: {
        tools: {
          name: string;
          title: string;
          annotations: Record<string, boolean>;
          outputSchema?: { type: string };
          inputSchema: { type: string };
        }[];
      };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual([
      'prepare_context',
      'list_cases',
      'get_profile_section',
      'list_documents',
      'get_document_text',
    ]);
    for (const t of body.result.tools) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(t.outputSchema?.type).toBe('object');
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('runs a tool through the gate with this request token and resource', async () => {
    const response = await handleMcpPost(post(callTool('list_cases')), deps());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { structuredContent: unknown; content: { text: string }[] };
    };
    expect(body.result.structuredContent).toEqual({ cases: [], casesNotShown: 0 });
    const [, definition, , request] = mocks.run.mock.calls[0] ?? [];
    expect((definition as { name: string }).name).toBe('list_cases');
    expect(request).toMatchObject({ token: TOKEN, resource: RESOURCE });
  });

  it('refuses tool input outside the schema without running the tool', async () => {
    const response = await handleMcpPost(
      post(callTool('get_profile_section', { section: 'special_category' })),
      deps(),
    );
    const body = (await response.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.result?.isError ?? body.error !== undefined).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('never shows an internal error to the app', async () => {
    const response = await handleMcpPost(post(INITIALIZE), {
      ...deps(),
      withDb: async () => {
        throw new Error('connection refused at 10.0.0.5');
      },
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('10.0.0.5');
  });
});
