import { type NextMiddleware, NextRequest, NextResponse } from 'next/server';
import {
  CSP_HEADER_ENFORCE,
  CSP_HEADER_REPORT_ONLY,
  DOCUMENT_DOWNLOAD_POLICY,
  NONCE_REQUEST_HEADER,
  buildContentSecurityPolicy,
  cspHeaderName,
  generateNonce,
  isDocumentDownloadPath,
  parseFormActionOrigins,
  resolveAppOrigin,
  resolveCspMode,
} from './csp';

type MiddlewareResult = Awaited<ReturnType<NextMiddleware>>;

export interface CspMiddlewareDeps {
  /** The sign-in middleware (Neon Auth), wrapped unchanged. */
  readonly auth: NextMiddleware;
  /** Whether this path needs a signed-in session; see `identity-selection.ts`. */
  readonly needsSignIn: (pathname: string) => boolean;
  /**
   * False outside a production build. The development server needs
   * `'unsafe-eval'` and a hot-reload socket, so the policy is not applied there.
   */
  readonly enabled: boolean;
  /** Variable-keyed env read, resolved per request. */
  readonly readEnv: (name: string) => string | undefined;
  /** Replaceable so tests can assert on a known nonce. */
  readonly makeNonce?: () => string;
}

/**
 * Puts a per-request nonce and Content-Security-Policy on every page response
 * and runs the sign-in middleware, untouched, for the paths that need it.
 *
 * The policy goes on the *request* as well as the response. Next.js reads the
 * nonce back out of the request's policy header and stamps it on the inline
 * scripts it renders, so a nonce that only reached the response would leave the
 * app's own scripts blocked. The sign-in middleware builds its forwarded request
 * headers from the request it is given, so handing it a copy that already
 * carries the policy gets the headers through to the render. The copy has no
 * body: the sign-in check never reads one, and building it from the original
 * would consume the stream a Server Action still needs.
 */
export function createCspMiddleware(deps: CspMiddlewareDeps): NextMiddleware {
  const makeNonce = deps.makeNonce ?? generateNonce;

  return async function cspMiddleware(request, event) {
    const runAuth = deps.needsSignIn(request.nextUrl.pathname);

    if (!deps.enabled) {
      return runAuth ? deps.auth(request, event) : NextResponse.next();
    }

    const nonce = makeNonce();
    const mode = resolveCspMode(deps.readEnv('CSP_MODE'));
    const headerName = cspHeaderName(mode);
    const policy = buildContentSecurityPolicy({
      nonce,
      appOrigin: resolveAppOrigin(deps.readEnv),
      extraFormActionOrigins: parseFormActionOrigins(deps.readEnv('CSP_FORM_ACTION_EXTRA')),
      vercelPreviewToolbar: deps.readEnv('VERCEL_ENV') === 'preview',
    });

    const requestHeaders = new Headers(request.headers);
    // `set` overwrites anything the client sent under these names. Next prefers
    // the enforcing header when both are present, so the other one is dropped.
    requestHeaders.set(NONCE_REQUEST_HEADER, nonce);
    requestHeaders.set(headerName, policy);
    requestHeaders.delete(mode === 'report-only' ? CSP_HEADER_ENFORCE : CSP_HEADER_REPORT_ONLY);

    let response: MiddlewareResult = undefined;
    if (runAuth) {
      const authRequest = new NextRequest(request.url, {
        method: request.method,
        headers: requestHeaders,
      });
      response = await deps.auth(authRequest, event);
    }
    if (!response) {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
    if (isDocumentDownloadPath(request.nextUrl.pathname)) {
      // A downloaded document keeps the strictest policy, enforced, never the page policy.
      response.headers.delete(CSP_HEADER_REPORT_ONLY);
      response.headers.set(CSP_HEADER_ENFORCE, DOCUMENT_DOWNLOAD_POLICY);
      return response;
    }
    response.headers.set(headerName, policy);
    return response;
  };
}
