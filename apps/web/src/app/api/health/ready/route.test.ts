import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Honest readiness (Milestone 1 / master directive §8A): HTTP 200 means the
 * authenticated manual core is genuinely ready; 503 means a required core
 * dependency (DB reachability/migration, or Neon Auth sign-in config) is missing.
 * This is a route-level unit test — no network, no real database — so it runs
 * in ordinary CI with no secrets.
 */

const REQUIRED_ENV = [
  'NEON_AUTH_BASE_URL',
  'NEON_AUTH_COOKIE_SECRET',
  'DATABASE_URL',
  'VERCEL_ENV',
  'DEPLOYMENT_MODE',
  'IDENTITY_PROVIDER',
  'STORAGE_PROVIDER',
  'DATABASE_PROVIDER',
  'MALWARE_SCANNER_PROVIDER',
  'DOCUMENT_CONVERTER_PROVIDER',
  'AI_PROVIDER',
  'JOB_PROVIDER',
  'EMAIL_PROVIDER',
  'OBSERVABILITY_PROVIDER',
  'PAYMENT_PROVIDER',
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
  setEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
  setEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(40));
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
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Variable-keyed lookup on an arbitrary record — avoids the index-signature lint/type rule. */
function lookup(record: Record<string, string | undefined>, key: string): string | undefined {
  return record[key];
}

function mockDb(overrides: {
  checkConnection?: () => Promise<boolean>;
  isSchemaApplied?: () => Promise<boolean>;
  getMigrationStatus?: () => Promise<{
    expected: number;
    applied: number;
    pending: string[];
  }>;
}): void {
  vi.doMock('@visastack/db', () => ({
    DATABASE_URL_ENV_CANDIDATES: ['DATABASE_URL'],
    createNeonDb: () => ({}),
    checkConnection: overrides.checkConnection ?? (async () => true),
    isSchemaApplied: overrides.isSchemaApplied ?? (async () => true),
    getMigrationStatus:
      overrides.getMigrationStatus ?? (async () => ({ expected: 3, applied: 3, pending: [] })),
    resolveDatabaseUrl: (env: Record<string, string | undefined>) => lookup(env, 'DATABASE_URL'),
  }));
}

