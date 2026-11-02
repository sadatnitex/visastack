import { describe, expect, it } from 'vitest';
import {
  SOURCE_CHECK_USER_AGENT,
  type SourceFetchRequest,
  type SourceResolver,
  createSourceFetcher,
  isSameSourceHost,
  parseSourceUrl,
  pinnedLookup,
} from './source-fetch';
import {
  type FakeHandler,
  PUBLIC_ADDRESS,
  fakeTransport,
  publicResolver,
} from './source-fetch.test-support';

/**
 * The official-source fetcher's safety rules, with a fake network: every address, answer and
 * delay here is synthetic.
 */

const REGISTERED = 'https://visas.synthetic-gov.example/visit/apply';

function fakeNetwork(handler: FakeHandler, resolve: SourceResolver = publicResolver) {
  const fake = fakeTransport(handler);
  const fetcher = createSourceFetcher({
    transport: fake.transport,
    resolve,
    timeoutMs: 200,
    maxBytes: 1024,
  });
  return { fetcher, requests: fake.requests, connected: fake.connected };
}

const request = (overrides: Partial<SourceFetchRequest> = {}): SourceFetchRequest => ({
  url: REGISTERED,
  etag: null,
  lastModified: null,
  ...overrides,
});

const html = (body: string, headers: Record<string, string> = {}) => ({
  status: 200,
  body,
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
});

describe('parseSourceUrl and isSameSourceHost', () => {
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

  it('treats only the same host, or one leading www. either way, as the same site', () => {
    expect(isSameSourceHost('gov.example', 'gov.example')).toBe(true);
    expect(isSameSourceHost('gov.example', 'www.gov.example')).toBe(true);
    expect(isSameSourceHost('www.gov.example', 'gov.example')).toBe(true);
    expect(isSameSourceHost('gov.example', 'www.www.gov.example')).toBe(false);
    expect(isSameSourceHost('gov.example', 'visas.gov.example')).toBe(false);
    expect(isSameSourceHost('gov.example', 'gov.example.evil.example')).toBe(false);
  });
});

