import { type NextFetchEvent, NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNeonProtectedPath } from './lib/identity-selection';
import { resetNeonAuthForTests } from './lib/neon-auth';

/**
 * P11 (10 Nov 2026), installed app on Android showing an address bar and a desktop layout.
 * These tests pin what was ruled out, so it cannot come back unnoticed: a sign-in redirect never
 * leaves the app's own address (an installed app treats any other address as outside the app and
 * opens it with an address bar), and the files a phone needs to install and run the app answer
 * without a sign-in.
 *
 * The real `middleware.ts` runs end to end. Only the sign-in package's Next.js adapter is replaced
 * (the real one cannot load under the test runner); the stand-in below is the same few lines, and
 * the decision it acts on comes from the package's own `processAuthMiddleware`, unchanged.
 */

vi.mock('@neondatabase/auth/next/server', async () => {
  const sdk = await import('@neondatabase/auth/server');
  return {
    createNeonAuth: (config: { baseUrl: string; cookies: { secret: string } }) => ({
      middleware:
        ({ loginUrl }: { loginUrl: string }) =>
        async (request: NextRequest) => {
          const result = await sdk.processAuthMiddleware({
            request,
            pathname: request.nextUrl.pathname,
            skipRoutes: sdk.DEFAULT_AUTH_SKIP_ROUTES,
            loginUrl,
            baseUrl: config.baseUrl,
            cookieSecret: config.cookies.secret,
          });
          if (result.action === 'allow') return NextResponse.next();
          return NextResponse.redirect(result.redirectUrl);
        },
    }),
  };
});

const EVENT = {} as NextFetchEvent;
const APP = 'https://vs.obsidianglobal.studio';
const COOKIE_PREFIX = '__Secure-neon-auth';

let matcher: string;
let run: (request: NextRequest) => Promise<Response | undefined>;
const fetchStub = vi.fn(async () => new Response('null', { status: 401 }));

beforeEach(async () => {
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.placeholder.invalid/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'a'.repeat(64));
  vi.stubGlobal('fetch', fetchStub);
  fetchStub.mockClear();
  resetNeonAuthForTests();
  const loaded = await import('./middleware');
  expect(loaded.config.matcher.length).toBeGreaterThan(0);
  matcher = loaded.config.matcher.at(-1) ?? '';
  run = async (request) => (await loaded.default(request, EVENT)) as Response | undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetNeonAuthForTests();
});

/** Next's matcher is a path-to-regexp source, anchored at both ends. */
function matcherAccepts(path: string): boolean {
  return new RegExp(`^${matcher}$`).test(path);
}

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
  const protectedPaths = [
    '/app',
    '/app?tab=documents',
    '/app/notifications',
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

  it('every path in this list really is one the sign-in check runs on', () => {
    for (const path of protectedPaths) {
      expect(isNeonProtectedPath(new URL(path, APP).pathname), path).toBe(true);
    }
  });

  for (const origin of [APP, 'https://visastack-five.vercel.app']) {
    for (const [name, cookie, handover] of situations) {
      it(`${new URL(origin).host}: ${name}`, async () => {
        for (const path of protectedPaths) {
          const url = new URL(path, origin);
          if (handover) url.searchParams.set('neon_auth_session_verifier', 'v');
          const response = await run(request(`${url.pathname}${url.search}`, cookie, origin));
          const location = response?.headers.get('location');
          expect(location, path).toBeTruthy();
          const target = new URL(location ?? '', origin);
          expect(target.origin, path).toBe(origin);
          expect(target.pathname, path).toMatch(/^\/auth\/sign-in/);
        }
      });
    }
  }

  it('keeps the page and its query so the person returns to the same place after sign-in', async () => {
    const response = await run(request('/app/notifications?show=all'));
    const target = new URL(response?.headers.get('location') ?? '', APP);
    expect(target.searchParams.get('next')).toBe('/app/notifications?show=all');
  });
});
