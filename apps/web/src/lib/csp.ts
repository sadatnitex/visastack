/**
 * Site-wide Content-Security-Policy (Commercial V1 SEC-02; directive Part 9
 * section 6, "Browser/application security": CSP and frame restrictions).
 *
 * Pure policy construction only. Nothing here reads a request or touches Next,
 * so every directive is unit-testable; `csp-middleware.ts` generates a nonce
 * per request and applies the result.
 *
 * Shape of the policy:
 * - `script-src` is the load-bearing directive. It admits only scripts that
 *   carry this request's nonce, plus scripts those nonced scripts load
 *   (`'strict-dynamic'`, which is how the Next.js runtime loads its chunks).
 *   A browser that honours `'strict-dynamic'` ignores `'self'` and host sources
 *   in `script-src`, so a same-origin file is not a usable script source. That
 *   matters here because the app serves user uploads from `/api/blob/[key]`.
 *   `'self'` stays only as the fallback for browsers that predate
 *   `'strict-dynamic'`.
 * - `style-src` keeps `'unsafe-inline'`: React `style={{...}}` props render as
 *   inline style attributes across the app, and a nonce cannot cover an
 *   attribute. The accepted cost is that injected CSS would apply. Reaching
 *   that needs an HTML-injection sink, and the app has none (no
 *   `dangerouslySetInnerHTML`; see docs/commercial-v1/known-issues.md,
 *   Chunk 34).
 * - Everything else is same-origin or none. The app embeds no frames, objects
 *   or media and loads no third-party script, style, font or API, so a new
 *   third-party resource fails closed until someone adds it here on purpose.
 *
 * A nonce only works on a page rendered per request. Every page is dynamic
 * today because the root layout reads the session (`withAuth()`), which is why
 * `next build` prerenders nothing. A statically generated page would ship a
 * stale nonce and its scripts would be blocked.
 */

export type CspMode = 'enforce' | 'report-only';

export const CSP_HEADER_ENFORCE = 'Content-Security-Policy';
export const CSP_HEADER_REPORT_ONLY = 'Content-Security-Policy-Report-Only';

/** Same-origin endpoint browsers post violation reports to (see api/csp-report). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** Request header carrying the per-request nonce to Server Components. */
export const NONCE_REQUEST_HEADER = 'x-nonce';

const SELF = "'self'";
const NONE = "'none'";

/**
 * Hosts a WorkOS-hosted sign-in or re-authentication redirect passes through.
 * `form-action` also governs the redirects that follow a form submission in
 * Chromium, and a step-up Server Action answers with a redirect to WorkOS. A
 * WorkOS custom AuthKit domain is not knowable here: list it in
 * `CSP_FORM_ACTION_EXTRA` (see `.env.example`).
 */
const WORKOS_FORM_ACTION_ORIGINS: readonly string[] = [
  'https://api.workos.com',
  'https://*.authkit.app',
];

/**
 * Vercel's documented Content-Security-Policy allowances for its preview
 * toolbar (https://vercel.com/docs/vercel-toolbar/managing-toolbar). Added on
 * preview deployments only; never on production.
 *
 * A browser that honours `'strict-dynamic'` ignores the host in `script-src`,
 * so the toolbar's own script can still be refused on a preview. That costs
 * the preview-comments overlay and nothing else. Setting
 * `VERCEL_PREVIEW_FEEDBACK_ENABLED=0` on the Preview environment removes the
 * overlay (and the console noise) outright.
 */
const VERCEL_TOOLBAR = {
  script: ['https://vercel.live'],
  style: ['https://vercel.live'],
  connect: ['https://vercel.live', 'wss://ws-us3.pusher.com'],
  img: ['https://vercel.live', 'https://vercel.com', 'data:', 'blob:'],
  frame: ['https://vercel.live'],
  font: ['https://vercel.live', 'https://assets.vercel.com'],
} as const satisfies Record<string, readonly string[]>;

const NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** A bare `http(s)://host[:port]` origin, lower-case, nothing else. */
const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

