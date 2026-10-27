import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientMetadataDeps,
  LOOPBACK_CLIENT_HOST,
  SUPPORTED_AI_APPS,
  clearClientMetadataCache,
  deleteStaleAiClients,
  fetchClientMetadataDocument,
  isLoopbackRedirect,
  isPublicAddress,
  redirectMatches,
  registerAiClient,
  resolveAiClient,
  touchAiClient,
} from './ai-clients';
import type { Db } from './db';

const CHATGPT_ID = 'https://chatgpt.com/oauth/client.json';
const CLAUDE_CODE_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const CHATGPT_CALLBACK_ID = 'https://chatgpt.com/oauth/abc123/client.json';
const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const DAY_MS = 24 * 60 * 60 * 1000;

function jsonResponse(body: unknown, init: { status?: number; contentType?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  });
}

function chatgptDocument(clientId: string = CHATGPT_CALLBACK_ID) {
  return {
    client_id: clientId,
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/connector/oauth/abc123'],
    token_endpoint_auth_method: 'none',
  };
}

/** Deps with a fake public DNS answer and a fake fetch; nothing reaches the network. */
function fakeDeps(
  respond: (url: string, init: RequestInit | undefined) => Promise<Response> | Response,
  overrides: Partial<ClientMetadataDeps> = {},
) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    respond(String(input), init),
  );
  const lookupMock = vi.fn(async (_host: string): Promise<readonly string[]> => ['104.18.32.47']);
  const deps: ClientMetadataDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    lookup: lookupMock,
    ...overrides,
  };
  return { deps, fetchMock, lookupMock };
}

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

beforeEach(() => {
  clearClientMetadataCache();
});

describe('SUPPORTED_AI_APPS', () => {
  it('lists Claude and ChatGPT with their published hosts', () => {
    expect(SUPPORTED_AI_APPS.map((app) => app.key)).toEqual(['claude', 'chatgpt']);
    expect(SUPPORTED_AI_APPS[0].redirectHosts).toEqual(['claude.ai', 'claude.com']);
    expect(SUPPORTED_AI_APPS[1].hosts).toEqual(['chatgpt.com']);
  });
});

