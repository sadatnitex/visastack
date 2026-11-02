import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from './ai-clients';

/**
 * The safe fetcher behind the Saturday official-source check (UMPE P10).
 *
 * One registered official page is fetched under fixed rules, so a registered address can never be
 * turned into a way to reach a private network or another site:
 * - https only, on the default port, no user name or password in the address, a host name (never
 *   a bare IP address);
 * - every address the host resolves to must be public (`isPublicAddress`, shared with the AI app
 *   sign-in fetch), checked before every request;
 * - redirects are never followed blindly: each hop is re-checked under the same rules and must stay
 *   on exactly the registered host, at most 3 hops;
 * - one deadline (8 s) covers name lookups, every hop and reading the body; the body is capped at
 *   512 KiB; only HTML and plain text are read, anything else (a PDF, for example) is recorded
 *   honestly as an unsupported format, never as checked;
 * - a conditional request (If-None-Match, If-Modified-Since) lets an unchanged page answer 304.
 *
 * Name resolution caveat (as in ai-clients.ts): fetch resolves the name again, so a resolver that
 * changes its answer between the check and the request is not fully excluded. Only addresses an
 * admin with pack management rights registered are ever fetched.
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

export interface SourceFetcherOptions {
  readonly fetch?: typeof fetch;
  readonly lookup?: (host: string) => Promise<readonly string[]>;
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

async function defaultLookup(host: string): Promise<readonly string[]> {
  const results = await dnsLookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

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
function readableKind(header: string | null): { kind: 'html' | 'text'; charset: string } | null {
  if (header === null) return null;
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
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await beforeDeadline(reader.read(), signal);
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
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

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // An unknown charset label: read it as UTF-8 (a wrong character is better than no check).
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

/** A fetcher that applies every rule above. Tests pass a fake `fetch` and `lookup`. */
export function createSourceFetcher(options: SourceFetcherOptions = {}): SourceFetcher {
  const doFetch = options.fetch ?? fetch;
  const lookup = options.lookup ?? defaultLookup;
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
        let addresses: readonly string[];
        try {
          addresses = await beforeDeadline(lookup(current.hostname), signal);
        } catch (error) {
          return result(isAbort(error, signal) ? 'TIMEOUT' : 'ERROR');
        }
        if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
          return result(hop === 0 ? 'ERROR' : 'REDIRECT_REFUSED');
        }

        const headers: Record<string, string> = {
          'user-agent': SOURCE_CHECK_USER_AGENT,
          accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
        };
        if (request.etag) headers['if-none-match'] = request.etag;
        if (request.lastModified) headers['if-modified-since'] = request.lastModified;

        let response: Response;
        try {
          response = await beforeDeadline(
            doFetch(current.href, { method: 'GET', redirect: 'manual', headers, signal }),
            signal,
          );
        } catch (error) {
          return result(isAbort(error, signal) ? 'TIMEOUT' : 'ERROR');
        }
        const status = response.status;
        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');

        if (REDIRECT_STATUSES.has(status)) {
          await response.body?.cancel().catch(() => undefined);
          const location = response.headers.get('location');
          if (location === null) return result('ERROR', status);
          if (hop >= SOURCE_FETCH_MAX_REDIRECTS) return result('REDIRECT_REFUSED', status);
          let next: URL | null;
          try {
            next = parseSourceUrl(new URL(location, current).href);
          } catch {
            next = null;
          }
          if (next === null || next.hostname !== registered.hostname) {
            return result('REDIRECT_REFUSED', status);
          }
          current = next;
          continue;
        }
        if (status === 304) {
          await response.body?.cancel().catch(() => undefined);
          return result(
            'NOT_MODIFIED',
            status,
            null,
            etag ?? request.etag,
            lastModified ?? request.lastModified,
          );
        }
        if (BLOCKED_STATUSES.has(status)) {
          await response.body?.cancel().catch(() => undefined);
          return result('BLOCKED', status);
        }
        if (status < 200 || status > 299) {
          await response.body?.cancel().catch(() => undefined);
          return result('ERROR', status);
        }
        const readable = readableKind(response.headers.get('content-type'));
        if (readable === null) {
          await response.body?.cancel().catch(() => undefined);
          return result('UNSUPPORTED_FORMAT', status);
        }
        let bytes: Uint8Array | null;
        try {
          bytes = await readCappedBytes(response, maxBytes, signal);
        } catch (error) {
          return result(isAbort(error, signal) ? 'TIMEOUT' : 'ERROR', status);
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
