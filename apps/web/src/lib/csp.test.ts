import { afterEach, describe, expect, it } from 'vitest';
import { resolveBaseUrl } from './base-url';
import {
  CSP_HEADER_ENFORCE,
  CSP_HEADER_REPORT_ONLY,
  CSP_REPORT_PATH,
  buildContentSecurityPolicy,
  cspHeaderName,
  generateNonce,
  parseFormActionOrigins,
  resolveAppOrigin,
  resolveCspMode,
  toOrigin,
} from './csp';

/** The nonce shape Next.js accepts when it reads the policy header back. */
const NEXT_NONCE_SHAPE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Splits a policy into `{ directive: [sources] }`. */
function directives(policy: string): Record<string, string[]> {
  const parsed: Record<string, string[]> = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) parsed[name] = sources;
  }
  return parsed;
}

function envFrom(values: Record<string, string>): (name: string) => string | undefined {
  return (name) => values[name];
}

describe('generateNonce', () => {
  it('produces the base64 shape Next.js reads back out of the header', () => {
    for (let i = 0; i < 50; i++) expect(generateNonce()).toMatch(NEXT_NONCE_SHAPE);
  });

  it('carries 128 bits', () => {
    const decoded = Uint8Array.from(atob(generateNonce()), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(16);
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateNonce()));
    expect(seen.size).toBe(2000);
  });
});