describe('fetchClientMetadataDocument', () => {
  it('accepts a valid document from an allowlisted host', async () => {
    const { deps, fetchMock } = fakeDeps(() => jsonResponse(chatgptDocument()));
    const result = await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps);
    expect(result).toEqual({
      ok: true,
      value: {
        clientId: CHATGPT_CALLBACK_ID,
        clientName: 'ChatGPT',
        appKey: 'chatgpt',
        host: 'chatgpt.com',
        redirectUris: ['https://chatgpt.com/connector/oauth/abc123'],
        source: 'metadata_document',
        loopbackOnly: false,
      },
    });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses an unknown host before any lookup or fetch', async () => {
    const { deps, fetchMock, lookupMock } = fakeDeps(() => jsonResponse({}));
    const result = await fetchClientMetadataDocument('https://evil.example/client.json', deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported_app' } });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['http://chatgpt.com/oauth/client.json', 'not https'],
    ['https://chatgpt.com/', 'no path'],
    ['https://chatgpt.com', 'no path'],
    ['https://user@chatgpt.com/oauth/client.json', 'userinfo'],
    ['https://chatgpt.com/oauth/client.json#x', 'fragment'],
    ['https://chatgpt.com:8443/oauth/client.json', 'port'],
    ['https://chatgpt.com/oauth/../client.json', 'dot segment'],
  ])('refuses the malformed client id %s (%s) without fetching', async (clientId) => {
    const { deps, fetchMock, lookupMock } = fakeDeps(() => jsonResponse({}));
    const result = await fetchClientMetadataDocument(clientId, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_client' } });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1',
    '240.0.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
  ])('refuses a host resolving to the non-public address %s', async (address) => {
    const { deps, fetchMock } = fakeDeps(() => jsonResponse(chatgptDocument()), {
      lookup: async () => ['104.18.32.47', address],
    });
    const result = await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'unreachable' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not use a pinned copy when the host resolves to a non-public address', async () => {
    const { deps, fetchMock } = fakeDeps(() => jsonResponse({}), {
      lookup: async () => ['127.0.0.1'],
    });
    const result = await fetchClientMetadataDocument(CHATGPT_ID, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'unreachable' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies public and non-public addresses', () => {
    for (const address of ['104.18.32.47', '8.8.8.8', '2606:4700::6812:2001', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address)).toBe(true);
    }
    for (const address of [
      'fc00::1',
      '2001:db8::1',
      '64:ff9b::a00:1',
      '2002:a00:1::1',
      'nonsense',
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  it('refuses a redirect without following it', async () => {
    const { deps, fetchMock } = fakeDeps(
      () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    const result = await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'unreachable' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a body larger than 64 KiB and stops reading it', async () => {
    let pulls = 0;
    const chunk = new Uint8Array(16 * 1024).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { deps } = fakeDeps(
      () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'unreachable' } });
    expect(pulls).toBeLessThan(10);
  });

  it('refuses a body whose declared length is over 64 KiB', async () => {
    const { deps } = fakeDeps(
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': String(70 * 1024) },
        }),
    );
    const result = await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'unreachable' } });
  });

  it('refuses a non-JSON content type and an unparseable body', async () => {
    const html = fakeDeps(() => jsonResponse(chatgptDocument(), { contentType: 'text/html' }));
    expect(await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, html.deps)).toMatchObject({
      ok: false,
      error: { code: 'unreachable' },
    });
    const broken = fakeDeps(
      () => new Response('{not json', { headers: { 'content-type': 'application/json' } }),
    );
    expect(await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, broken.deps)).toMatchObject({
      ok: false,
      error: { code: 'unreachable' },
    });
  });

  it('accepts +json content types with a charset', async () => {
    const { deps } = fakeDeps(() =>
      jsonResponse(chatgptDocument(), {
        contentType: 'application/oauth-client+json; charset=utf-8',
      }),
    );
    expect((await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps)).ok).toBe(true);
  });

  it('falls back to the pinned ChatGPT and Claude Code documents on a timeout, only for their exact URLs', async () => {
    const timingOut = () => fakeDeps(() => Promise.reject(timeoutError()));
    const chatgpt = await fetchClientMetadataDocument(CHATGPT_ID, timingOut().deps);
    expect(chatgpt).toMatchObject({
      ok: true,
      value: {
        clientId: CHATGPT_ID,
        clientName: 'ChatGPT',
        appKey: 'chatgpt',
        source: 'pinned',
        redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        loopbackOnly: false,
      },
    });
    const claudeCode = await fetchClientMetadataDocument(CLAUDE_CODE_ID, timingOut().deps);
    expect(claudeCode).toMatchObject({
      ok: true,
      value: {
        clientId: CLAUDE_CODE_ID,
        clientName: 'Claude Code',
        appKey: 'claude',
        host: 'claude.ai',
        source: 'pinned',
        redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
        loopbackOnly: true,
      },
    });
    for (const other of [
      CHATGPT_CALLBACK_ID,
      `${CHATGPT_ID}?x=1`,
      'https://claude.com/oauth/claude-code-client-metadata',
    ]) {
      expect(await fetchClientMetadataDocument(other, timingOut().deps)).toMatchObject({
        ok: false,
        error: { code: 'unreachable' },
      });
    }
  });

  it('falls back to the pinned copy when bot protection answers 403', async () => {
    const { deps } = fakeDeps(() => new Response('blocked', { status: 403 }));
    expect(await fetchClientMetadataDocument(CHATGPT_ID, deps)).toMatchObject({
      ok: true,
      value: { source: 'pinned' },
    });
  });

  it('prefers a successfully fetched document over the pinned copy', async () => {
    const live = { ...chatgptDocument(CHATGPT_ID), client_name: 'ChatGPT Live' };
    const { deps } = fakeDeps(() => jsonResponse(live));
    expect(await fetchClientMetadataDocument(CHATGPT_ID, deps)).toMatchObject({
      ok: true,
      value: { clientName: 'ChatGPT Live', source: 'metadata_document' },
    });
  });

  it('refuses a document whose client_id differs from its URL, without falling back', async () => {
    const { deps } = fakeDeps(() =>
      jsonResponse(chatgptDocument('https://chatgpt.com/other.json')),
    );
    expect(await fetchClientMetadataDocument(CHATGPT_ID, deps)).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
  });

  it('refuses a document listing an https redirect host outside the app allowlist', async () => {
    const document = { ...chatgptDocument(), redirect_uris: ['https://attacker.example/cb'] };
    const { deps } = fakeDeps(() => jsonResponse(document));
    expect(await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps)).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
    // Another supported app's host is still outside this app's own list.
    const crossApp = { ...chatgptDocument(), redirect_uris: [CLAUDE_REDIRECT] };
    const second = fakeDeps(() => jsonResponse(crossApp));
    expect(await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, second.deps)).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
    // A page on the app's own host that is not its published sign-in return path.
    clearClientMetadataCache();
    const otherPage = { ...chatgptDocument(), redirect_uris: ['https://chatgpt.com/some/page'] };
    const third = fakeDeps(() => jsonResponse(otherPage));
    expect(await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, third.deps)).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
  });

  it('refuses a confidential client document', async () => {
    const document = { ...chatgptDocument(), token_endpoint_auth_method: 'client_secret_basic' };
    const { deps } = fakeDeps(() => jsonResponse(document));
    expect(await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps)).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
  });

  it('cleans the client name and falls back to the app name', async () => {
    const hidden = `Chat${String.fromCodePoint(0x202e)}GPT${String.fromCodePoint(0x07)} ${'x'.repeat(100)}`;
    const named = fakeDeps(() => jsonResponse({ ...chatgptDocument(), client_name: hidden }));
    const result = await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, named.deps);
    if (!result.ok) throw new Error('expected a client');
    expect(result.value.clientName.startsWith('ChatGPT x')).toBe(true);
    expect(result.value.clientName.length).toBe(80);
    clearClientMetadataCache();
    const unnamed = fakeDeps(() => jsonResponse({ ...chatgptDocument(), client_name: 42 }));
    const second = await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, unnamed.deps);
    expect(second).toMatchObject({ ok: true, value: { clientName: 'ChatGPT' } });
  });

  it('reuses a cached document within 24 hours and fetches again after', async () => {
    const start = new Date('2026-10-27T10:00:00Z');
    let now = start;
    const { deps, fetchMock } = fakeDeps(() => jsonResponse(chatgptDocument()), { now: () => now });
    expect((await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps)).ok).toBe(true);
    now = new Date(start.getTime() + DAY_MS - 1000);
    expect((await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now = new Date(start.getTime() + DAY_MS + 1000);
    expect((await fetchClientMetadataDocument(CHATGPT_CALLBACK_ID, deps)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses a pinned fallback for ten minutes only, then tries the live document again', async () => {
    let now = Date.parse('2026-10-27T10:00:00Z');
    const { deps, fetchMock } = fakeDeps(() => Promise.reject(timeoutError()));
    const timed = { ...deps, now: () => new Date(now) };
    await fetchClientMetadataDocument(CHATGPT_ID, timed);
    await fetchClientMetadataDocument(CHATGPT_ID, timed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 10 * 60 * 1000 + 1;
    await fetchClientMetadataDocument(CHATGPT_ID, timed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('redirect matching', () => {
  it('recognises loopback redirects only', () => {
    expect(isLoopbackRedirect('http://localhost:5555/callback')).toBe(true);
    expect(isLoopbackRedirect('http://127.0.0.1/callback')).toBe(true);
    expect(isLoopbackRedirect('https://localhost/callback')).toBe(false);
    expect(isLoopbackRedirect('http://user@localhost/callback')).toBe(false);
    expect(isLoopbackRedirect('http://localhost/callback#x')).toBe(false);
    expect(isLoopbackRedirect('http://localhost.example.com/callback')).toBe(false);
    expect(isLoopbackRedirect('http://[::1]/callback')).toBe(false);
  });

  it('matches https redirects exactly', () => {
    expect(redirectMatches([CLAUDE_REDIRECT], CLAUDE_REDIRECT)).toBe(true);
    expect(redirectMatches([CLAUDE_REDIRECT], `${CLAUDE_REDIRECT}/`)).toBe(false);
    expect(redirectMatches([CLAUDE_REDIRECT], `${CLAUDE_REDIRECT}?a=1`)).toBe(false);
    expect(redirectMatches([CLAUDE_REDIRECT], 'https://claude.com/api/mcp/auth_callback')).toBe(
      false,
    );
  });

  it('matches loopback on any port for localhost and 127.0.0.1', () => {
    const registered = ['http://localhost/callback', 'http://127.0.0.1/callback'];
    expect(redirectMatches(registered, 'http://localhost:49152/callback')).toBe(true);
    expect(redirectMatches(registered, 'http://127.0.0.1:8080/callback')).toBe(true);
    expect(redirectMatches(registered, 'http://localhost/callback')).toBe(true);
    expect(redirectMatches(['http://localhost:3000/cb?x=1'], 'http://localhost:4000/cb?x=1')).toBe(
      true,
    );
  });

  it('refuses loopback with a different path, query or host', () => {
    const registered = ['http://localhost/callback'];
    expect(redirectMatches(registered, 'http://localhost:1234/other')).toBe(false);
    expect(redirectMatches(registered, 'http://localhost:1234/callback?x=1')).toBe(false);
    expect(redirectMatches(registered, 'http://127.0.0.1:1234/callback')).toBe(false);
    expect(redirectMatches(registered, 'http://localhost:1234/x/../callback')).toBe(false);
  });

  it('refuses unregistered hosts, fragments, userinfo and other schemes', () => {
    expect(
      redirectMatches([CLAUDE_REDIRECT], 'https://attacker.example/api/mcp/auth_callback'),
    ).toBe(false);
    expect(redirectMatches([CLAUDE_REDIRECT], `${CLAUDE_REDIRECT}#frag`)).toBe(false);
    expect(redirectMatches([`${CLAUDE_REDIRECT}#frag`], `${CLAUDE_REDIRECT}#frag`)).toBe(false);
    expect(
      redirectMatches(['http://localhost/callback'], 'http://localhost:1234/callback#frag'),
    ).toBe(false);
    expect(redirectMatches(['https://a@claude.ai/cb'], 'https://a@claude.ai/cb')).toBe(false);
    expect(redirectMatches(['http://claude.ai/cb'], 'http://claude.ai/cb')).toBe(false);
    expect(redirectMatches(['javascript:alert(1)'], 'javascript:alert(1)')).toBe(false);
  });
});

describe('dynamic client registration', () => {
  let db: Db;

  beforeEach(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
  });

  const NOW = new Date('2026-10-27T10:00:00Z');

  async function register(body: unknown, ipSubject = 'ip-1', now = NOW) {
    return registerAiClient(db, { body, ipSubject, now });
  }

  it('accepts only the published sign-in return paths on an app host', async () => {
    for (const uri of [
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://chatgpt.com/connector/oauth/abc_123',
      'https://claude.com/api/mcp/auth_callback',
    ]) {
      expect((await register({ redirect_uris: [uri] }, `ok-${uri}`)).ok, uri).toBe(true);
    }
    for (const uri of [
      'https://chatgpt.com/some/page',
      'https://chatgpt.com/connector/oauth/abc/../x',
      'https://claude.ai/api/mcp/auth_callback?next=x',
      'https://claude.ai/',
    ]) {
      const refused = await register({ redirect_uris: [uri] }, `no-${uri}`);
      expect(!refused.ok && refused.error.error, uri).toBe('invalid_redirect_uri');
    }
  });

  it('registers a public client and returns the RFC 7591 response', async () => {
    const result = await register({
      client_name: 'Claude',
      redirect_uris: [CLAUDE_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    if (!result.ok) throw new Error(result.error.error_description);
    expect(result.value.client_id).toMatch(/^vsc_[A-Za-z0-9_-]{43}$/);
    expect(result.value).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [CLAUDE_REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(NOW.getTime() / 1000),
    });
    const resolved = await resolveAiClient(db, result.value.client_id, { now: () => NOW });
    expect(resolved).toEqual({
      ok: true,
      value: {
        clientId: result.value.client_id,
        clientName: 'Claude',
        appKey: 'claude',
        host: 'claude.ai',
        redirectUris: [CLAUDE_REDIRECT],
        source: 'registered',
        loopbackOnly: false,
      },
    });
  });

  it('refuses a confidential client', async () => {
    const result = await register({
      redirect_uris: [CLAUDE_REDIRECT],
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(result).toMatchObject({ ok: false, error: { error: 'invalid_client_metadata' } });
  });

  it('refuses a non-allowlisted https redirect and plain http elsewhere', async () => {
    for (const uri of [
      'https://attacker.example/cb',
      'http://claude.ai/cb',
      'https://claude.ai:8443/cb',
    ]) {
      expect(await register({ redirect_uris: [uri] })).toMatchObject({
        ok: false,
        error: { error: 'invalid_redirect_uri' },
      });
    }
    expect(await register({})).toMatchObject({
      ok: false,
      error: { error: 'invalid_redirect_uri' },
    });
    expect(await register({ redirect_uris: [] })).toMatchObject({
      ok: false,
      error: { error: 'invalid_redirect_uri' },
    });
  });

  it('refuses unsupported grant or response types', async () => {
    expect(
      await register({ redirect_uris: [CLAUDE_REDIRECT], grant_types: ['client_credentials'] }),
    ).toMatchObject({ ok: false, error: { error: 'invalid_client_metadata' } });
    expect(
      await register({ redirect_uris: [CLAUDE_REDIRECT], response_types: ['token'] }),
    ).toMatchObject({ ok: false, error: { error: 'invalid_client_metadata' } });
  });

  it('accepts a loopback-only client and marks it for the warning', async () => {
    const result = await register({ redirect_uris: ['http://127.0.0.1:33418/callback'] });
    if (!result.ok) throw new Error(result.error.error_description);
    expect(result.value.client_name).toBe('AI App');
    const resolved = await resolveAiClient(db, result.value.client_id, { now: () => NOW });
    expect(resolved).toMatchObject({
      ok: true,
      value: { host: LOOPBACK_CLIENT_HOST, appKey: null, loopbackOnly: true },
    });
  });

  it('enforces the rate limit per network address', async () => {
    const body = { redirect_uris: [CLAUDE_REDIRECT] };
    for (let index = 0; index < 10; index += 1) {
      expect((await register(body, 'ip-busy')).ok).toBe(true);
    }
    expect(await register(body, 'ip-busy')).toMatchObject({
      ok: false,
      error: { error: 'rate_limited' },
    });
    expect((await register(body, 'ip-other')).ok).toBe(true);
  });

  it('forgets a registered client unused for 31 days', async () => {
    const created = new Date(NOW.getTime() - 31 * DAY_MS);
    const result = await register({ redirect_uris: [CLAUDE_REDIRECT] }, 'ip-1', created);
    if (!result.ok) throw new Error(result.error.error_description);
    expect(await resolveAiClient(db, result.value.client_id, { now: () => NOW })).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
    expect(await deleteStaleAiClients(db, NOW)).toBe(1);
  });

  it('keeps a client in use, touching it at most once a minute', async () => {
    const created = new Date(NOW.getTime() - 29 * DAY_MS);
    const result = await register({ redirect_uris: [CLAUDE_REDIRECT] }, 'ip-1', created);
    if (!result.ok) throw new Error(result.error.error_description);
    const clientId = result.value.client_id;
    await touchAiClient(db, clientId, NOW);
    await touchAiClient(db, clientId, new Date(NOW.getTime() + 30 * 1000));
    const [row] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, clientId));
    expect(row?.lastUsedAt?.toISOString()).toBe(NOW.toISOString());
    const later = new Date(NOW.getTime() + 20 * DAY_MS);
    expect((await resolveAiClient(db, clientId, { now: () => later })).ok).toBe(true);
    expect(await deleteStaleAiClients(db, later)).toBe(0);
  });

  it('refuses an unknown or malformed registered id without a network call', async () => {
    const { deps, fetchMock } = fakeDeps(() => jsonResponse({}));
    expect(await resolveAiClient(db, `vsc_${'a'.repeat(43)}`, deps)).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
    expect(await resolveAiClient(db, 'vsc_short', deps)).toMatchObject({
      ok: false,
      error: { code: 'invalid_client' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
