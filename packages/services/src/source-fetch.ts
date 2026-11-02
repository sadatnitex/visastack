import { createHash } from 'node:crypto';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { type LookupFunction, isIP } from 'node:net';
import { isPublicAddress } from './ai-clients';

/**
 * The safe fetcher behind the weekly official-source check (UMPE P10).
 *
 * One registered official page is fetched under fixed rules, so a registered address can never be
 * turned into a way to reach a private network or another site:
 * - https only, on the default port, no user name or password in the address, a host name (never
 *   a bare IP address);
 * - the address is pinned: the connection's own name lookup is replaced by one that resolves the
 *   host, refuses unless every address is public (`isPublicAddress`, shared with the AI app
 *   sign-in fetch), and hands the connection exactly the addresses it checked. There is no second
 *   lookup a resolver could answer differently (no DNS rebinding window). TLS still verifies the
 *   certificate for the host name, which is also the Host header;
 * - redirects are never followed blindly: each hop is re-checked under the same rules and must stay
 *   on the registered host (or differ from it only by one leading "www."), at most 3 hops;
 * - one deadline (8 s) covers name lookups, every hop and reading the body; the body is capped at
 *   512 KiB; only HTML and plain text are read, anything else (a PDF, for example) is recorded
 *   honestly as an unsupported format, never as checked;
 * - a conditional request (If-None-Match, If-Modified-Since) lets an unchanged page answer 304.
 */

export const SOURCE_FETCH_TIMEOUT_MS = 8000;
export const SOURCE_FETCH_MAX_BYTES = 512 * 1024;
export const SOURCE_FETCH_MAX_REDIRECTS = 3;
export const SOURCE_CHECK_USER_AGENT = 'VisaStack source check (official page monitoring)';

export const SOURCE_FETCH_OUTCOMES = [
  'FETCHED',
  'NOT_MODIFIED',
  'BLOCKED',
  'TIMEOUT',
  'REDIRECT_REFUSED',
  'TOO_LARGE',
  'UNSUPPORTED_FORMAT',
  'ERROR',
] as const;
export type SourceFetchOutcome = (typeof SOURCE_FETCH_OUTCOMES)[number];

export interface SourceFetchRequest {
  readonly url: string;
  /** From the last successful fetch, for a conditional request. */
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface SourceFetchBody {
  readonly kind: 'html' | 'text';
  readonly text: string;
  /** SHA-256 of the bytes as received, hex. */
  readonly sha256: string;
  readonly byteLength: number;
}

export interface SourceFetchResult {
  readonly outcome: SourceFetchOutcome;
  readonly httpStatus: number | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  /** Present only when the outcome is FETCHED. */
  readonly body: SourceFetchBody | null;
}

export type SourceFetcher = (request: SourceFetchRequest) => Promise<SourceFetchResult>;

/** Turns a host name into its addresses (the system resolver unless a test passes one). */
export type SourceResolver = (host: string) => Promise<readonly string[]>;

/** One answer as the transport received it. Header names are lower case. */
export interface SourceRawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  /** Stops reading and frees the connection. */
  close(): void;
}

export interface SourceTransportInit {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  /** The only way the transport may turn the host name into an address to connect to. */
  readonly lookup: LookupFunction;
}

/** One GET of one address, never following a redirect. Tests pass a fake one. */
export type SourceTransport = (url: URL, init: SourceTransportInit) => Promise<SourceRawResponse>;