describe('pinned address', () => {
  it('connects only to an address it checked, even when the resolver changes its answer', async () => {
    let lookups = 0;
    const rebinding: SourceResolver = async () =>
      lookups++ === 0 ? [PUBLIC_ADDRESS] : ['10.0.0.7'];
    const { fetcher, connected } = fakeNetwork(
      (url) =>
        url.endsWith('/moved')
          ? html('<p>Moved</p>')
          : { status: 302, headers: { location: '/visit/moved' } },
      rebinding,
    );
    // The first connection gets the public answer; the redirect's connection resolves again, is
    // answered with a private address, and is refused before any socket would open.
    expect((await fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
    expect(connected).toEqual([PUBLIC_ADDRESS]);
  });

  it('refuses a host with any private address among its answers', async () => {
    const { fetcher, connected } = fakeNetwork(
      () => html('secret'),
      async () => [PUBLIC_ADDRESS, '10.0.0.7'],
    );
    expect((await fetcher(request())).outcome).toBe('ERROR');
    expect(connected).toEqual([]);
  });

  it('answers both lookup forms with checked addresses only', async () => {
    const lookup = pinnedLookup(async () => [PUBLIC_ADDRESS, '2606:2800:220:1:248:1893:25c8:1946']);
    const call = lookup as unknown as (
      host: string,
      options: object,
      callback: (error: Error | null, address: unknown, family?: number) => void,
    ) => void;
    const one = await new Promise<unknown[]>((resolve) =>
      call('gov.example', { family: 6 }, (error, address, family) =>
        resolve([error, address, family]),
      ),
    );
    expect(one).toEqual([null, '2606:2800:220:1:248:1893:25c8:1946', 6]);
    const all = await new Promise<unknown>((resolve) =>
      call('gov.example', { all: true }, (_error, address) => resolve(address)),
    );
    expect(all).toEqual([
      { address: PUBLIC_ADDRESS, family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
  });

  it('makes the real https transport use the pinned lookup, so a private host never connects', async () => {
    let resolved = 0;
    const fetcher = createSourceFetcher({
      resolve: async () => {
        resolved += 1;
        return ['127.0.0.1'];
      },
      timeoutMs: 2000,
    });
    expect((await fetcher(request())).outcome).toBe('ERROR');
    expect(resolved).toBe(1);
  });
});

describe('createSourceFetcher', () => {
  it('reads an HTML page with a plain user agent', async () => {
    const { fetcher, requests } = fakeNetwork(() => html('<p>Rule</p>', { etag: '"v1"' }));
    const result = await fetcher(request());
    expect(result.outcome).toBe('FETCHED');
    expect(result.httpStatus).toBe(200);
    expect(result.etag).toBe('"v1"');
    expect(result.body?.kind).toBe('html');
    expect(result.body?.text).toBe('<p>Rule</p>');
    expect(result.body?.byteLength).toBe(11);
    expect(result.body?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(requests[0]?.headers['user-agent']).toBe(SOURCE_CHECK_USER_AGENT);
  });

  it('asks conditionally and records 304 as not modified, carrying the known tags forward', async () => {
    const { fetcher, requests } = fakeNetwork(() => ({ status: 304 }));
    const result = await fetcher(
      request({ etag: '"v1"', lastModified: 'Sat, 31 Oct 2026 03:00:00 GMT' }),
    );
    expect(result).toMatchObject({
      outcome: 'NOT_MODIFIED',
      httpStatus: 304,
      etag: '"v1"',
      body: null,
    });
    expect(requests[0]?.headers['if-none-match']).toBe('"v1"');
    expect(requests[0]?.headers['if-modified-since']).toBe('Sat, 31 Oct 2026 03:00:00 GMT');
  });

  it('records a refusal (403, 429) as blocked and a missing page as an error, never as read', async () => {
    for (const [status, outcome] of [
      [403, 'BLOCKED'],
      [429, 'BLOCKED'],
      [404, 'ERROR'],
      [500, 'ERROR'],
    ] as const) {
      const { fetcher } = fakeNetwork(() => ({ status, body: 'nope' }));
      const result = await fetcher(request());
      expect(result.outcome, String(status)).toBe(outcome);
      expect(result.body).toBeNull();
    }
  });

  it('records a PDF honestly as an unsupported format', async () => {
    const { fetcher } = fakeNetwork(() => ({
      status: 200,
      body: '%PDF-1.7',
      headers: { 'content-type': 'application/pdf' },
    }));
    expect((await fetcher(request())).outcome).toBe('UNSUPPORTED_FORMAT');
  });

  it('stops at the size cap, whether the length is declared or streamed', async () => {
    const declared = fakeNetwork(() => html('x', { 'content-length': '999999' }));
    expect((await declared.fetcher(request())).outcome).toBe('TOO_LARGE');
    const streamed = fakeNetwork(() => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: Array.from({ length: 5 }, () => new Uint8Array(400)),
    }));
    expect((await streamed.fetcher(request())).outcome).toBe('TOO_LARGE');
  });

  it('gives up at the deadline and records a timeout', async () => {
    const { fetcher } = fakeNetwork(() => ({ hang: true }));
    const started = Date.now();
    expect((await fetcher(request())).outcome).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses a redirect to another host without fetching it', async () => {
    const { fetcher, requests } = fakeNetwork(() => ({
      status: 302,
      headers: { location: 'https://elsewhere.example/visit' },
    }));
    expect((await fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
    expect(requests).toHaveLength(1);
  });

  it('refuses a redirect down to plain http', async () => {
    const { fetcher } = fakeNetwork(() => ({
      status: 307,
      headers: { location: 'http://visas.synthetic-gov.example/visit/apply' },
    }));
    expect((await fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
  });

  it('follows a same-site redirect (also to www.), re-checked, and stops after three hops', async () => {
    const followed = fakeNetwork((url) =>
      url.endsWith('/moved')
        ? html('<p>Moved rule</p>')
        : { status: 308, headers: { location: 'https://www.visas.synthetic-gov.example/moved' } },
    );
    const result = await followed.fetcher(request());
    expect(result.outcome).toBe('FETCHED');
    expect(followed.requests.map((r) => r.url)).toEqual([
      REGISTERED,
      'https://www.visas.synthetic-gov.example/moved',
    ]);

    let hop = 0;
    const loop = fakeNetwork(() => ({
      status: 302,
      headers: { location: `/visit/hop-${++hop}` },
    }));
    expect((await loop.fetcher(request())).outcome).toBe('REDIRECT_REFUSED');
    expect(loop.requests).toHaveLength(4);
  });
});
