import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  resolveAiClient: mocks.resolve,
}));
const { checkAuthorizeRequest } = await import('./oauth-authorize');
const { authorizationServerMetadata, protectedResourceMetadata } = await import('./ai-connector');

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const challenge = createHash('sha256')
  .update(randomBytes(32).toString('base64url'))
  .digest('base64url');
const base = {
  response_type: 'code',
  client_id: 'https://claude.ai/oauth/x',
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  resource: 'https://vs.example.test/mcp',
  state: 'abc',
};

beforeEach(() => {
  mocks.resolve.mockResolvedValue({
    ok: true,
    value: {
      clientId: base.client_id,
      clientName: 'Claude',
      host: 'claude.ai',
      redirectUris: [REDIRECT, 'http://localhost/callback'],
      loopbackOnly: false,
    },
  });
});

const db = {} as never;

describe('checking an authorization request', () => {
  it('accepts a complete PKCE S256 request for the VisaStack resource', async () => {
    const check = await checkAuthorizeRequest(db, base);
    expect(check.kind).toBe('ok');
  });

  it('never redirects to an unknown app or a return address the app did not list', async () => {
    mocks.resolve.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unsupported_app', message: 'x' },
    });
    expect(await checkAuthorizeRequest(db, base)).toEqual({
      kind: 'refuse',
      reason: 'unsupported_app',
    });
    expect(
      await checkAuthorizeRequest(db, { ...base, redirect_uri: 'https://evil.example/cb' }),
    ).toEqual({ kind: 'refuse', reason: 'invalid_link' });
  });

  it('accepts a loopback return address on any port, and then shows the computer warning', async () => {
    const check = await checkAuthorizeRequest(db, {
      ...base,
      redirect_uri: 'http://localhost:3118/callback',
    });
    if (check.kind !== 'ok') throw new Error('expected ok');
    // The app also listed claude.ai, but this code goes to the computer: that is what is shown.
    expect(check.request.client).toMatchObject({ host: 'this computer', loopback: true });
  });

  it('never trusts a self-registered app name: it shows the app the code really goes to', async () => {
    mocks.resolve.mockResolvedValueOnce({
      ok: true,
      value: {
        clientId: 'vsc_x',
        clientName: 'Claude',
        host: 'claude.ai',
        redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        loopbackOnly: false,
        source: 'registered',
      },
    });
    const check = await checkAuthorizeRequest(db, {
      ...base,
      client_id: 'vsc_x',
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    });
    if (check.kind !== 'ok') throw new Error('expected ok');
    expect(check.request.client).toMatchObject({ clientName: 'ChatGPT', host: 'chatgpt.com' });
  });

  it('sends later problems back to the app with state and iss', async () => {
    for (const [change, error] of [
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://evil.example/mcp' }, 'invalid_target'],
    ] as const) {
      const check = await checkAuthorizeRequest(db, { ...base, ...change });
      if (check.kind !== 'redirect') throw new Error(`expected a redirect for ${error}`);
      const url = new URL(check.url);
      expect(url.origin + url.pathname).toBe(REDIRECT);
      expect(url.searchParams.get('error')).toBe(error);
      expect(url.searchParams.get('state')).toBe('abc');
      expect(url.searchParams.get('iss')).toBe('https://vs.example.test');
    }
  });
});

describe('discovery documents', () => {
  it('advertise what Claude and ChatGPT check before using a client document', () => {
    const metadata = authorizationServerMetadata();
    expect(metadata.issuer).toBe('https://vs.example.test');
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    expect(metadata.scopes_supported).toContain('offline_access');
    expect(metadata.registration_endpoint).toBe('https://vs.example.test/oauth/register');
    expect(protectedResourceMetadata()).toMatchObject({
      resource: 'https://vs.example.test/mcp',
      authorization_servers: ['https://vs.example.test'],
    });
  });
});