export interface SourceFetcherOptions {
  readonly transport?: SourceTransport;
  readonly resolve?: SourceResolver;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

/** HTTP answers that mean the site turned the check away (sign-in, bot protection, rate limit). */
const BLOCKED_STATUSES = new Set([401, 403, 407, 429, 451]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The parsed address when it is one the source check may ever fetch, else null. Used both when an
 * admin registers a page and on every redirect hop.
 */
export function parseSourceUrl(raw: string): URL | null {
  if (raw.length === 0 || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  const host = url.hostname;
  if (host.length === 0 || host.startsWith('[') || isIP(host) !== 0) return null;
  // A single-label name (no dot) is a local network name, never an official site.
  if (!host.includes('.') || host.endsWith('.')) return null;
  return url;
}

/**
 * A redirect may stay on the registered host, or move between it and the same name with one
 * leading "www." (in either direction). Anything else is another site.
 */
export function isSameSourceHost(registered: string, next: string): boolean {
  return registered === next || next === `www.${registered}` || registered === `www.${next}`;
}

async function systemResolve(host: string): Promise<readonly string[]> {
  const results = await dnsLookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

/** Raised by the pinned lookup when a host resolves to anything but public addresses. */
export class SourceAddressRefused extends Error {
  readonly code = 'SOURCE_ADDRESS_REFUSED';
  constructor() {
    super('official source host resolves to a non-public address');
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * The connection's name lookup: resolve once, refuse unless every address is public, and answer
 * with exactly the checked addresses, so the socket can only connect to one of them.
 */
export function pinnedLookup(resolve: SourceResolver): LookupFunction {
  const lookup = (hostname: string, options: LookupOptions, callback: LookupCallback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
          callback(new SourceAddressRefused(), '', 0);
          return;
        }
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = addresses
          .map((address) => ({ address, family: isIP(address) }))
          .filter((entry) => wanted === 0 || entry.family === wanted);
        const chosen = usable[0];
        if (!chosen) {
          const missing: NodeJS.ErrnoException = new Error('no address of the requested family');
          missing.code = 'ENOTFOUND';
          callback(missing, '', 0);
          return;
        }
        if (options.all) callback(null, usable);
        else callback(null, chosen.address, chosen.family);
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error('lookup failed'), '', 0);
      },
    );
  };
  return lookup as unknown as LookupFunction;
}

/** The real transport: node:https with the pinned lookup and no shared connection pool. */
const httpsTransport: SourceTransport = (url, init) =>
  new Promise<SourceRawResponse>((resolvePromise, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        headers: init.headers,
        signal: init.signal,
        lookup: init.lookup,
        // No pooled socket: every request makes its own pinned lookup.
        agent: false,
      },
      (response) => {
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
        }
        resolvePromise({
          status: response.statusCode ?? 0,
          headers,
          body: response,
          close: () => response.destroy(),
        });
      },
    );
    request.on('error', reject);
    request.end();
  });

/** Settle with the promise, or reject as soon as the signal aborts. */
function beforeDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** The readable kind of a Content-Type, or null when it is not one the check reads. */
function readableKind(
  header: string | undefined,
): { kind: 'html' | 'text'; charset: string } | null {
  if (header === undefined) return null;
  const [typePart, ...params] = header.split(';');
  const type = (typePart ?? '').trim().toLowerCase();
  let kind: 'html' | 'text' | null = null;
  if (type === 'text/html' || type === 'application/xhtml+xml') kind = 'html';
  else if (type === 'text/plain') kind = 'text';
  if (kind === null) return null;
  let charset = 'utf-8';
  for (const param of params) {
    const [name, value] = param.split('=');
    if ((name ?? '').trim().toLowerCase() === 'charset' && value) {
      charset = value.trim().replace(/^"|"$/g, '').toLowerCase();
    }
  }
  return { kind, charset };
}

