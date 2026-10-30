import { type NextFetchEvent, type NextMiddleware, NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { createCspMiddleware } from './csp-middleware';
import { isNeonProtectedPath } from './identity-selection';

/**
 * The middleware that puts the Content-Security-Policy and its per-request
 * nonce on every page, and runs the sign-in check unchanged on protected pages.
 * The sign-in check itself is replaced by a stand-in that forwards a copy of the
 * request headers it was given, so that what reaches the render can be observed.
 */

const EVENT = {} as NextFetchEvent;
const NONCE = 'dGVzdC1ub25jZS0wMDAwMDA=';

function fakeSignIn(respond?: (request: NextRequest) => ReturnType<NextMiddleware>): {
  handler: NextMiddleware;
  calls: NextRequest[];
} {
  const calls: NextRequest[] = [];
  const handler: NextMiddleware = (request) => {
    calls.push(request);
    if (respond) return respond(request);
    const headers = new Headers(request.headers);
    headers.set('x-auth-middleware', 'true');
    const response = NextResponse.next({ request: { headers } });
    response.headers.append('set-cookie', 'session=sealed; Path=/; HttpOnly');
    return response;
  };
  return { handler, calls };
}

function envFrom(values: Record<string, string> = {}): (name: string) => string | undefined {
  return (name) => values[name];
}

function build(options: {
  auth?: NextMiddleware;
  enabled?: boolean;
  env?: Record<string, string>;
  makeNonce?: () => string;
}) {
  return createCspMiddleware({
    auth: options.auth ?? fakeSignIn().handler,
    needsSignIn: isNeonProtectedPath,
    enabled: options.enabled ?? true,
    readEnv: envFrom(options.env),
    makeNonce: options.makeNonce ?? (() => NONCE),
  });
}

/** The request headers Next will hand to the render, as the middleware set them. */
function forwardedHeaders(response: Response): Headers {
  const forwarded = new Headers();
  const names = response.headers.get('x-middleware-override-headers')?.split(',') ?? [];
  for (const name of names) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value !== null) forwarded.set(name, value);
  }
  return forwarded;
}

function get(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`https://app.example.test${path}`, init);
}

function nonceIn(policy: string | null): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

describe('outside a production build', () => {
  it('adds no policy and no nonce anywhere', async () => {
    const { handler, calls } = fakeSignIn();
    const middleware = build({ auth: handler, enabled: false });

    const page = await middleware(get('/trust'), EVENT);
    expect(page?.headers.get('content-security-policy')).toBeNull();
    expect(page?.headers.get('content-security-policy-report-only')).toBeNull();
    expect(page?.headers.get('x-middleware-override-headers')).toBeNull();
    expect(calls).toHaveLength(0);

    const original = get('/app');
    const app = await middleware(original, EVENT);
    expect(calls).toEqual([original]);
    expect(app?.headers.get('content-security-policy')).toBeNull();
    expect(app?.headers.get('set-cookie')).toContain('session=sealed');
  });
});

