import { describe, expect, it, vi } from 'vitest';
import {
  SOURCE_CHECK_USER_AGENT,
  type SourceFetchRequest,
  createSourceFetcher,
  parseSourceUrl,
} from './source-fetch';

/**
 * The official-source fetcher's safety rules, with a fake network: every address, answer and
 * delay here is synthetic.
 */

const PUBLIC = ['93.184.216.34'];
const REGISTERED = 'https://visas.synthetic-gov.example/visit/apply';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeNetwork(handler: Handler, lookup: (host: string) => readonly string[] = () => PUBLIC) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  const fetcher = createSourceFetcher({
    fetch: fetchImpl as unknown as typeof fetch,
    lookup: async (host) => lookup(host),
    timeoutMs: 200,
    maxBytes: 1024,
  });
  return { fetcher, calls };
}

const request = (overrides: Partial<SourceFetchRequest> = {}): SourceFetchRequest => ({
  url: REGISTERED,
  etag: null,
  lastModified: null,
  ...overrides,
});

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });

describe('parseSourceUrl', () => {
  it('accepts only a plain https address on a named public-looking host', () => {
    expect(parseSourceUrl(REGISTERED)?.hostname).toBe('visas.synthetic-gov.example');
    for (const bad of [
      'http://visas.synthetic-gov.example/',
      'https://93.184.216.34/',
      'https://[2606:2800:220:1::]/',
      'https://visas.synthetic-gov.example:8443/',
      'https://user:pass@visas.synthetic-gov.example/',
      'https://localhost/',
      'https://intranet/',
      'ftp://visas.synthetic-gov.example/',
      'not an address',
      '',
    ]) {
      expect(parseSourceUrl(bad), bad).toBeNull();
    }
  });
});

describe('createSourceFetcher', () => {
  it('reads an HTML page with a plain user agent and never follows redirects on its own', async () => {
    const { fetcher, calls } = fakeNetwork(() => html('<p>Rule</p>', { etag: '"v1"' }));
    const result = await fetcher(request());
    expect(result.outcome).toBe('FETCHED');
    expect(result.httpStatus).toBe(200);
    expect(result.etag).toBe('"v1"');
    expect(result.body?.kind).toBe('html');
    expect(result.body?.text).toBe('<p>Rule</p>');
    expect(result.body?.byteLength).toBe(11);
    expect(result.body?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const init = calls[0]?.init;
    expect(init?.redirect).toBe('manual');
    expect((init?.headers as Record<string, string>)['user-agent']).toBe(SOURCE_CHECK_USER_AGENT);
  });

  it('asks conditionally and records 304 as not modified, carrying the known tags forward', async () => {
    const { fetcher, calls } = fakeNetwork(() => new Response(null, { status: 304 }));
    const result = await fetcher(
      request({ etag: '"v1"', lastModified: 'Sat, 31 Oct 2026 03:00:00 GMT' }),
    );
    expect(result).toMatchObject({
      outcome: 'NOT_MODIFIED',
      httpStatus: 304,
      etag: '"v1"',
      body: null,
    });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('"v1"');
    expect(headers['if-modified-since']).toBe('Sat, 31 Oct 2026 03:00:00 GMT');
  });

  it('records a refusal (403, 429) as blocked and a missing page as an error, never as read', async () => {
    for (const [status, outcome] of [
      [403, 'BLOCKED'],
      [429, 'BLOCKED'],
      [404, 'ERROR'],
      [500, 'ERROR'],
    ] as const) {
      const { fetcher } = fakeNetwork(() => new Response('nope', { status }));
      const result = await fetcher(request());
      expect(result.outcome, String(status)).toBe(outcome);
      expect(result.body).toBeNull();
    }
  });

  it('records a PDF honestly as an unsupported format', async () => {
    const { fetcher } = fakeNetwork(
      () =>
        new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    expect((await fetcher(request())).outcome).toBe('UNSUPPORTED_FORMAT');
  });

  it('stops at the size cap, whether the length is declared or streamed', async () => {
    const declared = fakeNetwork(() => html('x', { 'content-length': '999999' }));
    expect((await declared.fetcher(request())).outcome).toBe('TOO_LARGE');
    const streamed = fakeNetwork(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(400));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } });
    });
    expect((await streamed.fetcher(request())).outcome).toBe('TOO_LARGE');
  });

  it('gives up at the deadline and records a timeout', async () => {
    const { fetcher } = fakeNetwork(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    expect((await fetcher(request())).outcome).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses a redirect to another host without fetching it', async () => {
    const { fetcher, calls } = fakeNetwork(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://elsewhere.example/visit' },
        }),
    );
    expect((await fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
    expect(calls).toHaveLength(1);
  });

  it('refuses a same-host redirect whose name now points at a private address', async () => {
    let lookups = 0;
    const { fetcher, calls } = fakeNetwork(
      () => new Response(null, { status: 301, headers: { location: '/visit/moved' } }),
      () => (lookups++ === 0 ? PUBLIC : ['10.0.0.7']),
    );
    expect((await fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
    expect(calls).toHaveLength(1);
  });

  it('refuses a redirect down to plain http', async () => {
    const { fetcher } = fakeNetwork(
      () =>
        new Response(null, {
          status: 307,
          headers: { location: 'http://visas.synthetic-gov.example/visit/apply' },
        }),
    );
    expect((await fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
  });

  it('follows a same-host redirect, re-checked, and stops after three hops', async () => {
    const followed = fakeNetwork((url) =>
      url.endsWith('/moved')
        ? html('<p>Moved rule</p>')
        : new Response(null, { status: 308, headers: { location: '/visit/moved' } }),
    );
    const result = await followed.fetcher(request());
    expect(result.outcome).toBe('FETCHED');
    expect(followed.calls.map((c) => c.url)).toEqual([
      REGISTERED,
      'https://visas.synthetic-gov.example/visit/moved',
    ]);

    let hop = 0;
    const loop = fakeNetwork(
      () => new Response(null, { status: 302, headers: { location: `/visit/hop-${++hop}` } }),
    );
    expect((await loop.fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
    expect(loop.calls).toHaveLength(4);
  });

  it('never fetches a registered host that resolves to a private address', async () => {
    const { fetcher, calls } = fakeNetwork(
      () => html('secret'),
      () => ['127.0.0.1'],
    );
    expect((await fetcher(request())).outcome).toBe('ERROR');
    expect(calls).toHaveLength(0);
  });
});