/** At most `limit` bytes of the body, or null when it is longer. */
async function readCappedBytes(
  response: SourceRawResponse,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    response.close();
    return null;
  }
  const iterator = response.body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await beforeDeadline(iterator.next(), signal);
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      response.close();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** One response header (names are lower case), or null when absent. */
function headerOf(response: SourceRawResponse, name: string): string | null {
  return response.headers[name] ?? null;
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // An unknown charset label: read it as UTF-8 (a wrong character is better than no check).
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function isRefusal(error: unknown): boolean {
  for (let value = error, depth = 0; depth < 4; depth++) {
    if (value instanceof SourceAddressRefused) return true;
    if (typeof value !== 'object' || value === null) return false;
    if ((value as { code?: unknown }).code === 'SOURCE_ADDRESS_REFUSED') return true;
    value = (value as { cause?: unknown }).cause;
  }
  return false;
}

/** A fetcher that applies every rule above. Tests pass a fake `transport` and `resolve`. */
export function createSourceFetcher(options: SourceFetcherOptions = {}): SourceFetcher {
  const transport = options.transport ?? httpsTransport;
  const lookup = pinnedLookup(options.resolve ?? systemResolve);
  const timeoutMs = options.timeoutMs ?? SOURCE_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? SOURCE_FETCH_MAX_BYTES;

  return async (request) => {
    const result = (
      outcome: SourceFetchOutcome,
      httpStatus: number | null = null,
      body: SourceFetchBody | null = null,
      etag: string | null = null,
      lastModified: string | null = null,
    ): SourceFetchResult => ({ outcome, httpStatus, etag, lastModified, body });

    const registered = parseSourceUrl(request.url);
    if (registered === null) return result('ERROR');
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException('source check timed out', 'TimeoutError')),
      timeoutMs,
    );
    const signal = controller.signal;
    try {
      let current = registered;
      for (let hop = 0; ; hop++) {
        const headers: Record<string, string> = {
          'user-agent': SOURCE_CHECK_USER_AGENT,
          accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
        };
        if (request.etag) headers['if-none-match'] = request.etag;
        if (request.lastModified) headers['if-modified-since'] = request.lastModified;

        let response: SourceRawResponse;
        try {
          response = await beforeDeadline(transport(current, { headers, signal, lookup }), signal);
        } catch (error) {
          if (signal.aborted) return result('TIMEOUT');
          // A host that resolves to anything but public addresses is never connected to: on the
          // registered address that is an error, on a redirect a refused redirect.
          if (isRefusal(error)) return result(hop === 0 ? 'ERROR' : 'REDIRECT_REFUSED');
          return result('ERROR');
        }
        const status = response.status;
        const etag = headerOf(response, 'etag');
        const lastModified = headerOf(response, 'last-modified');

        if (REDIRECT_STATUSES.has(status)) {
          response.close();
          const location = headerOf(response, 'location');
          if (location === null) return result('ERROR', status);
          if (hop >= SOURCE_FETCH_MAX_REDIRECTS) return result('REDIRECT_REFUSED', status);
          let next: URL | null;
          try {
            next = parseSourceUrl(new URL(location, current).href);
          } catch {
            next = null;
          }
          if (next === null || !isSameSourceHost(registered.hostname, next.hostname)) {
            return result('REDIRECT_REFUSED', status);
          }
          current = next;
          continue;
        }
        if (status === 304) {
          response.close();
          return result(
            'NOT_MODIFIED',
            status,
            null,
            etag ?? request.etag,
            lastModified ?? request.lastModified,
          );
        }
        if (BLOCKED_STATUSES.has(status)) {
          response.close();
          return result('BLOCKED', status);
        }
        if (status < 200 || status > 299) {
          response.close();
          return result('ERROR', status);
        }
        const readable = readableKind(response.headers['content-type']);
        if (readable === null) {
          response.close();
          return result('UNSUPPORTED_FORMAT', status);
        }
        let bytes: Uint8Array | null;
        try {
          bytes = await readCappedBytes(response, maxBytes, signal);
        } catch {
          response.close();
          return result(signal.aborted ? 'TIMEOUT' : 'ERROR', status);
        }
        if (bytes === null) return result('TOO_LARGE', status);
        const body: SourceFetchBody = {
          kind: readable.kind,
          text: decode(bytes, readable.charset),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          byteLength: bytes.byteLength,
        };
        return result('FETCHED', status, body, etag, lastModified);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
