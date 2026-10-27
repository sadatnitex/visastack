import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: vi.fn(async () => {
    throw new Error('no database in this test');
  }),
}));

const route = await import('./route');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/mcp', () => {
  it('is not found while the connector is off, whatever the method', async () => {
    vi.stubEnv('AI_CONNECTOR_ENABLED', '');
    expect(route.GET().status).toBe(404);
    expect(route.DELETE().status).toBe(404);
    const response = await route.POST(
      new Request('https://vs.example.test/mcp', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
  });

  it('answers 405 to GET and DELETE and asks a request without a token to sign in', async () => {
    vi.stubEnv('AI_CONNECTOR_ENABLED', 'true');
    expect(route.GET().status).toBe(405);
    expect(route.DELETE().status).toBe(405);
    const response = await route.POST(
      new Request('https://vs.example.test/mcp', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://vs.example.test/.well-known/oauth-protected-resource"',
    );
  });

  it('runs on the server, stateless, within the apps wait time', () => {
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.runtime).toBe('nodejs');
    expect(route.maxDuration).toBeLessThanOrEqual(10);
  });
});
