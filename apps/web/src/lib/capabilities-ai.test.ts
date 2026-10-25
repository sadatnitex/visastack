import type { AiProviderConfig, Db, KeyManagementPort } from '@visastack/services';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The live `aiExtraction` capability (the public status page's "AI Suggestions
 * from Documents" row) must give the same answer `resolveAiExtractor` acts on:
 * the database-managed AI settings first, then the environment with its
 * `AI_ENABLED` switch. Only the database reads and the key-management factory
 * are replaced here; the decision itself runs for real (lib/ai.ts).
 */
const services = vi.hoisted(() => ({
  hasAnyAiProviderConfig: vi.fn(),
  getActiveAiProviderConfig: vi.fn(),
  kms: vi.fn(),
  dbConnects: true,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  hasAnyAiProviderConfig: (...args: unknown[]) => services.hasAnyAiProviderConfig(...args),
  getActiveAiProviderConfig: (...args: unknown[]) => services.getActiveAiProviderConfig(...args),
}));

vi.mock('./providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./providers')>()),
  createKeyManagementPort: () => services.kms(),
}));

vi.mock('@visastack/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/db')>()),
  createNeonDb: () => ({ fake: 'db' }),
  checkConnection: async () => {
    if (!services.dbConnects) throw new Error('connection refused');
    return true;
  },
  isSchemaApplied: async () => services.dbConnects,
  getMigrationStatus: async () => ({ expected: 1, applied: 1, pending: [] }),
}));

const FAKE_DB = { fake: 'db' } as unknown as Db;
const KMS = {} as KeyManagementPort;

function activeConfig(provider: string): AiProviderConfig {
  return {
    id: 'cfg-1',
    provider,
    model: 'model-x',
    status: 'ACTIVE',
  } as unknown as AiProviderConfig;
}

/** No AI settings ever saved in the database: the environment decides. */
function freshInstall(): void {
  services.hasAnyAiProviderConfig.mockResolvedValue(false);
  services.getActiveAiProviderConfig.mockResolvedValue(undefined);
}

beforeAll(async () => {
  await import('./capabilities');
}, 120_000);

