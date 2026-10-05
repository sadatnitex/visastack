import { describe, expect, it } from 'vitest';
import { createLogThrottle, parseCspReport, templatizePath } from './csp-report';

function report(overrides: Record<string, unknown> = {}): unknown {
  return {
    'csp-report': {
      'document-uri':
        'https://app.example.test/app/applicant/5d0c1f4e-2a3b-4c5d-8e9f-0a1b2c3d4e5f/documents?token=SECRET-INVITE-TOKEN#frag',
      referrer: 'https://app.example.test/app',
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      'original-policy': "default-src 'self'; script-src 'self' 'nonce-ABC'",
      disposition: 'enforce',
      'blocked-uri': 'https://cdn.evil.example/steal.js?session=SECRET',
      'status-code': 200,
      'script-sample': 'self.__next_f.push([1,"Jane Doe passport X7Q9Z2K4"])',
      'source-file':
        'https://app.example.test/_next/static/chunks/main-app-0123456789abcdef0123.js',
      'line-number': 12,
      'column-number': 34,
      ...overrides,
    },
  };
}

describe('parseCspReport', () => {
  it('keeps only the violated directive, blocked origin, templated route and position', () => {
    expect(parseCspReport(report())).toEqual({
      directive: 'script-src-elem',
      blocked: 'https://cdn.evil.example',
      page: '/app/applicant/:id/documents',
      source: 'https://app.example.test/_next/static/chunks/main-app-0123456789abcdef0123.js',
      line: 12,
      column: 34,
      disposition: 'enforce',
    });
  });

  it('never carries a query string, fragment, script sample or the policy', () => {
    const serialized = JSON.stringify(parseCspReport(report()));
    for (const secret of [
      'SECRET-INVITE-TOKEN',
      'SECRET',
      'token=',
      '#frag',
      'Jane Doe',
      'X7Q9Z2K4',
      '__next_f',
      "default-src 'self'",
      '5d0c1f4e',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it('reports a browser keyword as itself', () => {
    for (const keyword of ['inline', 'eval', 'data', 'blob', 'wasm-eval']) {
      expect(parseCspReport(report({ 'blocked-uri': keyword }))?.blocked).toBe(keyword);
    }
  });

  it('reduces a blob: or data: URL to a safe label', () => {
    expect(
      parseCspReport(report({ 'blocked-uri': 'blob:https://app.example.test/9f3a' }))?.blocked,
    ).toBe('https://app.example.test');
    expect(
      parseCspReport(report({ 'blocked-uri': 'data:text/javascript,alert(1)' }))?.blocked,
    ).toBe('data:');
  });

  it('falls back to the violated directive and to unknown values', () => {
    const summary = parseCspReport(
      report({
        'effective-directive': undefined,
        'violated-directive': "img-src 'self'",
        'blocked-uri': undefined,
        'document-uri': 'not a url',
        'source-file': undefined,
        'line-number': undefined,
        'column-number': -4,
        disposition: 'something-else',
      }),
    );
    expect(summary).toEqual({
      directive: 'img-src',
      blocked: 'unknown',
      page: 'unknown',
      source: null,
      line: null,
      column: null,
      disposition: 'enforce',
    });
  });

  it('templates the source file unless it is a public build artifact', () => {
    expect(
      parseCspReport(report({ 'source-file': 'https://app.example.test/app/applicant/12345/x.js' }))
        ?.source,
    ).toBe('https://app.example.test/app/applicant/:id/x.js');
    expect(
      parseCspReport(report({ 'source-file': 'https://cdn.example.test/_next/static/a.js?v=1' }))
        ?.source,
    ).toBe('https://cdn.example.test/_next/static/a.js');
  });

  it('records a report-only violation as such', () => {
    expect(parseCspReport(report({ disposition: 'report' }))?.disposition).toBe('report');
  });

  it('rejects a directive name that is not a plain directive', () => {
    expect(parseCspReport(report({ 'effective-directive': '<script>x</script>' }))?.directive).toBe(
      'unknown',
    );
    expect(parseCspReport(report({ 'effective-directive': 'a'.repeat(200) }))?.directive).toBe(
      'unknown',
    );
  });

  it('bounds every field it keeps', () => {
    const long = `https://app.example.test/${'segment/'.repeat(100)}`;
    const summary = parseCspReport(
      report({
        'document-uri': long,
        'source-file': long,
        'blocked-uri': `https://${'a'.repeat(300)}.example.test/x`,
        'line-number': 9_999_999_999,
      }),
    );
    expect(summary?.page.length).toBeLessThanOrEqual(120);
    expect(summary?.source?.length).toBeLessThanOrEqual(120);
    expect(summary?.blocked.length).toBeLessThanOrEqual(120);
    expect(summary?.line).toBe(1_000_000);
  });

  it.each([
    ['chrome-extension://abcdefghijklmnop/inject.js'],
    ['moz-extension://1234-5678/inject.js'],
    ['safari-web-extension://abcd/inject.js'],
  ])('ignores a violation caused by the browser extension %s', (uri) => {
    expect(parseCspReport(report({ 'blocked-uri': uri }))).toBeNull();
    expect(parseCspReport(report({ 'source-file': uri }))).toBeNull();
  });

  it.each([
    null,
    undefined,
    'text',
    42,
    [],
    {},
    { 'csp-report': null },
    { 'csp-report': 'x' },
    [{ type: 'csp-violation' }],
  ])('returns null for %j', (body) => {
    expect(parseCspReport(body)).toBeNull();
  });
});

describe('templatizePath', () => {
  it('replaces identifiers and tokens, and keeps ordinary route words', () => {
    expect(templatizePath('/app/applicant/5d0c1f4e-2a3b-4c5d-8e9f-0a1b2c3d4e5f/documents')).toBe(
      '/app/applicant/:id/documents',
    );
    expect(templatizePath('/app/mission/12345/snapshots/0123456789abcdef0123')).toBe(
      '/app/mission/:id/snapshots/:id',
    );
    expect(templatizePath('/app/client-invitations/accept')).toBe('/app/client-invitations/accept');
    expect(templatizePath('/trust/uk-skilled-worker')).toBe('/trust/uk-skilled-worker');
    expect(templatizePath('/')).toBe('/');
    expect(templatizePath(`/x/${'a-very-long-opaque-token-'.repeat(2)}`)).toBe('/x/:id');
  });
});

describe('createLogThrottle', () => {
  it('admits up to the cap in a window, then drops, then reports what it dropped', () => {
    const admit = createLogThrottle(3, 60_000);
    expect(admit(0)).toEqual({ log: true, suppressedBefore: 0 });
    expect(admit(1)).toEqual({ log: true, suppressedBefore: 0 });
    expect(admit(2)).toEqual({ log: true, suppressedBefore: 0 });
    expect(admit(3)).toEqual({ log: false, suppressedBefore: 0 });
    expect(admit(59_999)).toEqual({ log: false, suppressedBefore: 0 });
    // The next window starts: the two dropped reports are announced once.
    expect(admit(60_000)).toEqual({ log: true, suppressedBefore: 2 });
    expect(admit(60_001)).toEqual({ log: true, suppressedBefore: 0 });
  });

  it('bounds the log lines per window however many reports arrive', () => {
    const admit = createLogThrottle(30, 60_000);
    let logged = 0;
    for (let i = 0; i < 10_000; i++) if (admit(i).log) logged += 1;
    expect(logged).toBe(30);
  });
});
