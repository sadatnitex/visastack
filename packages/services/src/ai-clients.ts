import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { type Result, err, ok } from '@visastack/core';
import { isHiddenCodePoint } from '@visastack/core/ai-features';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { type Db, schema } from './db';
import { isMissingRelationError } from './missing-relation';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';

/**
 * Which AI apps may connect to a person's record, and how VisaStack learns who an app is
 * (ADR 0021 section 2 and its Dynamic Client Registration extension).
 *
 * An app identifies itself in one of two ways:
 * - Client ID Metadata Document (CIMD, preferred): the client_id is an HTTPS URL on the app's own
 *   host, and the document at that URL lists the app's name and redirect addresses.
 * - Dynamic Client Registration (RFC 7591): the app posts its details once and gets a random
 *   client_id starting with "vsc_", stored in oauth_clients.
 *
 * Both paths accept public clients only (no client secret): the app proves itself with PKCE, and
 * the authorization code can only travel to a redirect address on the app's published hosts or to
 * the person's own computer (loopback).
 */

export type AiAppKey = 'claude' | 'chatgpt';

export interface SupportedAiApp {
  readonly key: AiAppKey;
  readonly name: string;
  /** Hosts allowed to serve a client metadata document (the host of a URL client_id). */
  readonly hosts: readonly string[];
  /** Hosts allowed as HTTPS redirect addresses for this app. */
  readonly redirectHosts: readonly string[];
}

/**
 * The allowlist of supported AI apps, the one place it is kept (ADR 0021: unknown apps see "This
 * AI app is not supported yet"). Verified 27 Oct 2026 against the apps' official documentation:
 * - Claude (Anthropic connector docs): hosted apps redirect to
 *   https://claude.ai/api/mcp/auth_callback (https://claude.com/api/mcp/auth_callback is accepted
 *   too). Claude Code's CIMD client_id is https://claude.ai/oauth/claude-code-client-metadata,
 *   which declares http://localhost/callback and http://127.0.0.1/callback on any port. Claude
 *   uses CIMD when the server advertises client_id_metadata_document_supported and the "none"
 *   token endpoint auth method, and Dynamic Client Registration otherwise.
 * - ChatGPT (OpenAI Apps SDK auth docs): redirects to
 *   https://chatgpt.com/connector_platform_oauth_redirect (when the server returns the RFC 9207
 *   iss parameter) or https://chatgpt.com/connector/oauth/{callback_id}. Its CIMD client_id is
 *   https://chatgpt.com/oauth/client.json or https://chatgpt.com/oauth/{callback_id}/client.json.
 * Adding an app is a reviewed change to this list, never a setting.
 */
export const SUPPORTED_AI_APPS = [
  {
    key: 'claude',
    name: 'Claude',
    hosts: ['claude.ai', 'claude.com'],
    redirectHosts: ['claude.ai', 'claude.com'],
  },
  {
    key: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com'],
    redirectHosts: ['chatgpt.com'],
  },
] as const satisfies readonly SupportedAiApp[];

/** Shown as the app's host when every redirect address is on the person's own computer. */
export const LOOPBACK_CLIENT_HOST = 'this computer';

/** Registered (Dynamic Client Registration) client ids start with this. */
export const REGISTERED_CLIENT_PREFIX = 'vsc_';

/** A registered client unused for this long is forgotten (ADR 0021 extension). */
export const REGISTERED_CLIENT_UNUSED_MS = 30 * 24 * 60 * 60 * 1000;

/** A fetched client metadata document is reused for this long before it is fetched again. */
export const CLIENT_METADATA_CACHE_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 5000;
const MAX_DOCUMENT_BYTES = 64 * 1024;
const MAX_CLIENT_NAME_LENGTH = 80;
const MAX_URI_LENGTH = 2048;
const MAX_DOCUMENT_REDIRECT_URIS = 20;
const MAX_REGISTERED_REDIRECT_URIS = 10;
const MAX_CACHE_ENTRIES = 256;
const TOUCH_INTERVAL_MS = 60 * 1000;
const DEFAULT_REGISTERED_NAME = 'AI App';
const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
const SUPPORTED_RESPONSE_TYPES = ['code'] as const;
const REGISTERED_CLIENT_ID_PATTERN = /^vsc_[A-Za-z0-9_-]{43}$/;