describe('GET /api/health/ready — honest health (200 vs 503)', () => {
  // This file's first dynamic import transitively pulls in ./route ->
  // ../../../../lib/commercial-readiness -> ./ai -> the OpenAI SDK transform
  // (same cost capabilities.test.ts/providers.test.ts/commercial-readiness.test.ts
  // already flag) — fast in isolation but can exceed the 5s default under
  // full monorepo test-suite contention
  // (docs/audits/post-programme-defect-register.md finding D-T1). A generous
  // explicit timeout avoids a spurious CI failure unrelated to this test's
  // own correctness.
  it('returns 200 "ready" when DB is connected+migrated and sign-in config is present', async () => {
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  }, 15_000);

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

  it('returns 503 "degraded" when required sign-in config is absent, even with a healthy DB', async () => {
    setEnv('NEON_AUTH_COOKIE_SECRET', '');
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('returns 503 "degraded" when an unsupported *_PROVIDER value is configured, even with DB+sign-in both ready (finding #36)', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'windows-defender');
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('names the offending *_PROVIDER var in the verbose body, but withholds that detail on a real deployment (finding #36)', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'windows-defender');
    mockDb({});
    const { GET: getVerbose } = await import('./route');
    const verboseRes = await getVerbose();
    const verboseBody = await verboseRes.json();
    expect(verboseBody.providers.valid).toBe(false);
    expect(verboseBody.providers.error).toMatch(/MALWARE_SCANNER_PROVIDER/);

    vi.resetModules();
    setEnv('VERCEL_ENV', 'production');
    mockDb({});
    const { GET: getReal } = await import('./route');
    const realRes = await getReal();
    const realBody = await realRes.json();
    expect(realBody.status).toBe('degraded');
    expect(realBody.providers).toBeUndefined();
  });

  it('never echoes the offending *_PROVIDER value into the response body, even in the verbose breakdown (Codex review, PR-E1, round 2)', async () => {
    setEnv('MALWARE_SCANNER_PROVIDER', 'sk_live_accidentally_pasted_secret');
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    const text = await res.text();
    expect(text).toContain('MALWARE_SCANNER_PROVIDER');
    expect(text).not.toContain('sk_live_accidentally_pasted_secret');
  });

  it('reports ready, not degraded, when every optional *_PROVIDER var is blank — the standard cp .env.example .env.local workflow (Codex review, PR-E1)', async () => {
    for (const key of [
      'IDENTITY_PROVIDER',
      'STORAGE_PROVIDER',
      'DATABASE_PROVIDER',
      'MALWARE_SCANNER_PROVIDER',
      'DOCUMENT_CONVERTER_PROVIDER',
      'AI_PROVIDER',
      'JOB_PROVIDER',
      'EMAIL_PROVIDER',
      'OBSERVABILITY_PROVIDER',
      'PAYMENT_PROVIDER',
    ] as const) {
      setEnv(key, '');
    }
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.providers).toEqual({ valid: true });
  });

  it('never includes secret values in the body, even in the non-production breakdown', async () => {
    mockDb({});
    const { GET } = await import('./route');
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain(getEnv('NEON_AUTH_COOKIE_SECRET'));
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

  it('reports the AI connector switched off unless AI_CONNECTOR_ENABLED is "true" (S16)', async () => {
    vi.stubEnv('AI_CONNECTOR_ENABLED', '');
    mockDb({});
    const off = await (await import('./route')).GET();
    expect((await off.json()).platform.aiConnector).toBe('disabled');

    vi.resetModules();
    vi.stubEnv('AI_CONNECTOR_ENABLED', 'true');
    mockDb({});
    const on = await (await import('./route')).GET();
    expect((await on.json()).platform.aiConnector).toBe('available');
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

  describe('commercial mode — the commercial readiness guard (master directive §7 "PR 11")', () => {
    it('returns 503 "degraded" in commercial mode even though the pilot-level core (DB + sign-in) is fully ready', async () => {
      setEnv('DEPLOYMENT_MODE', 'commercial');
      mockDb({});
      const { GET } = await import('./route');
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe('degraded');
      expect(body.commercialReadiness.ready).toBe(false);
    });

    it('force-disables publicSignup/realApplicantData/commercialClaims in its own response when the guard fails, regardless of the general registry', async () => {
      setEnv('DEPLOYMENT_MODE', 'commercial');
      mockDb({});
      const { GET } = await import('./route');
      const res = await GET();
      const body = await res.json();
      expect(body.platform.publicSignup).toBe('disabled');
      expect(body.platform.realApplicantData).toBe('disabled');
      expect(body.platform.commercialClaims).toBe('disabled');
    });

    it('never reports commercialReadiness at all outside commercial mode', async () => {
      mockDb({});
      const { GET } = await import('./route');
      const res = await GET();
      const body = await res.json();
      expect(body.commercialReadiness).toBeUndefined();
    });

    // `getDeploymentMode()` treats an explicit DEPLOYMENT_MODE=commercial
    // override as authoritative regardless of VERCEL_ENV, and
    // `isRealDeployment()` treats any non-"development" mode as real — so
    // commercial mode is, by construction, ALWAYS a "real deployment" as far
    // as this route's own verbose/non-verbose split is concerned. This
    // formerly asserted the OLD, insecure behavior (the public response
    // named every unmet gate, "so an operator can act on the 503") — exactly
    // the disclosure finding #35 exists to close. The specific gates
    // (including that `realMalwareScanner` can never be attested past) are
    // already covered at the pure-function level by
    // `commercial-readiness.test.ts`; what this route must now prove is that
    // NONE of that detail reaches the wire, ever, while the 503/ready=false
    // signal an operator needs still does.
    it('exposes only the aggregate ready boolean on a real deployment, never the per-gate breakdown (finding #35)', async () => {
      setEnv('DEPLOYMENT_MODE', 'commercial');
      setEnv('VERCEL_ENV', 'production');
      mockDb({});
      const { GET } = await import('./route');
      const res = await GET();
      const body = await res.json();
      expect(body.commercialReadiness).toEqual({ ready: false });
      expect(body.commercialReadiness.gates).toBeUndefined();
      // Every gate label/key is genuinely absent from the wire body, not just
      // from the parsed `gates` array — guards against a future refactor
      // smuggling the detail into some other field on a real deployment.
      const text = JSON.stringify(body);
      expect(text).not.toContain('realMalwareScanner');
      expect(text).not.toContain('externalPenetrationTest');
    });
  });
});

describe('GET /api/health/ready: migration drift and what a public probe may reveal (OPS-03)', () => {
  it('is degraded, not ready, while the database lacks migrations this build ships', async () => {
    mockDb({
      getMigrationStatus: async () => ({
        expected: 84,
        applied: 79,
        pending: ['0079_a', '0080_b', '0081_c', '0082_d', '0083_e'],
      }),
    });
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    // The local breakdown names them so a developer can act.
    expect(body.migrations).toMatchObject({ checked: true, pending: expect.any(Array) });
  }, 15_000);

  it('does not fail readiness merely because the drift check itself could not run', async () => {
    mockDb({
      getMigrationStatus: async () => {
        throw new Error('permission denied for schema drizzle');
      },
    });
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.migrations).toEqual({ checked: false });
  }, 15_000);

  it('reveals nothing but the coarse verdict on any deployed build, even one still classed as development (a public PR preview)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    setEnv('MALWARE_SCANNER_PROVIDER', 'windows-defender');
    mockDb({
      getMigrationStatus: async () => ({
        expected: 84,
        applied: 79,
        pending: ['0080_secret_looking_name'],
      }),
    });
    const { GET } = await import('./route');
    const res = await GET();
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.status).toBe('degraded');
    expect(body.deploymentMode).toBe('development');
    for (const hidden of ['env', 'db', 'migrations', 'providers', 'capabilities']) {
      expect(body, hidden).not.toHaveProperty(hidden);
    }
    // No configuration name, secret name, provider detail or migration name reaches a stranger.
    for (const leaked of [
      'NEON_AUTH_BASE_URL',
      'NEON_AUTH_COOKIE_SECRET',
      'DATABASE_URL',
      'MALWARE_SCANNER_PROVIDER',
      'BLOB_SIGNING_SECRET',
      'CRON_SECRET',
      '0080_secret_looking_name',
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
  }, 15_000);

  it('reveals the breakdown on a local run, where it is the developer who is asking', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockDb({});
    const { GET } = await import('./route');
    const body = await (await GET()).json();
    expect(body.env.signIn.NEON_AUTH_COOKIE_SECRET).toBe(true);
    expect(body.db).toEqual({ connected: true, schemaApplied: true });
  }, 15_000);
});
