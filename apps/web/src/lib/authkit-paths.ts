/**
 * Which requests the AuthKit middleware must handle.
 *
 * Before the Content-Security-Policy work, `middleware.ts` listed these routes
 * in its `config.matcher`, so Next ran AuthKit on them and on nothing else:
 *
 *   ['/', '/status', '/app', '/app/:path*', '/callback', '/pilot-access-denied']
 *
 * `/pilot-access-denied` sits outside `/app` on purpose, so the `/app` layout's
 * `withSession` call (which would re-run the pilot-access check and loop) never
 * wraps it, yet AuthKit still runs on it so its own read-only `withAuth()` call
 * gets the same middleware-refreshed token every other signed-in page gets
 * (docs/audits/post-programme-defect-register.md finding #2).
 *
 * The policy has to ride on every page response (including `/trust` and the
 * not-found page), so the matcher is now broad and this predicate keeps the
 * AuthKit set exactly where it was. `/trust` stays AuthKit-free on purpose: a
 * public page must keep working when WorkOS is slow or down.
 *
 * "Exactly" is checked, not asserted: `authkit-paths.test.ts` compares this with
 * Next's own compilation of the original matcher over a corpus of awkward paths.
 * Next tests the matcher against the raw pathname and again against its
 * percent-decoded form, and the expressions it generates also admit a
 * `/_next/data/<build>` prefix, a `.json`/`.rsc`/`.segments/...` suffix, one
 * trailing `/`, and `/index` for the root. This mirrors each of those, in the
 * order the generated expression applies them. A request that skipped AuthKit
 * but still reached a protected page would fail closed with a 500 (`withAuth()`
 * throws outside the middleware) rather than sign the visitor in.
 *
 * The URL the middleware receives has also been normalized by Next's adapter
 * (a trailing `.rsc` removed, the `/_next/data/<build>` prefix removed, dot
 * segments collapsed by the URL parser), and the test feeds it the same way.
 * Dot segments are the one place the two can disagree, and only toward a 404:
 * `/app/%2e%2e/trust` used to be handed to AuthKit and is now a plain 404,
 * because Next does not collapse dot segments when it routes.
 */

const DATA_ROUTE_PREFIX = /^\/_next\/data\/[^/]+/;
const TRAILING_DELIMITER = /[/#?]$/;
const DATA_ROUTE_SUFFIX = /(\.json|\.rsc|\.segments\/.+\.segment\.rsc)$/;

const ROOT = /^(?:\/?\/index)?$/;
const EXACT_ROUTE = /^\/(?:status|app|callback|pilot-access-denied)$/;
const APP_SUBTREE = /^\/app(?:\/[^/#?]+)+$/;

function isCoveredRoute(route: string): boolean {
  return ROOT.test(route) || EXACT_ROUTE.test(route) || APP_SUBTREE.test(route);
}

function coversAuthkit(pathname: string): boolean {
  const withoutPrefix = pathname.replace(DATA_ROUTE_PREFIX, '');
  const withoutDelimiter = withoutPrefix.replace(TRAILING_DELIMITER, '');
  // The suffix is optional in the generated expression, and `/app/.json` is
  // also a perfectly good `/app/:path*` segment, so both readings are tried.
  return (
    isCoveredRoute(withoutDelimiter) ||
    isCoveredRoute(withoutDelimiter.replace(DATA_ROUTE_SUFFIX, ''))
  );
}

/**
 * `pathname` is what the middleware is handed, which is not what Next matched on:
 * Next's adapter strips a trailing `.rsc` from the URL first (`normalizeRscURL`),
 * so `/app.segments/x.segment.rsc` arrives as `/app.segments/x.segment`. Putting
 * the `.rsc` back recovers the form the original matcher accepted.
 */
function coversAuthkitIncludingStrippedRsc(pathname: string): boolean {
  return coversAuthkit(pathname) || coversAuthkit(`${pathname}.rsc`);
}

export function isAuthkitPath(pathname: string): boolean {
  if (coversAuthkitIncludingStrippedRsc(pathname)) return true;
  try {
    return coversAuthkitIncludingStrippedRsc(decodeURIComponent(pathname));
  } catch {
    return false;
  }
}