export interface ResolvedAiClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly appKey: AiAppKey | null;
  /** The host to show the person: the app's host, or LOOPBACK_CLIENT_HOST. */
  readonly host: string;
  readonly redirectUris: readonly string[];
  readonly source: 'metadata_document' | 'pinned' | 'registered';
  /** Every redirect address is on the person's own computer: the consent screen warns. */
  readonly loopbackOnly: boolean;
}

/** Internal reasons; the consent screen maps each code to its own plain wording. */
export interface AiClientRefusal {
  readonly code: 'unsupported_app' | 'invalid_client' | 'unreachable';
  readonly message: string;
}

export interface ClientMetadataDeps {
  readonly fetch?: typeof fetch;
  readonly lookup?: (host: string) => Promise<readonly string[]>;
  readonly now?: () => Date;
}

function refusal(code: AiClientRefusal['code'], message: string): AiClientRefusal {
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUrl(text: string): URL | null {
  if (text.length === 0 || text.length > MAX_URI_LENGTH) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function appForHost(host: string): SupportedAiApp | undefined {
  return SUPPORTED_AI_APPS.find((app) => (app.hosts as readonly string[]).includes(host));
}

function appForRedirectHost(host: string): SupportedAiApp | undefined {
  return SUPPORTED_AI_APPS.find((app) => (app.redirectHosts as readonly string[]).includes(host));
}

const ALL_REDIRECT_HOSTS: readonly string[] = SUPPORTED_AI_APPS.flatMap((app) => app.redirectHosts);

// --- Redirect addresses -------------------------------------------------------------------------

/** http://localhost or http://127.0.0.1 on any port and path, with no userinfo and no fragment. */
export function isLoopbackRedirect(uri: string): boolean {
  if (uri.includes('#')) return false;
  const url = parseUrl(uri);
  if (url === null) return false;
  if (url.protocol !== 'http:') return false;
  if (url.username !== '' || url.password !== '') return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

/** An HTTPS redirect on one of the given hosts, on the default port, no userinfo or fragment. */
function isAllowedHttpsRedirect(uri: string, hosts: readonly string[]): boolean {
  if (uri.includes('#')) return false;
  const url = parseUrl(uri);
  if (url === null) return false;
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '') return false;
  return hosts.includes(url.hostname);
}

/**
 * The sign-in return paths the supported apps publish (27 Oct 2026). A self-registered client may
 * use only these on an app's host, never any other page there, so a code can never be delivered
 * to a page that might leak its address.
 */
const APP_RETURN_PATHS: readonly { readonly path: string; readonly prefix: boolean }[] = [
  { path: '/api/mcp/auth_callback', prefix: false },
  { path: '/connector_platform_oauth_redirect', prefix: false },
  { path: '/connector/oauth/', prefix: true },
];

function isKnownAppReturnAddress(uri: string): boolean {
  if (!isAllowedHttpsRedirect(uri, ALL_REDIRECT_HOSTS)) return false;
  const url = parseUrl(uri);
  // The address must already be in its plain form: no dot segments or escapes to be tidied up.
  if (url === null || url.search !== '' || url.href !== uri) return false;
  return APP_RETURN_PATHS.some(({ path, prefix }) =>
    prefix
      ? url.pathname.startsWith(path) &&
        /^[A-Za-z0-9_-]{1,128}$/.test(url.pathname.slice(path.length))
      : url.pathname === path,
  );
}

/**
 * Whether a requested redirect address matches one the client registered. Exact string match,
 * except loopback, where scheme, host, path and query must match a registered loopback address
 * and the port is ignored (RFC 8252 section 7.3, applied to localhost as well as 127.0.0.1,
 * because Claude Code listens on whatever port is free). Fragments, userinfo, schemes other than
 * http and https, and plain http anywhere but loopback are always refused.
 */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (requested.includes('#')) return false;
  const url = parseUrl(requested);
  if (url === null) return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return registered.includes(requested);
  if (url.protocol !== 'http:' || !isLoopbackRedirect(requested)) return false;
  // The requested address must already be in its plain written form, so dot segments,
  // backslashes or upper-case hosts cannot dress one path up as another.
  if (url.href !== requested) return false;
  return registered.some((entry) => {
    if (!isLoopbackRedirect(entry)) return false;
    const known = parseUrl(entry);
    return (
      known !== null &&
      known.protocol === url.protocol &&
      known.hostname === url.hostname &&
      known.pathname === url.pathname &&
      known.search === url.search
    );
  });
}

// --- Names --------------------------------------------------------------------------------------

/** A display-safe client name: hidden characters removed, spaces collapsed, at most 80 characters. */
function cleanClientName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const visible = Array.from(value)
    .filter((char) => !isHiddenCodePoint(char.codePointAt(0) ?? 0))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = Array.from(visible).slice(0, MAX_CLIENT_NAME_LENGTH).join('').trim();
  return cut.length > 0 ? cut : fallback;
}

