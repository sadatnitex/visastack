import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/csp-report` is public and unauthenticated, so what these tests pin is
 * mostly what it refuses to do: keep a URL's query string, write unbounded
 * logs, read an unbounded body, or tell a caller anything.
 */

type Route = typeof import('./route');

const URL_ = 'https://app.example.test/api/csp-report';

function violation(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    'csp-report': {
      'document-uri':
        'https://app.example.test/app/applicant/5d0c1f4e-2a3b-4c5d-8e9f-0a1b2c3d4e5f?token=SECRET',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://cdn.evil.example/x.js?k=SECRET',
      disposition: 'enforce',
      'script-sample': 'Jane Doe passport X7Q9Z2K4',
      ...overrides,
    },
  });
}

function post(body: string, contentType: string | null = 'application/csp-report'): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  });
}

let route: Route;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // The log throttle lives in module state, so each test gets a fresh module.
  vi.resetModules();
  route = await import('./route');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('POST /api/csp-report', () => {
  it('answers 204 with nothing in the body, and is never cached', async () => {
    const response = await route.POST(post(violation()));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('writes one structured line with only the allowed fields', async () => {
    await route.POST(post(violation()));
    expect(warn).toHaveBeenCalledTimes(1);
    const [label, line] = warn.mock.calls[0] as [string, string];
    expect(label).toBe('[csp-violation]');
    expect(JSON.parse(line)).toEqual({
      directive: 'script-src-elem',
      blocked: 'https://cdn.evil.example',
      page: '/app/applicant/:id',
      source: null,
      line: null,
      column: null,
      disposition: 'enforce',
    });
    for (const secret of ['SECRET', 'token', 'Jane Doe', 'X7Q9Z2K4', '5d0c1f4e']) {
      expect(line, secret).not.toContain(secret);
    }
  });

  it.each([
    'application/csp-report',
    'application/json',
    'application/reports+json',
    'application/csp-report; charset=utf-8',
    'APPLICATION/JSON',
  ])('accepts a %s body', async (contentType) => {
    const response = await route.POST(post(violation(), contentType));
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    'text/plain',
    'text/html',
    'multipart/form-data',
    'application/x-www-form-urlencoded',
    null,
  ])('refuses content type %s with 415 and logs nothing', async (contentType) => {
    const response = await route.POST(post(violation(), contentType));
    expect(response.status).toBe(415);
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON with 400', async () => {
    const response = await route.POST(post('{not json'));
    expect(response.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it('acknowledges a JSON body that is not a report without logging it', async () => {
    for (const body of ['{}', '[]', 'null', '"x"', '{"csp-report":null}']) {
      const response = await route.POST(post(body));
      expect(response.status, body).toBe(204);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses a body over 16 KiB with 413, without reading it all', async () => {
    const huge = violation({ 'script-sample': 'x'.repeat(40_000) });
    const response = await route.POST(post(huge));
    expect(response.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts a body just under the limit', async () => {
    const padded = violation({ 'script-sample': 'x'.repeat(10_000) });
    expect(padded.length).toBeLessThan(16 * 1024);
    const response = await route.POST(post(padded));
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not log a browser-extension violation', async () => {
    const response = await route.POST(
      post(violation({ 'blocked-uri': 'chrome-extension://abcdefghijklmnop/inject.js' })),
    );
    expect(response.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('caps what one instance logs per minute, and says how many it dropped', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-03T06:00:00Z'));
      for (let i = 0; i < 100; i++) await route.POST(post(violation()));
      const violations = warn.mock.calls.filter(([label]: unknown[]) => label === '[csp-violation]');
      expect(violations).toHaveLength(30);

      vi.setSystemTime(new Date('2026-10-03T06:01:01Z'));
      await route.POST(post(violation()));
      const notices = warn.mock.calls.filter(
        ([label]: unknown[]) => typeof label === 'string' && label.includes('were not logged'),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]?.[0]).toContain('70 reports were not logged');
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes nothing but POST', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic', 'maxDuration']);
  });
});