beforeEach(async () => {
  vi.unstubAllEnvs();
  for (const name of ['AI_ENABLED', 'AI_PROVIDER', 'OPENAI_API_KEY']) vi.stubEnv(name, '');
  services.hasAnyAiProviderConfig.mockReset();
  services.getActiveAiProviderConfig.mockReset();
  services.kms.mockReset();
  services.kms.mockReturnValue(KMS);
  services.dbConnects = true;
  (await import('./capabilities')).clearAiCapabilityCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAiExtractionCapability', () => {
  it('is available with only an environment key and the switch on', async () => {
    freshInstall();
    vi.stubEnv('AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-synthetic');
    const { resolveAiExtractionCapability } = await import('./capabilities');
    expect(await resolveAiExtractionCapability(FAKE_DB)).toBe('available');
  });

  it('is available for a database-configured Anthropic setting with no environment key', async () => {
    services.hasAnyAiProviderConfig.mockResolvedValue(true);
    services.getActiveAiProviderConfig.mockResolvedValue(activeConfig('anthropic'));
    const { getPlatformCapabilities, resolveAiExtractionCapability } = await import(
      './capabilities'
    );
    // The configuration-only registry cannot see the database; the live answer can.
    expect(getPlatformCapabilities().aiExtraction).toBe('unconfigured');
    expect(await resolveAiExtractionCapability(FAKE_DB)).toBe('available');
  });

  it('is not available when the environment switch is off, even with a key', async () => {
    freshInstall();
    vi.stubEnv('OPENAI_API_KEY', 'sk-synthetic');
    const { resolveAiExtractionCapability } = await import('./capabilities');
    expect(await resolveAiExtractionCapability(FAKE_DB)).toBe('unconfigured');
  });

  it('is switched off once an admin disables AI in the settings, whatever the environment says', async () => {
    services.hasAnyAiProviderConfig.mockResolvedValue(true);
    services.getActiveAiProviderConfig.mockResolvedValue(undefined);
    vi.stubEnv('AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-synthetic');
    const { resolveAiExtractionCapability } = await import('./capabilities');
    expect(await resolveAiExtractionCapability(FAKE_DB)).toBe('disabled');
  });

  it('is not available for an active database setting when keys cannot be unlocked', async () => {
    services.hasAnyAiProviderConfig.mockResolvedValue(true);
    services.getActiveAiProviderConfig.mockResolvedValue(activeConfig('gemini'));
    services.kms.mockReturnValue(undefined);
    const { resolveAiExtractionCapability } = await import('./capabilities');
    expect(await resolveAiExtractionCapability(FAKE_DB)).toBe('unconfigured');
  });

  it('says switched off, never throws, when the database cannot be reached or asked', async () => {
    const { resolveAiExtractionCapability } = await import('./capabilities');
    expect(await resolveAiExtractionCapability(undefined)).toBe('disabled');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    services.hasAnyAiProviderConfig.mockRejectedValue(
      new Error('Failed query: select provider from ai_provider_configs (anthropic sk-ant-x)'),
    );
    expect(await resolveAiExtractionCapability(FAKE_DB)).toBe('disabled');
    // The failure is logged as a warning that names no provider, key, setting or query.
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('capability_lookup_failed');
    expect(line).toContain('aiExtraction');
    for (const detail of ['anthropic', 'sk-ant', 'ai_provider_configs', 'Failed query']) {
      expect(line).not.toContain(detail);
    }
    warn.mockRestore();
    // A failed lookup is not kept: the next request asks again and sees recovery.
    freshInstall();
    vi.stubEnv('AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-synthetic');
    expect(await resolveAiExtractionCapability(FAKE_DB)).toBe('available');
  });

  it('asks the database at most once a minute, and shares one lookup between callers', async () => {
    freshInstall();
    const { AI_CAPABILITY_TTL_MS, resolveAiExtractionCapability } = await import('./capabilities');
    const start = 1_000_000;
    await Promise.all([
      resolveAiExtractionCapability(FAKE_DB, start),
      resolveAiExtractionCapability(FAKE_DB, start),
    ]);
    await resolveAiExtractionCapability(FAKE_DB, start + AI_CAPABILITY_TTL_MS - 1);
    expect(services.hasAnyAiProviderConfig).toHaveBeenCalledTimes(1);
    await resolveAiExtractionCapability(FAKE_DB, start + AI_CAPABILITY_TTL_MS);
    expect(services.hasAnyAiProviderConfig).toHaveBeenCalledTimes(2);
  });
});

describe('the public readiness answer behind the status page', () => {
  beforeEach(() => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(40));
    vi.stubEnv('DATABASE_URL', 'postgres://example.invalid/db');
    vi.stubEnv('VERCEL_ENV', 'production');
  });

  it('reports database-configured AI as working, naming no provider, model or setting', async () => {
    services.hasAnyAiProviderConfig.mockResolvedValue(true);
    services.getActiveAiProviderConfig.mockResolvedValue(activeConfig('anthropic'));
    const { GET } = await import('../app/api/health/ready/route');
    const response = await GET();
    const text = await response.text();
    expect(JSON.parse(text).platform.aiExtraction).toBe('available');
    for (const detail of ['anthropic', 'model-x', 'cfg-1']) expect(text).not.toContain(detail);
  }, 60_000);

  it('still answers with a safe state when the database is unreachable', async () => {
    services.dbConnects = false;
    services.hasAnyAiProviderConfig.mockResolvedValue(true);
    services.getActiveAiProviderConfig.mockResolvedValue(activeConfig('anthropic'));
    const { GET } = await import('../app/api/health/ready/route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).platform.aiExtraction).toBe('disabled');
    expect(services.hasAnyAiProviderConfig).not.toHaveBeenCalled();
  }, 60_000);
});