// --- Public network addresses -------------------------------------------------------------------

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((total, part) => total * 256 + Number(part), 0);
}

function inIpv4Range(value: number, base: string, bits: number): boolean {
  const size = 2 ** (32 - bits);
  const start = ipv4ToNumber(base);
  return value >= start && value < start + size;
}

/** Ranges that are not on the public internet (RFC 6890 special-purpose registry and multicast). */
const NON_PUBLIC_IPV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isPublicIpv4Number(value: number): boolean {
  return !NON_PUBLIC_IPV4.some(([base, bits]) => inIpv4Range(value, base, bits));
}

/** The eight 16-bit groups of a valid IPv6 address (an embedded IPv4 tail is folded in). */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const value = ipv4ToNumber(tail);
    text = `${text.slice(0, lastColon + 1)}${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] =>
    part === ''
      ? []
      : part
          .split(':')
          .map((group) =>
            /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
          );
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if ([...head, ...rest].some((group) => Number.isNaN(group))) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function isPublicIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (groups === null) return false;
  const g = (index: number): number => groups[index] ?? 0;
  const embeddedV4 = (high: number, low: number): number => g(high) * 65536 + g(low);
  const firstFiveZero = [0, 1, 2, 3, 4].every((index) => g(index) === 0);
  // ::ffff:a.b.c.d (IPv4-mapped): judged by the IPv4 address inside.
  if (firstFiveZero && g(5) === 0xffff) return isPublicIpv4Number(embeddedV4(6, 7));
  // 64:ff9b::/96 (NAT64): judged by the IPv4 address inside.
  if (g(0) === 0x64 && g(1) === 0xff9b && [2, 3, 4, 5].every((index) => g(index) === 0)) {
    return isPublicIpv4Number(embeddedV4(6, 7));
  }
  // 2002::/16 (6to4): judged by the IPv4 address inside.
  if (g(0) === 0x2002) return isPublicIpv4Number(embeddedV4(1, 2));
  // Only global unicast 2000::/3 is public. This refuses ::, ::1, ::/96, fc00::/7, fe80::/10,
  // ff00::/8 and the rest of the reserved space in one rule.
  if ((g(0) & 0xe000) !== 0x2000) return false;
  if (g(0) === 0x2001 && g(1) === 0x0db8) return false; // documentation
  if (g(0) === 0x2001 && g(1) < 0x0200) return false; // protocol assignments, Teredo, ORCHID
  if (g(0) === 0x3fff && g(1) < 0x1000) return false; // documentation (RFC 9637)
  return true;
}

/** True only for an address on the public internet (IPv4 or IPv6, zone id ignored). */
export function isPublicAddress(address: string): boolean {
  const bare = address.split('%')[0] ?? '';
  if (isIPv4(bare)) return isPublicIpv4Number(ipv4ToNumber(bare));
  if (isIPv6(bare)) return isPublicIpv6(bare);
  return false;
}

// --- Client metadata documents (CIMD) -----------------------------------------------------------

interface PinnedClientDocument {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method: 'none';
}

/**
 * Copies of the two stable published documents, used ONLY when the live fetch fails (network
 * error, bot protection, timeout, a non-success answer), never in place of a document that was
 * fetched and is valid. chatgpt.com bot protection is reported to block server-side fetches from
 * cloud hosts, which is why these exist. Copied 27 Oct 2026; re-check them when either app changes
 * its published document.
 */
const PINNED_CLIENT_DOCUMENTS: ReadonlyMap<string, PinnedClientDocument> = new Map(
  (
    [
      {
        client_id: 'https://chatgpt.com/oauth/client.json',
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        token_endpoint_auth_method: 'none',
      },
      {
        client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
        client_name: 'Claude Code',
        redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none',
      },
    ] as const satisfies readonly PinnedClientDocument[]
  ).map((document) => [document.client_id, document]),
);

interface CacheEntry {
  readonly client: ResolvedAiClient;
  readonly expiresAt: number;
}

const metadataCache = new Map<string, CacheEntry>();

/** Forget every cached document (tests). */
export function clearClientMetadataCache(): void {
  metadataCache.clear();
}

/** A pinned copy used because the live document could not be fetched is reused this long. */
const PINNED_FALLBACK_CACHE_MS = 10 * 60 * 1000;

function rememberDocument(
  client: ResolvedAiClient,
  now: number,
  forMs: number = CLIENT_METADATA_CACHE_MS,
): void {
  metadataCache.delete(client.clientId);
  if (metadataCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = metadataCache.keys().next();
    if (oldest.done !== true) metadataCache.delete(oldest.value);
  }
  metadataCache.set(client.clientId, { client, expiresAt: now + forMs });
}

/** A URL client_id that is safe to fetch at all: https, a real path, no userinfo, fragment or odd port. */
function parseClientIdUrl(clientId: string): Result<URL, AiClientRefusal> {
  const bad = (message: string) => err(refusal('invalid_client', message));
  if (clientId.includes('#')) return bad('client id has a fragment');
  if (clientId.includes('\\')) return bad('client id has a backslash');
  const url = parseUrl(clientId);
  if (url === null) return bad('client id is not a valid URL');
  if (url.protocol !== 'https:') return bad('client id is not an https URL');
  if (url.username !== '' || url.password !== '') return bad('client id has userinfo');
  // The URL parser drops an explicit :443 for https, so an empty port means 443 or the default.
  if (url.port !== '') return bad('client id uses a non-standard port');
  if (url.pathname === '' || url.pathname === '/') return bad('client id has no path');
  // The parser quietly resolves "." and ".." segments, so they are looked for in the raw text.
  const afterScheme = clientId.slice(clientId.indexOf('//') + 2);
  const pathStart = afterScheme.indexOf('/');
  const rawPath = pathStart < 0 ? '' : afterScheme.slice(pathStart);
  if (/(^|\/)\.\.?(\/|$|\?)/.test(rawPath) || /%2e/i.test(rawPath)) {
    return bad('client id path has dot segments');
  }
  return ok(url);
}

/** Validate a client metadata document against the URL it came from and the app's allowlist. */
function clientFromDocument(
  document: unknown,
  clientId: string,
  app: SupportedAiApp,
  host: string,
  source: 'metadata_document' | 'pinned',
): Result<ResolvedAiClient, AiClientRefusal> {
  const bad = (message: string) => err(refusal('invalid_client', message));
  if (!isRecord(document)) return bad('client document is not a JSON object');
  const {
    client_id: documentClientId,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: method,
  } = document;
  if (documentClientId !== clientId) return bad('client document client_id does not match its URL');
  if (method !== undefined && method !== 'none') {
    return bad('client document is a confidential client; only public clients are supported');
  }
  if (!Array.isArray(uris) || uris.length === 0) return bad('client document has no redirect_uris');
  if (uris.length > MAX_DOCUMENT_REDIRECT_URIS)
    return bad('client document has too many redirect_uris');
  const redirectUris: string[] = [];
  for (const uri of uris) {
    if (typeof uri !== 'string') return bad('client document redirect_uris must be strings');
    // Only the app's own published sign-in return paths, the same rule self-registration uses, so
    // no other page on the app's host can ever receive a code.
    const onAppHost =
      isAllowedHttpsRedirect(uri, app.redirectHosts) && isKnownAppReturnAddress(uri);
    if (!onAppHost && !isLoopbackRedirect(uri)) {
      return bad('client document lists a redirect address outside the app allowlist');
    }
    if (!redirectUris.includes(uri)) redirectUris.push(uri);
  }
  return ok({
    clientId,
    clientName: cleanClientName(name, app.name),
    appKey: app.key,
    host,
    redirectUris,
    source,
    loopbackOnly: redirectUris.every(isLoopbackRedirect),
  });
}

function isJsonContentType(header: string | null): boolean {
  if (header === null) return false;
  const type = (header.split(';')[0] ?? '').trim().toLowerCase();
  return type === 'application/json' || /^application\/[a-z0-9.!#$&^_-]+\+json$/.test(type);
}

/** Read at most `limit` bytes of the body as UTF-8, or null when it is longer. */
async function readCapped(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
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
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Settle with the promise, or reject as soon as the signal aborts (the shared 5 s deadline). */
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

async function defaultLookup(host: string): Promise<readonly string[]> {
  const results = await dnsLookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

type LiveDocument =
  | { readonly kind: 'document'; readonly document: unknown }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

/**
 * Fetch the document under the SSRF rules. "unavailable" (the network failed, the app's bot
 * protection answered instead, or the answer was not a usable JSON document) may fall back to a
 * pinned copy; "refused" (the host resolved to a non-public address) never does, because that
 * points at a tampered resolver rather than a busy app.
 */
async function loadLiveDocument(url: URL, deps: ClientMetadataDeps): Promise<LiveDocument> {
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const unavailable = (message: string): LiveDocument => ({ kind: 'unavailable', message });
  // Best effort only: fetch resolves the name again, so a resolver that changes its answer
  // between these two lookups (DNS rebinding) is not fully excluded here. The host allowlist,
  // checked before this point, is the primary control: only the apps' own hosts are ever fetched.
  let addresses: readonly string[];
  try {
    addresses = await beforeDeadline((deps.lookup ?? defaultLookup)(url.hostname), deadline);
  } catch {
    return unavailable('client document host could not be resolved in time');
  }
  if (addresses.length === 0) return unavailable('client document host has no addresses');
  if (!addresses.every(isPublicAddress)) {
    return { kind: 'refused', message: 'client document host resolves to a non-public address' };
  }
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url.href, {
      method: 'GET',
      redirect: 'manual',
      signal: deadline,
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
  } catch {
    return unavailable('client document could not be fetched in time');
  }
  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel().catch(() => undefined);
    return unavailable(`client document answered with status ${response.status}`);
  }
  if (!isJsonContentType(response.headers.get('content-type'))) {
    await response.body?.cancel().catch(() => undefined);
    return unavailable('client document is not JSON');
  }
  let text: string | null;
  try {
    text = await readCapped(response, MAX_DOCUMENT_BYTES);
  } catch {
    return unavailable('client document could not be read in time');
  }
  if (text === null) return unavailable('client document is larger than 64 KiB');
  try {
    return { kind: 'document', document: JSON.parse(text) as unknown };
  } catch {
    return unavailable('client document is not valid JSON');
  }
}

/**
 * Resolve a URL client_id by fetching its Client ID Metadata Document under strict SSRF rules:
 * an https URL on a supported app's host (refused before any network call otherwise), public
 * addresses only, no redirects, 5 s, JSON only, 64 KiB at most. A valid document is cached for
 * 24 h. When the fetch itself fails, the pinned copy for that exact client_id is used if one
 * exists.
 */
export async function fetchClientMetadataDocument(
  clientId: string,
  deps: ClientMetadataDeps = {},
): Promise<Result<ResolvedAiClient, AiClientRefusal>> {
  const parsed = parseClientIdUrl(clientId);
  if (!parsed.ok) return parsed;
  const url = parsed.value;
  const app = appForHost(url.hostname);
  if (app === undefined)
    return err(refusal('unsupported_app', 'client host is not a supported AI app'));
  const now = (deps.now ?? (() => new Date()))().getTime();
  const cached = metadataCache.get(clientId);
  if (cached !== undefined && cached.expiresAt > now) return ok(cached.client);
  if (cached !== undefined) metadataCache.delete(clientId);

  const live = await loadLiveDocument(url, deps);
  if (live.kind === 'document') {
    const client = clientFromDocument(
      live.document,
      clientId,
      app,
      url.hostname,
      'metadata_document',
    );
    if (client.ok) rememberDocument(client.value, now);
    return client;
  }
  if (live.kind === 'refused') return err(refusal('unreachable', live.message));
  const pinned = PINNED_CLIENT_DOCUMENTS.get(clientId);
  if (pinned !== undefined) {
    // Briefly reused, so a host that blocks server fetches does not cost every page view a
    // failed fetch; the live document is tried again after that.
    const client = clientFromDocument(pinned, clientId, app, url.hostname, 'pinned');
    if (client.ok) rememberDocument(client.value, now, PINNED_FALLBACK_CACHE_MS);
    return client;
  }
  return err(refusal('unreachable', live.message));
}

// --- Dynamic Client Registration (RFC 7591) -----------------------------------------------------

export interface AiClientRegistration {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method: 'none';
  readonly grant_types: readonly ['authorization_code', 'refresh_token'];
  readonly response_types: readonly ['code'];
  readonly client_id_issued_at: number;
}

export interface AiClientRegistrationError {
  readonly error: 'invalid_redirect_uri' | 'invalid_client_metadata' | 'rate_limited';
  readonly error_description: string;
}

export interface RegisterAiClientInput {
  readonly body: unknown;
  /** The caller's network address, already hashed or otherwise reduced by the route. */
  readonly ipSubject: string;
  readonly now?: Date;
}

function registrationError(
  error: AiClientRegistrationError['error'],
  description: string,
): Result<never, AiClientRegistrationError> {
  return err({ error, error_description: description });
}

function isSubsetOf(value: unknown, allowed: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && allowed.includes(item))
  );
}

interface ValidRegistration {
  readonly clientName: string;
  readonly redirectUris: string[];
}

function validateRegistration(body: unknown): Result<ValidRegistration, AiClientRegistrationError> {
  if (!isRecord(body))
    return registrationError('invalid_client_metadata', 'the body must be a JSON object');
  const {
    client_name: name,
    grant_types: grantTypes,
    redirect_uris: uris,
    response_types: responseTypes,
    token_endpoint_auth_method: method,
  } = body;
  if (!Array.isArray(uris) || uris.length === 0) {
    return registrationError('invalid_redirect_uri', 'redirect_uris must be a non-empty array');
  }
  if (uris.length > MAX_REGISTERED_REDIRECT_URIS) {
    return registrationError('invalid_redirect_uri', 'at most 10 redirect_uris are accepted');
  }
  const redirectUris: string[] = [];
  for (const uri of uris) {
    if (typeof uri !== 'string')
      return registrationError('invalid_redirect_uri', 'redirect_uris must be strings');
    if (!isKnownAppReturnAddress(uri) && !isLoopbackRedirect(uri)) {
      return registrationError(
        'invalid_redirect_uri',
        'each redirect URI must be a supported AI app sign-in return address, or http://localhost or http://127.0.0.1',
      );
    }
    if (!redirectUris.includes(uri)) redirectUris.push(uri);
  }
  if (method !== undefined && method !== 'none') {
    return registrationError(
      'invalid_client_metadata',
      'only public clients are supported: token_endpoint_auth_method must be "none"',
    );
  }
  if (grantTypes !== undefined && !isSubsetOf(grantTypes, SUPPORTED_GRANT_TYPES)) {
    return registrationError(
      'invalid_client_metadata',
      'grant_types may contain only authorization_code and refresh_token',
    );
  }
  if (responseTypes !== undefined && !isSubsetOf(responseTypes, SUPPORTED_RESPONSE_TYPES)) {
    return registrationError('invalid_client_metadata', 'response_types may contain only code');
  }
  if (name !== undefined && typeof name !== 'string') {
    return registrationError('invalid_client_metadata', 'client_name must be a string');
  }
  return ok({ clientName: cleanClientName(name, DEFAULT_REGISTERED_NAME), redirectUris });
}

/**
 * Register a public AI client (RFC 7591). Every attempt counts against the caller's network
 * address first, so a stream of junk registrations is bounded as well. The new client is
 * forgotten after 30 days unused.
 */
export async function registerAiClient(
  db: Db,
  input: RegisterAiClientInput,
): Promise<Result<AiClientRegistration, AiClientRegistrationError>> {
  const now = input.now ?? new Date();
  const limit = await checkRateLimit(
    db,
    { subjectId: input.ipSubject, action: 'ai.client_register', label: 'ai' },
    RATE_LIMITS.AI_CLIENT_REGISTER_IP,
    now,
  );
  if (!limit.allowed) return registrationError('rate_limited', limit.reason);
  const valid = validateRegistration(input.body);
  if (!valid.ok) return valid;
  const clientId = `${REGISTERED_CLIENT_PREFIX}${randomBytes(32).toString('base64url')}`;
  await db.insert(schema.oauthClients).values({
    clientId,
    clientName: valid.value.clientName,
    redirectUris: valid.value.redirectUris,
    createdAt: now,
  });
  return ok({
    client_id: clientId,
    client_name: valid.value.clientName,
    redirect_uris: valid.value.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(now.getTime() / 1000),
  });
}

async function resolveRegisteredClient(
  db: Db,
  clientId: string,
  now: Date,
): Promise<Result<ResolvedAiClient, AiClientRefusal>> {
  const unknown = err(refusal('invalid_client', 'registered client is unknown or expired'));
  if (!REGISTERED_CLIENT_ID_PATTERN.test(clientId)) return unknown;
  let rows: (typeof schema.oauthClients.$inferSelect)[];
  try {
    rows = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, clientId))
      .limit(1);
  } catch (error) {
    // Between a deploy and its migration the table may not exist yet: no registered clients.
    if (isMissingRelationError(error)) return unknown;
    throw error;
  }
  const row = rows[0];
  if (row === undefined) return unknown;
  const lastActive = (row.lastUsedAt ?? row.createdAt).getTime();
  if (now.getTime() - lastActive > REGISTERED_CLIENT_UNUSED_MS) return unknown;
  const redirectUris = [...row.redirectUris];
  const firstHttps = redirectUris.find((uri) => !isLoopbackRedirect(uri));
  const host =
    firstHttps === undefined ? LOOPBACK_CLIENT_HOST : (parseUrl(firstHttps)?.hostname ?? '');
  return ok({
    clientId: row.clientId,
    clientName: row.clientName,
    appKey: firstHttps === undefined ? null : (appForRedirectHost(host)?.key ?? null),
    host,
    redirectUris,
    source: 'registered',
    loopbackOnly: firstHttps === undefined,
  });
}

/** Resolve any client_id: a registered "vsc_" id from the database, otherwise a CIMD URL. */
export async function resolveAiClient(
  db: Db,
  clientId: string,
  deps: ClientMetadataDeps = {},
): Promise<Result<ResolvedAiClient, AiClientRefusal>> {
  if (clientId.startsWith(REGISTERED_CLIENT_PREFIX)) {
    return resolveRegisteredClient(db, clientId, (deps.now ?? (() => new Date()))());
  }
  return fetchClientMetadataDocument(clientId, deps);
}

/** Mark a registered client as used, at most once a minute. CIMD clients have nothing to mark. */
export async function touchAiClient(
  db: Db,
  clientId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!clientId.startsWith(REGISTERED_CLIENT_PREFIX)) return;
  const recent = new Date(now.getTime() - TOUCH_INTERVAL_MS);
  try {
    await db
      .update(schema.oauthClients)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(schema.oauthClients.clientId, clientId),
          or(isNull(schema.oauthClients.lastUsedAt), lt(schema.oauthClients.lastUsedAt, recent)),
        ),
      );
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }
}

/** Delete registered clients unused for 30 days. Returns how many were removed. */
export async function deleteStaleAiClients(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REGISTERED_CLIENT_UNUSED_MS);
  try {
    const deleted = await db
      .delete(schema.oauthClients)
      .where(
        or(
          lt(schema.oauthClients.lastUsedAt, cutoff),
          and(isNull(schema.oauthClients.lastUsedAt), lt(schema.oauthClients.createdAt, cutoff)),
        ),
      )
      .returning({ id: schema.oauthClients.id });
    return deleted.length;
  } catch (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }
}
