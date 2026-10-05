import * as pageStaticInfo from 'next/dist/build/analysis/get-page-static-info';
import { normalizeRscURL } from 'next/dist/shared/lib/router/utils/app-paths';
import { describe, expect, it } from 'vitest';
import { isAuthkitPath } from './authkit-paths';

/**
 * The AuthKit route set is part of the app's authentication boundary, so it is
 * pinned two ways: by name (what must and must not be covered), and against
 * Next's own compilation of the matcher the middleware used before the
 * Content-Security-Policy work, which is the definition of "unchanged".
 */

const ORIGINAL_MATCHER = [
  '/',
  '/status',
  '/app',
  '/app/:path*',
  '/callback',
  '/pilot-access-denied',
];

// Next compiles `config.matcher` entries with this function but does not export
// it in its type declarations, so its shape is stated here. If a Next upgrade
// moves or renames it, this import fails loudly rather than the test going quiet.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (
    matcher: readonly string[],
    nextConfig: Record<string, unknown>,
  ) => ReadonlyArray<{ readonly regexp: string }>;
};

const ORIGINAL_MATCHERS = getMiddlewareMatchers(ORIGINAL_MATCHER, {});

/**
 * What Next did with the original matcher: its compiled expressions tried
 * against the raw pathname, then against the percent-decoded one (see
 * `resolve-routes` in the Next server). The pathname is handed to the
 * expressions as a string, never re-parsed as a URL, so a decoded `?` or `#`
 * stays part of the path exactly as it does in the server.
 */
function originalMatcherCovers(pathname: string): boolean {
  const matches = (path: string) => ORIGINAL_MATCHERS.some((m) => new RegExp(m.regexp).test(path));
  if (matches(pathname)) return true;
  try {
    return matches(decodeURIComponent(pathname));
  } catch {
    return false;
  }
}

describe('isAuthkitPath', () => {
  it.each([
    '/',
    '/status',
    '/callback',
    '/pilot-access-denied',
    '/app',
    '/app/applicant/abc',
    '/app/mission/1/snapshots/2',
    '/app/privacy/export',
    '/app/admin',
  ])('runs AuthKit on %s', (path) => {
    expect(isAuthkitPath(path)).toBe(true);
  });

  it.each([
    '/trust',
    '/trust/uk-skilled-worker',
    '/trust/uk-skilled-worker/',
    '/does-not-exist',
    '/application',
    '/apps',
    '/app-settings',
    '/statuses',
    '/callbacks',
    '/pilot-access-denied-extra',
    '/robots.txt',
  ])('leaves %s to the policy alone', (path) => {
    expect(isAuthkitPath(path)).toBe(false);
  });

  it('never covers /trust, however it is spelled', () => {
    for (const path of ['/trust', '/trust/', '/trust/x', '/%74rust', '/%74rust/x', '/trust.rsc']) {
      expect(isAuthkitPath(path), path).toBe(false);
    }
  });

  it('covers a percent-encoded /app the way Next routes it', () => {
    expect(isAuthkitPath('/%61pp')).toBe(true);
    expect(isAuthkitPath('/%61pp/profile')).toBe(true);
    expect(isAuthkitPath('/app%2Fprofile')).toBe(true);
  });

  it('still covers /app when Next has stripped the .rsc from a segment-prefetch URL', () => {
    // The adapter hands the middleware `/app.segments/x.segment`, not `...segment.rsc`.
    expect(isAuthkitPath('/app.segments/x.segment')).toBe(true);
    expect(isAuthkitPath('/app/profile.segments/_tree.segment')).toBe(true);
    expect(isAuthkitPath('/trust.segments/_tree.segment')).toBe(false);
  });

  it('does not throw on a malformed percent escape', () => {
    expect(isAuthkitPath('/app/%E0%A4%A')).toBe(true);
    expect(isAuthkitPath('/trust/%E0%A4%A')).toBe(false);
  });

  describe('agrees with Next on the original matcher', () => {
    const bases = [
      '/',
      '/index',
      '/status',
      '/status/extra',
      '/app',
      '/app/x',
      '/app/x/y',
      '/app/index',
      '/callback',
      '/callback/extra',
      '/pilot-access-denied',
      '/pilot-access-denied/extra',
      '/trust',
      '/trust/pack',
      '/does-not-exist',
      '/application',
      '/apps',
      '/appx/y',
      '/statusx',
      '/api/health',
      '/robots.txt',
    ];
    const wrappers: ReadonlyArray<(path: string) => string> = [
      (p) => p,
      (p) => (p === '/' ? p : `${p}/`),
      (p) => `${p === '/' ? '/index' : p}.json`,
      (p) => `${p === '/' ? '/index' : p}.rsc`,
      (p) => `${p === '/' ? '/index' : p}.segments/_tree.segment.rsc`,
      (p) => `/_next/data/BUILDID${p === '/' ? '/index' : p}.json`,
      (p) => p.replace(/^\/(.)/, (_m, c: string) => `/%${c.charCodeAt(0).toString(16)}`),
      (p) => p.replace(/\//g, '%2F').replace(/^%2F/, '/'),
      (p) => p.toUpperCase(),
      (p) => `/${p}`,
      (p) => `${p}%3F`,
      (p) => `${p}%23`,
    ];

    // Every wrapper on its own, and every ordered pair of them, so that
    // combinations such as "suffix then trailing slash" are covered too.
    const single = bases.flatMap((base) => wrappers.map((wrap) => wrap(base)));
    const paired = single.flatMap((path) => wrappers.map((wrap) => wrap(path)));
    const corpus = [...new Set([...bases, ...single, ...paired])];

    it('has a corpus worth the name', () => {
      expect(corpus.length).toBeGreaterThan(2000);
    });

    // Next matched the original matcher against the path as sent, then its adapter
    // normalized the URL (stripping a trailing `.rsc`) before the middleware saw it.
    // The predicate is therefore given the normalized form, and may cover a path
    // either because the original matcher took the raw form or because it takes the
    // normalized one. That second case only arises for a doubly suffixed path such
    // as `/status.json.rsc`, whose normalized form `/status.json` the original
    // matcher also takes: AuthKit runs on slightly more of such nonsense than
    // before, which is the safe direction, and nothing real is requested that way.
    const receivedByMiddleware = (path: string) => normalizeRscURL(path);
    const expected = (path: string) =>
      originalMatcherCovers(path) || originalMatcherCovers(receivedByMiddleware(path));

    it('never drops a path Next would have given to AuthKit', () => {
      const dropped = corpus.filter(
        (path) => originalMatcherCovers(path) && !isAuthkitPath(receivedByMiddleware(path)),
      );
      expect(dropped).toEqual([]);
    });

    it('covers exactly what the original matcher covers, before or after normalization', () => {
      const mismatched = corpus.filter(
        (path) => expected(path) !== isAuthkitPath(receivedByMiddleware(path)),
      );
      expect(mismatched).toEqual([]);
    });

    it('covers nothing outside that, so /trust and unknown paths are never handed to AuthKit', () => {
      const extra = corpus.filter(
        (path) => isAuthkitPath(receivedByMiddleware(path)) && !expected(path),
      );
      expect(extra).toEqual([]);
      for (const path of corpus.filter((p) => /^\/(?:trust|does-not-exist|api|robots)/i.test(p))) {
        expect(isAuthkitPath(receivedByMiddleware(path)), path).toBe(false);
      }
    });
  });
});