describe('resolveCspMode / cspHeaderName', () => {
  it('only an explicit report-only turns enforcement off', () => {
    expect(resolveCspMode('report-only')).toBe('report-only');
    expect(resolveCspMode('  Report-Only ')).toBe('report-only');
  });

  it.each([undefined, '', '   ', 'enforce', 'ENFORCE', 'report', 'off', 'false', '0'])(
    'enforces for %j',
    (value) => {
      expect(resolveCspMode(value)).toBe('enforce');
    },
  );

  it('names the matching header', () => {
    expect(cspHeaderName('enforce')).toBe(CSP_HEADER_ENFORCE);
    expect(cspHeaderName('report-only')).toBe(CSP_HEADER_REPORT_ONLY);
    expect(CSP_HEADER_ENFORCE).toBe('Content-Security-Policy');
    expect(CSP_HEADER_REPORT_ONLY).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('toOrigin', () => {
  it('reduces a URL to its origin', () => {
    expect(toOrigin('https://app.example.com/some/path?q=1#frag')).toBe('https://app.example.com');
    expect(toOrigin('https://app.example.com:8443/x')).toBe('https://app.example.com:8443');
    expect(toOrigin('HTTPS://APP.Example.COM')).toBe('https://app.example.com');
    expect(toOrigin('http://localhost:3000/callback')).toBe('http://localhost:3000');
  });

  it('refuses anything that is not a plain http(s) origin', () => {
    expect(toOrigin('')).toBeUndefined();
    expect(toOrigin('not a url')).toBeUndefined();
    expect(toOrigin('javascript:alert(1)')).toBeUndefined();
    expect(toOrigin('data:text/html,hi')).toBeUndefined();
    expect(toOrigin('ftp://example.com')).toBeUndefined();
  });

  it('refuses a host that would start a new directive', () => {
    // `;` and `,` are legal in a parsed host; left in, they would add a directive.
    expect(toOrigin('https://a;script-src.example.com')).toBeUndefined();
    expect(toOrigin('https://a,b.example.com')).toBeUndefined();
  });
});

describe('resolveAppOrigin', () => {
  it('prefers NEXT_PUBLIC_APP_URL', () => {
    expect(
      resolveAppOrigin(
        envFrom({
          NEXT_PUBLIC_APP_URL: 'https://app.example.com/ignored',
          VERCEL_PROJECT_PRODUCTION_URL: 'prod.example.com',
          NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://redirect.example.com/callback',
        }),
      ),
    ).toBe('https://app.example.com');
  });

  it('then the Vercel production URL', () => {
    expect(
      resolveAppOrigin(
        envFrom({
          VERCEL_PROJECT_PRODUCTION_URL: 'prod.example.com',
          NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://redirect.example.com/callback',
        }),
      ),
    ).toBe('https://prod.example.com');
  });

  it('then the WorkOS redirect URI origin', () => {
    expect(
      resolveAppOrigin(
        envFrom({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://redirect.example.com/callback' }),
      ),
    ).toBe('https://redirect.example.com');
  });

  it('is undefined when nothing usable is configured, or the value is unusable', () => {
    expect(resolveAppOrigin(envFrom({}))).toBeUndefined();
    expect(resolveAppOrigin(envFrom({ NEXT_PUBLIC_APP_URL: 'nonsense' }))).toBeUndefined();
  });
});

describe('resolveAppOrigin stays in step with resolveBaseUrl', () => {
  const NAMES = [
    'NEXT_PUBLIC_APP_URL',
    'VERCEL_ENV',
    'VERCEL_BRANCH_URL',
    'VERCEL_URL',
    'VERCEL_PROJECT_PRODUCTION_URL',
    'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  ] as const;
  const original: Record<string, string | undefined> = {};
  for (const name of NAMES) original[name] = process.env[name];

  afterEach(() => {
    for (const name of NAMES) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const cases: ReadonlyArray<Record<string, string>> = [
    { NEXT_PUBLIC_APP_URL: 'https://a.example.com' },
    { VERCEL_PROJECT_PRODUCTION_URL: 'b.example.com' },
    { NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://c.example.com/callback' },
    {
      NEXT_PUBLIC_APP_URL: 'https://a.example.com',
      VERCEL_PROJECT_PRODUCTION_URL: 'b.example.com',
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://c.example.com/callback',
    },
    {
      VERCEL_PROJECT_PRODUCTION_URL: 'b.example.com',
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://c.example.com/callback',
    },
  ];

  it.each(cases)('agrees for %j', (values) => {
    for (const name of NAMES) delete process.env[name];
    for (const [name, value] of Object.entries(values)) process.env[name] = value;
    expect(resolveAppOrigin((name) => process.env[name])).toBe(new URL(resolveBaseUrl()).origin);
  });

  it('keeps preview links on the current branch even when a production URL was copied', () => {
    for (const name of NAMES) delete process.env[name];
    const values: Record<string, string> = {
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'current-branch.vercel.app',
      NEXT_PUBLIC_APP_URL: 'https://production.example.com',
      VERCEL_PROJECT_PRODUCTION_URL: 'production.vercel.app',
    };
    for (const [name, value] of Object.entries(values)) process.env[name] = value;
    expect(resolveBaseUrl()).toBe('https://current-branch.vercel.app');
    expect(resolveAppOrigin((name) => process.env[name])).toBe(resolveBaseUrl());
    const branchName = 'VERCEL_BRANCH_URL';
    const deploymentName = 'VERCEL_URL';
    const environmentName = 'VERCEL_ENV';
    delete process.env[branchName];
    process.env[deploymentName] = 'current-deployment.vercel.app';
    expect(resolveBaseUrl()).toBe('https://current-deployment.vercel.app');
    process.env[environmentName] = 'production';
    expect(resolveBaseUrl()).toBe('https://production.example.com');
  });

  it('differs only in having no made-up default when nothing is configured', () => {
    for (const name of NAMES) delete process.env[name];
    expect(resolveAppOrigin((name) => process.env[name])).toBeUndefined();
    expect(new URL(resolveBaseUrl()).origin).toMatch(/^https:\/\//);
  });
});

describe('parseFormActionOrigins', () => {
  it('accepts https origins, with an optional leading wildcard and port', () => {
    expect(
      parseFormActionOrigins('https://auth.example.com https://*.authkit.example.com:8443'),
    ).toEqual(['https://auth.example.com', 'https://*.authkit.example.com:8443']);
  });

  it('splits on commas, spaces and newlines, lower-cases and de-duplicates', () => {
    expect(
      parseFormActionOrigins(
        'https://A.example.com,\nhttps://a.example.com  https://b.example.com',
      ),
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it.each([
    "'self'",
    '*',
    'https:',
    'http://insecure.example.com',
    'https://example.com/path',
    'https://example.com?x=1',
    'https://example.com:99999999',
    'https://a;script-src.example.com',
    'javascript:alert(1)',
    'https://*',
    'https://*.',
    'https://-bad.example.com',
  ])('drops %j instead of passing it through', (entry) => {
    expect(parseFormActionOrigins(`https://ok.example.com ${entry}`)).toEqual([
      'https://ok.example.com',
    ]);
  });

  it('is empty for nothing', () => {
    expect(parseFormActionOrigins(undefined)).toEqual([]);
    expect(parseFormActionOrigins('')).toEqual([]);
    expect(parseFormActionOrigins('   ')).toEqual([]);
  });
});

describe('buildContentSecurityPolicy', () => {
  const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA==';
  const production = directives(buildContentSecurityPolicy({ nonce: NONCE }));

  it('admits scripts by nonce and trust propagation only', () => {
    expect(production['script-src']).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
  });

  it('never allows inline or eval script', () => {
    const policy = buildContentSecurityPolicy({
      nonce: NONCE,
      appOrigin: 'https://app.example.com',
      vercelPreviewToolbar: true,
    });
    const scriptSources = directives(policy)['script-src'] ?? [];
    expect(scriptSources).not.toContain("'unsafe-inline'");
    expect(scriptSources).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('allows inline style attributes, and nothing else third-party', () => {
    expect(production['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('keeps everything else same-origin or none', () => {
    expect(production['default-src']).toEqual(["'self'"]);
    expect(production['img-src']).toEqual(["'self'"]);
    expect(production['font-src']).toEqual(["'self'"]);
    expect(production['connect-src']).toEqual(["'self'"]);
    expect(production['frame-src']).toEqual(["'none'"]);
    expect(production['object-src']).toEqual(["'none'"]);
    expect(production['base-uri']).toEqual(["'self'"]);
    expect(production['frame-ancestors']).toEqual(["'none'"]);
  });

  it('reports violations to the same-origin endpoint', () => {
    expect(production['report-uri']).toEqual([CSP_REPORT_PATH]);
    expect(CSP_REPORT_PATH).toBe('/api/csp-report');
  });

  it('lets a form hand off to WorkOS, and only WorkOS', () => {
    expect(production['form-action']).toEqual([
      "'self'",
      'https://api.workos.com',
      'https://*.authkit.app',
    ]);
  });

  it('has no wildcard other than the AuthKit subdomain, and no plain-http or data source', () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE });
    expect(policy.match(/\*/g)).toHaveLength(1);
    expect(policy).not.toMatch(/http:/);
    expect(policy).not.toMatch(/\bdata:/);
    expect(policy).not.toMatch(/\bblob:/);
  });

  it('adds the app origin to images and forms only', () => {
    const withOrigin = directives(
      buildContentSecurityPolicy({ nonce: NONCE, appOrigin: 'https://app.example.com' }),
    );
    expect(withOrigin['img-src']).toEqual(["'self'", 'https://app.example.com']);
    expect(withOrigin['form-action']).toContain('https://app.example.com');
    expect(withOrigin['script-src']).toEqual(production['script-src']);
    expect(withOrigin['connect-src']).toEqual(["'self'"]);
    expect(withOrigin['frame-src']).toEqual(["'none'"]);
  });

  it('appends configured extra form-action origins', () => {
    const extra = directives(
      buildContentSecurityPolicy({
        nonce: NONCE,
        extraFormActionOrigins: ['https://auth.visastack.example'],
      }),
    );
    expect(extra['form-action']).toEqual([
      "'self'",
      'https://api.workos.com',
      'https://*.authkit.app',
      'https://auth.visastack.example',
    ]);
  });

  it('gives production no Vercel toolbar allowance at all', () => {
    expect(buildContentSecurityPolicy({ nonce: NONCE })).not.toContain('vercel');
    expect(buildContentSecurityPolicy({ nonce: NONCE, vercelPreviewToolbar: false })).not.toContain(
      'vercel',
    );
  });

  it('gives a preview exactly the allowances Vercel documents for its toolbar', () => {
    const preview = directives(
      buildContentSecurityPolicy({ nonce: NONCE, vercelPreviewToolbar: true }),
    );
    expect(preview['script-src']).toContain('https://vercel.live');
    expect(preview['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://vercel.live']);
    expect(preview['connect-src']).toEqual([
      "'self'",
      'https://vercel.live',
      'wss://ws-us3.pusher.com',
    ]);
    expect(preview['img-src']).toEqual([
      "'self'",
      'https://vercel.live',
      'https://vercel.com',
      'data:',
      'blob:',
    ]);
    expect(preview['frame-src']).toEqual(['https://vercel.live']);
    expect(preview['font-src']).toEqual([
      "'self'",
      'https://vercel.live',
      'https://assets.vercel.com',
    ]);
    // The toolbar never loosens the framing or form rules.
    expect(preview['frame-ancestors']).toEqual(["'none'"]);
    expect(preview['object-src']).toEqual(["'none'"]);
    expect(preview['form-action']).toEqual(production['form-action']);
  });

  it('refuses a nonce that is not base64, so nothing can be smuggled into the header', () => {
    for (const nonce of ['', "x'; script-src *", 'a b', 'a;b', 'a\nb', "x'"]) {
      expect(() => buildContentSecurityPolicy({ nonce }), JSON.stringify(nonce)).toThrow(
        /nonce must be base64/,
      );
    }
  });

  it('is one line with no empty directives', () => {
    const policy = buildContentSecurityPolicy({
      nonce: NONCE,
      appOrigin: 'https://app.example.com',
    });
    expect(policy).not.toMatch(/[\r\n]/);
    expect(policy).not.toMatch(/;\s*;/);
    expect(policy.endsWith(';')).toBe(false);
  });
});
