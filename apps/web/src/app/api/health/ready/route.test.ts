import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Honest readiness (Milestone 1 / master directive §8A): HTTP 200 means the
 * authenticated manual core is genuinely ready; 503 means a required core
 * dependency (DB reachability/migration, or WorkOS auth config) is missing.
 * This is a route-level unit test — no network, no real database — so it runs
 * in ordinary CI with no secrets.
 */

const REQUIRED_ENV = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  'DATABASE_URL',
  'VERCEL_ENV',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

/** Variable-keyed env read/write — avoids the index-signature lint/type rule. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

beforeEach(() => {
  for (const key of REQUIRED_ENV) ORIGINAL_ENV[key] = getEnv(key);
  setEnv('WORKOS_API_KEY', 'sk_test_x');
  setEnv('WORKOS_CLIENT_ID', 'client_x');
  setEnv('WORKOS_COOKIE_PASSWORD', 'x'.repeat(32));
  setEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI', 'https://example.test/callback');
  setEnv('DATABASE_URL', 'postgres://example.invalid/db');
  unsetEnv('VERCEL_ENV');
});

afterEach(() => {
  for (const key of REQUIRED_ENV) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) unsetEnv(key);
    else setEnv(key, original);
  }
  vi.doUnmock('@visastack/db');
  vi.resetModules();
});

/** Variable-keyed lookup on an arbitrary record — avoids the index-signature lint/type rule. */
function lookup(record: Record<string, string | undefined>, key: string): string | undefined {
  return record[key];
}

function mockDb(overrides: {
  checkConnection?: () => Promise<boolean>;
  isSchemaApplied?: () => Promise<boolean>;
}): void {
  vi.doMock('@visastack/db', () => ({
    DATABASE_URL_ENV_CANDIDATES: ['DATABASE_URL'],
    createNeonDb: () => ({}),
    checkConnection: overrides.checkConnection ?? (async () => true),
    isSchemaApplied: overrides.isSchemaApplied ?? (async () => true),
    resolveDatabaseUrl: (env: Record<string, string | undefined>) => lookup(env, 'DATABASE_URL'),
  }));
}

describe('GET /api/health/ready — honest health (200 vs 503)', () => {
  it('returns 200 "ready" when DB is connected+migrated and WorkOS config is present', async () => {
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  it('returns 503 "degraded" when the database connection fails', async () => {
    mockDb({
      checkConnection: async () => {
        throw new Error('connection refused');
      },
      isSchemaApplied: async () => false,
    });
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('returns 503 "degraded" when migrations have not been applied', async () => {
    mockDb({ isSchemaApplied: async () => false });
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('returns 503 "degraded" when required WorkOS config is absent, even with a healthy DB', async () => {
    setEnv('WORKOS_COOKIE_PASSWORD', '');
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('never includes secret values in the body, even in the non-production breakdown', async () => {
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain(getEnv('WORKOS_COOKIE_PASSWORD'));
    expect(text).not.toContain(getEnv('DATABASE_URL'));
  });

  it('always reports the real deployment mode and the full platform capability registry (master recovery directive §6/§7)', async () => {
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    expect(body.deploymentMode).toBe('development');
    expect(body.platform).toBeDefined();
    expect(body.platform.authentication).toBe('available');
    expect(body.platform.agencyCollaboration).toBe('available');
    expect(body.platform.bulkExport).toBe('available');
  });

  it('withholds the verbose env/db breakdown but still reports deploymentMode and platform on a real deployment', async () => {
    setEnv('VERCEL_ENV', 'production');
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    expect(body.deploymentMode).toBe('controlled_pilot');
    expect(body.platform).toBeDefined();
    expect(body.env).toBeUndefined();
    expect(body.db).toBeUndefined();
  });
});
