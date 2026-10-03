/**
 * Reduces a browser's Content-Security-Policy violation report to the few
 * fields worth keeping in an operational log.
 *
 * A raw report carries the full URL of the page (query string included, which
 * can hold an invitation token), a sample of the blocked inline script (which
 * for a Next.js page is a slice of the render payload, i.e. user data) and the
 * whole policy. None of that is kept: only the violated directive, the origin
 * that was blocked, the page's route with identifiers templated out, and where
 * in the source the violation happened.
 */

export interface CspViolationSummary {
  readonly directive: string;
  readonly blocked: string;
  readonly page: string;
  readonly source: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly disposition: 'enforce' | 'report';
}

const MAX_FIELD_LENGTH = 120;

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const DIRECTIVE_NAME = /^[a-z-]{1,40}$/;
/** Schemes of browser extensions, which inject scripts the site cannot control. */
const EXTENSION_SCHEME = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;
/** Keywords a browser reports instead of a URL. */
const BLOCKED_KEYWORDS: ReadonlySet<string> = new Set([
  'inline',
  'eval',
  'wasm-eval',
  'data',
  'blob',
  'about',
  'filesystem',
  'trusted-types-policy',
  'trusted-types-sink',
  'self',
]);

/** Variable-keyed read, so a hyphenated report field and a plain one read the same way. */
function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.trunc(value), 1_000_000)
    : null;
}

/** Replaces path segments that look like identifiers or tokens with `:id`. */
export function templatizePath(pathname: string): string {
  const segments = pathname.split('/').map((segment) => {
    if (segment === '') return segment;
    if (
      UUID_SEGMENT.test(segment) ||
      HEX_SEGMENT.test(segment) ||
      NUMERIC_SEGMENT.test(segment) ||
      segment.length >= 24
    ) {
      return ':id';
    }
    return segment;
  });
  return segments.join('/').slice(0, MAX_FIELD_LENGTH);
}

function originOf(url: URL): string {
  return url.origin === 'null' ? url.protocol : url.origin;
}

function summarizeBlocked(value: string | null): string {
  if (!value) return 'unknown';
  if (BLOCKED_KEYWORDS.has(value)) return value;
  try {
    return originOf(new URL(value)).slice(0, MAX_FIELD_LENGTH);
  } catch {
    return 'unknown';
  }
}

function summarizePage(value: string | null): string {
  if (!value) return 'unknown';
  try {
    return templatizePath(new URL(value).pathname) || '/';
  } catch {
    return 'unknown';
  }
}

/**
 * The script a violation came from. A build artifact under `/_next/static/`
 * keeps its hashed file name, since naming the chunk is the point and it is
 * public; any other path is templated like a page route.
 */
function summarizeSource(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const path = url.pathname.startsWith('/_next/static/')
      ? url.pathname
      : templatizePath(url.pathname);
    return `${originOf(url)}${path}`.slice(0, MAX_FIELD_LENGTH);
  } catch {
    return null;
  }
}

function summarizeDirective(report: Record<string, unknown>): string {
  const raw =
    asString(field(report, 'effective-directive')) ?? asString(field(report, 'violated-directive'));
  const name = raw?.split(/\s+/)[0]?.toLowerCase() ?? '';
  return DIRECTIVE_NAME.test(name) ? name : 'unknown';
}

export interface LogAdmission {
  readonly log: boolean;
  /** Reports dropped in the window that just ended; non-zero only on the first call of a new window. */
  readonly suppressedBefore: number;
}

/**
 * Caps how many reports one server instance writes to the log per window. The
 * endpoint is public and unauthenticated, so without a cap anyone could turn
 * it into a log-volume bill. State lives in the instance, which is enough:
 * the aim is to bound the worst case, not to count precisely.
 */
export function createLogThrottle(
  maxPerWindow: number,
  windowMs: number,
): (now: number) => LogAdmission {
  let windowStart = Number.NEGATIVE_INFINITY;
  let logged = 0;
  let suppressed = 0;
  return (now) => {
    let suppressedBefore = 0;
    if (now - windowStart >= windowMs) {
      suppressedBefore = suppressed;
      windowStart = now;
      logged = 0;
      suppressed = 0;
    }
    if (logged < maxPerWindow) {
      logged += 1;
      return { log: true, suppressedBefore };
    }
    suppressed += 1;
    return { log: false, suppressedBefore };
  };
}

/**
 * Accepts the legacy `report-uri` body (`{"csp-report": {...}}`), which is what
 * every browser sends for the policy this app serves. Returns `null` for
 * anything else, and for violations caused by a browser extension, which the
 * site cannot fix and which would otherwise drown out real ones.
 */
export function parseCspReport(body: unknown): CspViolationSummary | null {
  if (typeof body !== 'object' || body === null) return null;
  const inner = field(body as Record<string, unknown>, 'csp-report');
  if (typeof inner !== 'object' || inner === null) return null;
  const report = inner as Record<string, unknown>;

  const blockedUri = asString(field(report, 'blocked-uri'));
  const sourceFile = asString(field(report, 'source-file'));
  if (
    (blockedUri && EXTENSION_SCHEME.test(blockedUri)) ||
    (sourceFile && EXTENSION_SCHEME.test(sourceFile))
  ) {
    return null;
  }

  return {
    directive: summarizeDirective(report),
    blocked: summarizeBlocked(blockedUri),
    page: summarizePage(asString(field(report, 'document-uri'))),
    source: summarizeSource(sourceFile),
    line: asCount(field(report, 'line-number')),
    column: asCount(field(report, 'column-number')),
    disposition: field(report, 'disposition') === 'report' ? 'report' : 'enforce',
  };
}