/** An `https://host[:port]` form-action origin, optionally with a leading `*.`. */
const FORM_ACTION_ORIGIN_PATTERN = /^https:\/\/(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

/**
 * A fresh 128-bit nonce, base64 encoded. Always matches the shape Next.js
 * accepts when it reads the nonce back out of the policy header.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * `CSP_MODE=report-only` serves the policy without enforcing it: the rollback
 * lever if a page is found broken in production. Anything else, including an
 * unset, blank or misspelled value, enforces.
 */
export function resolveCspMode(value: string | undefined): CspMode {
  return value?.trim().toLowerCase() === 'report-only' ? 'report-only' : 'enforce';
}

export function cspHeaderName(mode: CspMode): string {
  return mode === 'report-only' ? CSP_HEADER_REPORT_ONLY : CSP_HEADER_ENFORCE;
}

/**
 * The canonical origin the app mints absolute URLs for (signed blob/logo
 * URLs, invitation links). Same precedence as `resolveBaseUrl()` in
 * `base-url.ts`, which is `server-only` and so cannot be imported into the
 * middleware; `csp.test.ts` pins the two together. Returns `undefined`
 * rather than a guess when nothing usable is configured.
 */
export function resolveAppOrigin(
  readEnv: (name: string) => string | undefined,
): string | undefined {
  // A preview must never mint links to production or an old deployment.
  if (readEnv('VERCEL_ENV') === 'preview') {
    const preview = readEnv('VERCEL_BRANCH_URL') || readEnv('VERCEL_URL');
    if (preview) {
      const origin = toOrigin(`https://${preview}`);
      if (origin) return origin;
    }
  }
  const explicit = readEnv('NEXT_PUBLIC_APP_URL');
  if (explicit) return toOrigin(explicit);
  const vercel = readEnv('VERCEL_PROJECT_PRODUCTION_URL');
  if (vercel) return toOrigin(`https://${vercel}`);
  const redirect = readEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI');
  if (redirect) return toOrigin(redirect);
  return undefined;
}

/**
 * The origin of `value`, or `undefined` if it is not a plain http(s) URL.
 * The result is re-checked against a strict pattern because a host can
 * legally contain `;` or `,`, which would otherwise start a new directive.
 */
export function toOrigin(value: string): string | undefined {
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    return undefined;
  }
  return ORIGIN_PATTERN.test(origin) ? origin : undefined;
}

/**
 * `CSP_FORM_ACTION_EXTRA`: extra `https://host` origins (whitespace or comma
 * separated, `*.` wildcard allowed) a form may submit or redirect to. Entries
 * that are not a plain https origin are dropped, never passed through, so a
 * typo cannot widen the policy or break the header.
 */
export function parseFormActionOrigins(value: string | undefined): readonly string[] {
  if (!value) return [];
  const accepted = new Set<string>();
  for (const entry of value.split(/[\s,]+/)) {
    const candidate = entry.trim().toLowerCase();
    if (FORM_ACTION_ORIGIN_PATTERN.test(candidate)) accepted.add(candidate);
  }
  return [...accepted];
}

export interface ContentSecurityPolicyOptions {
  /** This request's nonce, from `generateNonce()`. */
  readonly nonce: string;
  /** Origin the app mints absolute URLs for; see `resolveAppOrigin`. */
  readonly appOrigin?: string | undefined;
  /** Extra form-action origins; see `parseFormActionOrigins`. */
  readonly extraFormActionOrigins?: readonly string[] | undefined;
  /** Vercel preview deployments only: add the documented toolbar allowances. */
  readonly vercelPreviewToolbar?: boolean | undefined;
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  if (!NONCE_PATTERN.test(options.nonce)) {
    throw new Error('Content-Security-Policy nonce must be base64');
  }
  const toolbar = options.vercelPreviewToolbar === true;
  const appOrigin = options.appOrigin ? [options.appOrigin] : [];

  const directives: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['default-src', [SELF]],
    [
      'script-src',
      [
        SELF,
        `'nonce-${options.nonce}'`,
        "'strict-dynamic'",
        ...(toolbar ? VERCEL_TOOLBAR.script : []),
      ],
    ],
    ['style-src', [SELF, "'unsafe-inline'", ...(toolbar ? VERCEL_TOOLBAR.style : [])]],
    // The organization logo is a signed `/api/blob/...` URL minted against the
    // canonical origin, which differs from the request's own origin when the
    // app is opened through an alias.
    ['img-src', [SELF, ...appOrigin, ...(toolbar ? VERCEL_TOOLBAR.img : [])]],
    ['font-src', [SELF, ...(toolbar ? VERCEL_TOOLBAR.font : [])]],
    ['connect-src', [SELF, ...(toolbar ? VERCEL_TOOLBAR.connect : [])]],
    ['frame-src', toolbar ? VERCEL_TOOLBAR.frame : [NONE]],
    ['object-src', [NONE]],
    ['base-uri', [SELF]],
    [
      'form-action',
      [
        SELF,
        ...appOrigin,
        ...WORKOS_FORM_ACTION_ORIGINS,
        ...(options.extraFormActionOrigins ?? []),
      ],
    ],
    ['frame-ancestors', [NONE]],
    ['report-uri', [CSP_REPORT_PATH]],
  ];

  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