describe('a public page (landing, status, trust, not-found)', () => {
  it.each([
    '/',
    '/status',
    '/callback',
    '/trust',
    '/trust/uk-skilled-worker',
    '/no-such-page',
    '/robots.txt',
  ])(
    'gets the policy on the response and the request, without the sign-in check: %s',
    async (path) => {
      const { handler, calls } = fakeSignIn();
      const response = await build({ auth: handler })(get(path), EVENT);

      expect(calls).toHaveLength(0);
      const policy = response?.headers.get('content-security-policy') ?? null;
      expect(policy).toContain(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`);
      const forwarded = forwardedHeaders(response as Response);
      expect(forwarded.get('content-security-policy')).toBe(policy);
      expect(forwarded.get('x-nonce')).toBe(NONCE);
    },
  );
});

describe('a page that needs a signed-in session', () => {
  it.each(['/pilot-access-denied', '/app', '/app/applicant/1'])(
    'runs the sign-in check once and still forwards the policy to the render: %s',
    async (path) => {
      const { handler, calls } = fakeSignIn();
      const response = await build({ auth: handler })(get(path), EVENT);

      expect(calls).toHaveLength(1);
      const policy = response?.headers.get('content-security-policy') ?? null;
      expect(nonceIn(policy)).toBe(NONCE);
      const forwarded = forwardedHeaders(response as Response);
      expect(forwarded.get('content-security-policy')).toBe(policy);
      expect(forwarded.get('x-nonce')).toBe(NONCE);
      // What the sign-in check forwards on its own is still there.
      expect(forwarded.get('x-auth-middleware')).toBe('true');
    },
  );

  it('hands the sign-in check the same URL, method and headers, plus the policy', async () => {
    const { handler, calls } = fakeSignIn();
    const original = get('/app/mission/7?tab=notes', {
      method: 'POST',
      headers: { cookie: 'wos-session=abc', 'content-type': 'text/plain', 'next-action': 'x' },
      body: 'payload',
    });
    await build({ auth: handler })(original, EVENT);

    const received = calls[0] as NextRequest;
    expect(received.url).toBe(original.url);
    expect(received.method).toBe('POST');
    expect(received.nextUrl.pathname).toBe('/app/mission/7');
    expect(received.nextUrl.search).toBe('?tab=notes');
    expect(received.headers.get('cookie')).toBe('wos-session=abc');
    expect(received.cookies.get('wos-session')?.value).toBe('abc');
    expect(received.headers.get('next-action')).toBe('x');
    expect(received.headers.get('x-nonce')).toBe(NONCE);
    expect(received.headers.get('content-security-policy')).toContain(`'nonce-${NONCE}'`);
  });

  it('leaves the original request body unread for the Server Action behind it', async () => {
    const original = get('/app/mission/7', { method: 'POST', body: 'form-data-payload' });
    await build({})(original, EVENT);
    expect(original.bodyUsed).toBe(false);
    expect(await original.text()).toBe('form-data-payload');
  });

  it('keeps what the sign-in check puts on its own response', async () => {
    const response = await build({})(get('/app'), EVENT);
    expect(response?.headers.get('set-cookie')).toContain('session=sealed');
  });

  it('puts the policy on the sign-in check redirect to sign-in too, and leaves it a redirect', async () => {
    const { handler } = fakeSignIn(() =>
      NextResponse.redirect('https://visastack.example/auth/sign-in?next=%2Fapp', 307),
    );
    const response = await build({ auth: handler })(get('/app'), EVENT);

    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toBe(
      'https://visastack.example/auth/sign-in?next=%2Fapp',
    );
    expect(nonceIn(response?.headers.get('content-security-policy') ?? null)).toBe(NONCE);
  });

  it('still produces a page response if the sign-in check returns nothing', async () => {
    const { handler } = fakeSignIn(() => undefined);
    const response = await build({ auth: handler })(get('/app'), EVENT);
    expect(nonceIn(response?.headers.get('content-security-policy') ?? null)).toBe(NONCE);
    expect(forwardedHeaders(response as Response).get('x-nonce')).toBe(NONCE);
  });

  it('does not swallow an the sign-in check failure', async () => {
    const { handler } = fakeSignIn(() => {
      throw new Error('You must provide a valid cookie password');
    });
    await expect(build({ auth: handler })(get('/app'), EVENT)).rejects.toThrow(
      'valid cookie password',
    );
  });
});

describe('the nonce', () => {
  it('is new for every request and matches between header and render', async () => {
    let counter = 0;
    const middleware = build({ makeNonce: () => `bm9uY2U${counter++}AAAA` });
    const first = await middleware(get('/trust'), EVENT);
    const second = await middleware(get('/trust'), EVENT);
    const third = await middleware(get('/app'), EVENT);

    const nonces = [first, second, third].map((r) =>
      nonceIn(r?.headers.get('content-security-policy') ?? null),
    );
    expect(new Set(nonces).size).toBe(3);
    for (const response of [first, second, third]) {
      expect(forwardedHeaders(response as Response).get('x-nonce')).toBe(
        nonceIn(response?.headers.get('content-security-policy') ?? null),
      );
    }
  });

  it('uses a fresh random nonce by default', async () => {
    const middleware = createCspMiddleware({
      auth: fakeSignIn().handler,
      needsSignIn: isNeonProtectedPath,
      enabled: true,
      readEnv: envFrom(),
    });
    const a = await middleware(get('/trust'), EVENT);
    const b = await middleware(get('/trust'), EVENT);
    const nonceA = nonceIn(a?.headers.get('content-security-policy') ?? null);
    const nonceB = nonceIn(b?.headers.get('content-security-policy') ?? null);
    expect(nonceA).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
    expect(nonceA).not.toBe(nonceB);
  });
});

describe('headers a client sends', () => {
  it('cannot choose the nonce or the policy the render sees', async () => {
    const response = await build({})(
      get('/trust', {
        headers: {
          'x-nonce': 'attacker-nonce',
          'content-security-policy': "script-src 'nonce-attacker-nonce'",
          'content-security-policy-report-only': "script-src 'nonce-attacker-nonce'",
        },
      }),
      EVENT,
    );
    const forwarded = forwardedHeaders(response as Response);
    expect(forwarded.get('x-nonce')).toBe(NONCE);
    expect(forwarded.get('content-security-policy')).toContain(`'nonce-${NONCE}'`);
    expect(forwarded.get('content-security-policy')).not.toContain('attacker');
    expect(forwarded.get('content-security-policy-report-only')).toBeNull();
  });

  it('are overwritten the same way on the the sign-in check path', async () => {
    const { handler, calls } = fakeSignIn();
    await build({ auth: handler })(
      get('/app', { headers: { 'x-nonce': 'attacker-nonce' } }),
      EVENT,
    );
    expect((calls[0] as NextRequest).headers.get('x-nonce')).toBe(NONCE);
  });
});

describe('CSP_MODE', () => {
  it('enforces by default and for any unrecognised value', async () => {
    for (const env of [{}, { CSP_MODE: '' }, { CSP_MODE: 'enforce' }, { CSP_MODE: 'typo' }]) {
      const response = await build({ env })(get('/trust'), EVENT);
      expect(response?.headers.get('content-security-policy'), JSON.stringify(env)).toContain(
        'script-src',
      );
      expect(response?.headers.get('content-security-policy-report-only')).toBeNull();
    }
  });

  it('report-only serves the same policy under the report-only header, to browser and render', async () => {
    const { handler, calls } = fakeSignIn();
    const middleware = build({ auth: handler, env: { CSP_MODE: 'report-only' } });

    const trust = await middleware(get('/trust'), EVENT);
    const app = await middleware(get('/app'), EVENT);

    for (const response of [trust, app]) {
      expect(response?.headers.get('content-security-policy')).toBeNull();
      const policy = response?.headers.get('content-security-policy-report-only') ?? null;
      expect(nonceIn(policy)).toBe(NONCE);
      const forwarded = forwardedHeaders(response as Response);
      expect(forwarded.get('content-security-policy-report-only')).toBe(policy);
      expect(forwarded.get('content-security-policy')).toBeNull();
      expect(forwarded.get('x-nonce')).toBe(NONCE);
    }
    expect((calls[0] as NextRequest).headers.get('content-security-policy')).toBeNull();
  });
});

describe('what the environment adds to the policy', () => {
  async function policyFor(env: Record<string, string>): Promise<string> {
    const response = await build({ env })(get('/trust'), EVENT);
    return response?.headers.get('content-security-policy') ?? '';
  }

  it('adds the Vercel toolbar allowances on a preview only', async () => {
    expect(await policyFor({ VERCEL_ENV: 'preview' })).toContain('https://vercel.live');
    expect(await policyFor({ VERCEL_ENV: 'production' })).not.toContain('vercel');
    expect(await policyFor({ VERCEL_ENV: 'development' })).not.toContain('vercel');
    expect(await policyFor({})).not.toContain('vercel');
  });

  it('adds the canonical app origin to images and forms', async () => {
    const policy = await policyFor({ NEXT_PUBLIC_APP_URL: 'https://visastack.example/path' });
    expect(policy).toContain("img-src 'self' https://visastack.example;");
    expect(policy).toMatch(/form-action [^;]*https:\/\/visastack\.example/);
  });

  it('adds valid CSP_FORM_ACTION_EXTRA origins and ignores the rest', async () => {
    const policy = await policyFor({
      CSP_FORM_ACTION_EXTRA: 'https://auth.visastack.example, http://insecure.example, *',
    });
    expect(policy).toContain('https://auth.visastack.example');
    expect(policy).not.toContain('insecure.example');
    // The bare wildcard is ignored, so the policy has none at all.
    expect(policy.match(/\*/g)).toBeNull();
  });
});

describe('a downloaded billing document (S30)', () => {
  const ORG = '11111111-2222-4333-8444-555555555555';
  const DOC = '66666666-7777-4888-8999-000000000000';
  const downloads = [
    `/app/agency/${ORG}/plan/invoices/${DOC}/pdf`,
    `/app/agency/${ORG}/plan/invoices/receipts/${DOC}/pdf`,
    `/app/admin/organizations/${ORG}/invoices/${DOC}/pdf`,
  ];

  it.each(downloads)('keeps the strict document policy, still behind sign-in: %s', async (path) => {
    for (const env of [{}, { CSP_MODE: 'report-only' }]) {
      const { handler, calls } = fakeSignIn();
      const response = await build({ auth: handler, env })(get(path), EVENT);
      expect(calls).toHaveLength(1);
      expect(response?.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(response?.headers.get('content-security-policy-report-only')).toBeNull();
    }
  });

  it('gives the page policy to the pages beside them', async () => {
    const { handler } = fakeSignIn();
    for (const path of [
      `/app/agency/${ORG}/plan/invoices`,
      `/app/agency/${ORG}/plan/invoices/receipts/${DOC}`,
      `/app/agency/${ORG}/plan/invoices/${DOC}/pdf/more`,
    ]) {
      const response = await build({ auth: handler })(get(path), EVENT);
      expect(nonceIn(response?.headers.get('content-security-policy') ?? null)).toBe(NONCE);
    }
  });
});
