import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(),
  register: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@visastack/services', () => ({
  RATE_LIMITS: { AI_TOKEN_IP: { limit: 600, windowMs: 3_600_000 } },
  checkRateLimit: mocks.limit,
  exchangeAiAuthorizationCode: mocks.exchange,
  refreshAiTokens: mocks.refresh,
  revokeAiToken: mocks.revoke,
  registerAiClient: mocks.register,
  touchAiClient: vi.fn(),
  isMissingRelationError: (error: unknown) => (error as { code?: string })?.code === '42P01',
  AI_OAUTH_SCOPES_SUPPORTED: ['visastack.identity', 'offline_access'],
}));
vi.mock('./public-db', () => ({ withPublicDb: vi.fn() }));
vi.mock('./server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('./base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));

const { handleRegisterRequest, handleRevokeRequest, handleTokenRequest } = await import(
  './oauth-endpoints'
);

const RESOURCE = 'https://vs.example.test/mcp';
const deps = (enabled = true) => ({
  enabled: () => enabled,
  withDb: <T>(work: (db: never) => Promise<T>) => work({} as never),
  resource: () => RESOURCE,
});

function form(body: string, type = 'application/x-www-form-urlencoded') {
  return new Request('https://vs.example.test/oauth/token', {
    method: 'POST',
    headers: { 'content-type': type },
    body,
  });
}

const CODE_BODY = new URLSearchParams({
  grant_type: 'authorization_code',
  code: 'vsc_code_x',
  code_verifier: 'v'.repeat(43),
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
  resource: RESOURCE,
}).toString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue({ allowed: true });
});

describe('the token endpoint', () => {
  it('answers "not found" while the connector is off', async () => {
    expect((await handleTokenRequest(form(CODE_BODY), deps(false))).status).toBe(404);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('accepts a form-encoded code exchange and never lets the answer be cached', async () => {
    mocks.exchange.mockResolvedValue({
      ok: true,
      value: {
        access_token: 'vsa_a',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'vsr_r',
        scope: 'offline_access',
      },
    });
    const response = await handleTokenRequest(form(CODE_BODY), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.exchange.mock.calls[0]?.[1]).toMatchObject({
      codeVerifier: 'v'.repeat(43),
      resource: RESOURCE,
    });
  });

  it('refuses JSON, a repeated parameter, a client secret and a missing or wrong resource', async () => {
    expect((await handleTokenRequest(form(CODE_BODY, 'application/json'), deps())).status).toBe(
      400,
    );
    expect((await handleTokenRequest(form(`${CODE_BODY}&code=again`), deps())).status).toBe(400);
    const secret = await handleTokenRequest(form(`${CODE_BODY}&client_secret=s`), deps());
    expect(secret.status).toBe(401);
    expect(await secret.json()).toMatchObject({ error: 'invalid_client' });
    const noResource = CODE_BODY.replace(/&resource=[^&]*/, '');
    expect(await (await handleTokenRequest(form(noResource), deps())).json()).toMatchObject({
      error: 'invalid_target',
    });
    const wrong = CODE_BODY.replace(
      encodeURIComponent(RESOURCE),
      encodeURIComponent('https://evil.example/mcp'),
    );
    expect(await (await handleTokenRequest(form(wrong), deps())).json()).toMatchObject({
      error: 'invalid_target',
    });
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('passes the store refusal through with its RFC 6749 code', async () => {
    mocks.exchange.mockResolvedValue({
      ok: false,
      error: { error: 'invalid_grant', description: 'the code is invalid, used or expired' },
    });
    const response = await handleTokenRequest(form(CODE_BODY), deps());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'the code is invalid, used or expired',
    });
  });

  it('rotates on refresh, refuses unknown grants and slows a flood down', async () => {
    mocks.refresh.mockResolvedValue({ ok: true, value: { access_token: 'vsa_b' } });
    const refresh = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'vsr_old',
      client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
    }).toString();
    expect((await handleTokenRequest(form(refresh), deps())).status).toBe(200);
    const password = new URLSearchParams({ grant_type: 'password', client_id: 'x' }).toString();
    expect(await (await handleTokenRequest(form(password), deps())).json()).toMatchObject({
      error: 'unsupported_grant_type',
    });
    mocks.limit.mockResolvedValue({ allowed: false, reason: 'x' });
    expect((await handleTokenRequest(form(refresh), deps())).status).toBe(429);
  });
});

describe('revocation and registration', () => {
  it('revokes with a 200 whether or not the token was known', async () => {
    mocks.revoke.mockResolvedValue({ ok: true, value: undefined });
    const response = await handleRevokeRequest(form('token=vsa_unknown'), deps());
    expect(response.status).toBe(200);
  });

  it('registers from JSON only, and answers 503 while the table is missing', async () => {
    const json = (body: unknown) =>
      new Request('https://vs.example.test/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    mocks.register.mockResolvedValue({ ok: true, value: { client_id: 'vsc_x' } });
    expect((await handleRegisterRequest(json({ redirect_uris: ['x'] }), deps())).status).toBe(201);
    expect((await handleRegisterRequest(form('a=b'), deps())).status).toBe(400);
    mocks.register.mockRejectedValue(Object.assign(new Error('missing'), { code: '42P01' }));
    expect((await handleRegisterRequest(json({ redirect_uris: ['x'] }), deps())).status).toBe(503);
  });
});
