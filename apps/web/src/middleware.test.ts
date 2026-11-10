import { type NextFetchEvent, NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTH_SKIP_ROUTES, processAuthMiddleware } from '@neondatabase/auth/server';
import { neonLoginUrlFor } from './lib/confirmed-landing';
import { isNeonProtectedPath } from './lib/identity-selection';

/**
 * P11 (10 Nov 2026), installed app on Android showing an address bar and a desktop layout.
 * These tests pin what was ruled out, so it cannot come back unnoticed: a sign-in redirect never
 * leaves the app's own address (an installed app treats any other address as outside the app and
 * opens it with an address bar), and the files a phone needs to install and run the app answer
 * without a sign-in.
 */

const EVENT = {} as NextFetchEvent;
const APP = 'https://vs.obsidianglobal.studio';
const COOKIE_PREFIX = '__Secure-neon-auth';

/** Next's matcher: a path-to-regexp source anchored at both ends. */
function matcherAccepts(path: string): boolean {
  const { source } = (matcherConfig as { matcher: string[] }).matcher.reduce(
    (_all, entry) => ({ source: entry }),
    { source: '' },
  );
  return new RegExp(`^${source}$`).test(path);
}

let matcherConfig: unknown;
let run: (request: NextRequest) => Promise<Response | undefined>;
const fetchStub = vi.fn(async () => new Response('null', { status: 401 }));

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchStub);
  fetchStub.mockClear();
  const loaded = await import('./middleware');
  matcherConfig = loaded.config;
  run = async (request) => (await loaded.default(request, EVENT)) as Response | undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(path: string, cookie?: string, origin = APP): NextRequest {
  return new NextRequest(new URL(path, origin), cookie ? { headers: { cookie } } : {});
}

describe('which requests the middleware sees', () => {
  it('covers pages, the manifest and the service worker', () => {
    for (const path of ['/', '/app', '/auth/sign-in', '/manifest.webmanifest', '/sw.js']) {
      expect(matcherAccepts(path), path).toBe(true);
    }
  });

  it('leaves out the installed app icons, static files and API routes', () => {
    for (const path of [
      '/icons/icon-192.png',
      '/icons/icon-maskable-512.png',
      '/favicon.ico',
      '/_next/static/chunks/main.js',
      '/api/health/ready',
    ]) {
      expect(matcherAccepts(path), path).toBe(false);
    }
  });

  it('does not skip a page whose name merely starts like icons', () => {
    expect(matcherAccepts('/icons-and-more')).toBe(true);
  });
});

describe('the files the installed app needs', () => {
  for (const path of ['/manifest.webmanifest', '/sw.js']) {
    it(`${path} passes through with no sign-in check and no redirect`, async () => {
      const response = await run(request(path));
      expect(response?.status).toBe(200);
      expect(response?.headers.get('location')).toBeNull();
      expect(fetchStub).not.toHaveBeenCalled();
    });
  }
});

describe('a sign-in redirect stays on the app address', () => {
  const BASE_URL = 'https://auth.placeholder.invalid/neondb/auth';
  const protectedPaths = [
    '/app',
    '/app?source=pwa',
    '/app/notifications?source=pwa',
    '/app/mission/00000000-0000-4000-8000-000000000001',
    '/pilot-access-denied',
    '/oauth/authorize?client_id=x',
    '/auth/reauth',
    '/auth/confirmed?next=%2Fapp',
    '/collect/account?t=abc',
  ];
  const situations: ReadonlyArray<
    readonly [name: string, cookie: string | undefined, handover: boolean]
  > = [
    ['no cookies', undefined, false],
    ['only a leftover session copy', `${COOKIE_PREFIX}.local.session_data=old`, false],
    ['an expired session', `${COOKIE_PREFIX}.session_token=expired`, false],
    [
      'a sign-in handover that fails',
      `${COOKIE_PREFIX}.session_challenge=c; ${COOKIE_PREFIX}.session_token=expired`,
      true,
    ],
  ];

  /** The real decision logic of the sign-in package, given the address our middleware hands it. */
  async function decide(
    path: string,
    origin: string,
    cookie: string | undefined,
    handover: boolean,
  ) {
    const url = new URL(path, origin);
    if (handover) url.searchParams.set('neon_auth_session_verifier', 'v');
    return processAuthMiddleware({
      request: new Request(url, cookie ? { headers: { cookie } } : {}),
      pathname: url.pathname,
      skipRoutes: DEFAULT_AUTH_SKIP_ROUTES,
      loginUrl: neonLoginUrlFor(url.pathname, url.search),
      baseUrl: BASE_URL,
      cookieSecret: 'a'.repeat(64),
    });
  }

  it('every path in this list really is one the sign-in check runs on', () => {
    for (const path of protectedPaths) {
      expect(isNeonProtectedPath(new URL(path, APP).pathname), path).toBe(true);
    }
  });

  for (const origin of [APP, 'https://visastack-five.vercel.app']) {
    for (const [name, cookie, handover] of situations) {
      it(`${new URL(origin).host}: ${name}`, async () => {
        for (const path of protectedPaths) {
          const decision = await decide(path, origin, cookie, handover);
          expect(decision.action, path).toBe('redirect_login');
          if (decision.action !== 'redirect_login') continue;
          expect(decision.redirectUrl.origin, path).toBe(origin);
          expect(decision.redirectUrl.pathname, path).toMatch(/^\/auth\/sign-in/);
        }
      });
    }
  }

  it('keeps the home-screen marker so it survives the round trip through sign-in', async () => {
    const decision = await decide('/app?source=pwa', APP, undefined, false);
    expect(decision.action).toBe('redirect_login');
    if (decision.action !== 'redirect_login') return;
    expect(decision.redirectUrl.searchParams.get('next')).toBe('/app?source=pwa');
  });
});
