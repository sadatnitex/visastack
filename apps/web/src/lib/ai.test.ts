import type { AiProviderConfig, Db, KeyManagementPort } from '@visastack/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AI Gateway configuration (master directive §8/§21 cost controls, §7 "PR 6"
 * free-tier gap closure): every cap here is a conservative pilot default,
 * applied the moment an env var is left unset — never an "unlimited until
 * configured" escape hatch, matching how packages/services/quotas.ts treats
 * its own blank QUOTA_* vars.
 */

/**
 * `resolveAiExtractor`'s own tests (below) mock only these three
 * `@visastack/services` entry points -- the same "mock the boundary, run
 * everything else for real" discipline `step-up.test.ts` already
 * establishes for this package. Each function's OWN logic is already
 * thoroughly covered by `packages/services/src/ai-provider-config.test.ts`
 * (which runs against a real PGlite database, unavailable as a dependency
 * here) -- these tests exist to prove `resolveAiExtractor`'s own
 * orchestration (which world are we in, what adapter comes out) in
 * isolation, not to re-prove the services layer's own correctness.
 */
const hasAnyAiProviderConfig = vi.fn();
const getActiveAiProviderConfig = vi.fn();
const revealAiProviderApiKey = vi.fn();

vi.mock('@visastack/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@visastack/services')>();
  return {
    ...actual,
    hasAnyAiProviderConfig: (...args: unknown[]) => hasAnyAiProviderConfig(...args),
    getActiveAiProviderConfig: (...args: unknown[]) => getActiveAiProviderConfig(...args),
    revealAiProviderApiKey: (...args: unknown[]) => revealAiProviderApiKey(...args),
  };
});

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_PROJECT_ID',
  'OPENAI_MODEL_PRIMARY',
  'OPENAI_REASONING_EFFORT',
  'OPENAI_STORE_RESPONSES',
  'AI_PILOT_MONTHLY_HARD_LIMIT_USD',
  'AI_PILOT_MONTHLY_WARNING_USD',
  'AI_PER_DOCUMENT_LIMIT_USD',
  'AI_MAX_ATTEMPTS',
  'AI_MAX_PAGES_PER_DOCUMENT',
  'AI_CACHE_MAX_AGE_DAYS',
  'AI_MAX_CONCURRENT_CALLS',
] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];
  for (const key of ENV_KEYS) unsetEnv(key);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL[key];
    if (original === undefined) unsetEnv(key);
    else setEnv(key, original);
  }
});

describe('createAiExtractor', () => {
  // The first dynamic import in this file pays a one-time module-transform
  // cost that's fast in isolation (~1s) but can approach the 5s default
  // under full monorepo test-suite contention (7 packages' vitest processes
  // running concurrently) — a generous explicit timeout avoids a spurious CI
  // failure that has nothing to do with this test's own correctness (same
  // rationale as apps/web/src/lib/step-up.test.ts's first test).
  it('is undefined when AI_ENABLED is not set', async () => {
    setEnv('OPENAI_API_KEY', 'sk-test');
    const { createAiExtractor } = await import('./ai');
    expect(createAiExtractor()).toBeUndefined();
  }, 15_000);

  it('is undefined when AI_ENABLED is true but no API key is configured', async () => {
    setEnv('AI_ENABLED', 'true');
    const { createAiExtractor } = await import('./ai');
    expect(createAiExtractor()).toBeUndefined();
  });

  it('is undefined for an unsupported AI_PROVIDER — a stray API key never silently activates the wrong adapter', async () => {
    setEnv('AI_ENABLED', 'true');
    setEnv('AI_PROVIDER', 'anthropic');
    setEnv('OPENAI_API_KEY', 'sk-test');
    const { createAiExtractor } = await import('./ai');
    expect(createAiExtractor()).toBeUndefined();
  });

  it('is defined once AI_ENABLED and an API key are both present', async () => {
    setEnv('AI_ENABLED', 'true');
    setEnv('OPENAI_API_KEY', 'sk-test');
    const { createAiExtractor } = await import('./ai');
    expect(createAiExtractor()).toBeDefined();
  });
});

describe('AI cost and volume caps — pilot defaults', () => {
  it('defaults the platform budget to $20/month, expressed in cost units', async () => {
    const { aiBudgetLimitUnits } = await import('./ai');
    expect(aiBudgetLimitUnits()).toBe(2_000_000);
  });

  it('defaults the per-document budget to $0.50, expressed in cost units', async () => {
    const { aiPerDocumentBudgetLimitUnits } = await import('./ai');
    expect(aiPerDocumentBudgetLimitUnits()).toBe(50_000);
  });

  it('defaults the max attempts per document to a small bounded-retry budget, not unlimited', async () => {
    const { aiMaxAttemptsPerDocument } = await import('./ai');
    expect(aiMaxAttemptsPerDocument()).toBe(3);
  });

  it('defaults the max pages per document to a bounded pilot figure, not unlimited', async () => {
    const { aiMaxPagesPerDocument } = await import('./ai');
    expect(aiMaxPagesPerDocument()).toBe(25);
  });

  it('defaults the AI-cache max age to 30 days (PRV-02, Part 7 §11: "AI cache: <=30d later")', async () => {
    const { aiCacheMaxAgeDays } = await import('./ai');
    expect(aiCacheMaxAgeDays()).toBe(30);
  });

  it('defaults the platform-wide concurrency cap to 5 (Part 8 §11: "5 concurrent model calls platform-wide")', async () => {
    const { aiMaxConcurrentCalls } = await import('./ai');
    expect(aiMaxConcurrentCalls()).toBe(5);
  });

  it('lets an administrator override every cap via env', async () => {
    setEnv('AI_PILOT_MONTHLY_HARD_LIMIT_USD', '5');
    setEnv('AI_PER_DOCUMENT_LIMIT_USD', '0.1');
    setEnv('AI_MAX_ATTEMPTS', '1');
    setEnv('AI_MAX_PAGES_PER_DOCUMENT', '2');
    setEnv('AI_CACHE_MAX_AGE_DAYS', '7');
    setEnv('AI_MAX_CONCURRENT_CALLS', '2');
    const {
      aiBudgetLimitUnits,
      aiPerDocumentBudgetLimitUnits,
      aiMaxAttemptsPerDocument,
      aiMaxPagesPerDocument,
      aiCacheMaxAgeDays,
      aiMaxConcurrentCalls,
    } = await import('./ai');
    expect(aiBudgetLimitUnits()).toBe(500_000);
    expect(aiPerDocumentBudgetLimitUnits()).toBe(10_000);
    expect(aiMaxAttemptsPerDocument()).toBe(1);
    expect(aiMaxPagesPerDocument()).toBe(2);
    expect(aiCacheMaxAgeDays()).toBe(7);
    expect(aiMaxConcurrentCalls()).toBe(2);
  });

  it('ignores invalid overrides and keeps the safe pilot defaults', async () => {
    setEnv('AI_MAX_ATTEMPTS', 'not-a-number');
    setEnv('AI_MAX_PAGES_PER_DOCUMENT', '-5');
    setEnv('AI_CACHE_MAX_AGE_DAYS', '0');
    setEnv('AI_MAX_CONCURRENT_CALLS', 'not-a-number');
    const {
      aiMaxAttemptsPerDocument,
      aiMaxPagesPerDocument,
      aiCacheMaxAgeDays,
      aiMaxConcurrentCalls,
    } = await import('./ai');
    expect(aiMaxAttemptsPerDocument()).toBe(3);
    expect(aiMaxPagesPerDocument()).toBe(25);
    expect(aiCacheMaxAgeDays()).toBe(30);
    expect(aiMaxConcurrentCalls()).toBe(5);
  });
});

describe('AI Gateway admin usage-warning threshold (master directive §7 "PR 9")', () => {
  it('defaults the warning threshold to $16/month — below the $20 hard limit, so a fresh install still warns', async () => {
    const { aiWarningLimitUnits, aiBudgetLimitUnits } = await import('./ai');
    expect(aiWarningLimitUnits()).toBe(1_600_000);
    expect(aiWarningLimitUnits()).toBeLessThan(aiBudgetLimitUnits());
  });

  it('lets an administrator override the warning threshold via env, independent of the hard limit', async () => {
    setEnv('AI_PILOT_MONTHLY_WARNING_USD', '8');
    setEnv('AI_PILOT_MONTHLY_HARD_LIMIT_USD', '25');
    const { aiWarningLimitUnits, aiBudgetLimitUnits } = await import('./ai');
    expect(aiWarningLimitUnits()).toBe(800_000);
    expect(aiBudgetLimitUnits()).toBe(2_500_000);
  });

  it('ignores an invalid warning override and keeps the safe pilot default', async () => {
    setEnv('AI_PILOT_MONTHLY_WARNING_USD', 'not-a-number');
    const { aiWarningLimitUnits } = await import('./ai');
    expect(aiWarningLimitUnits()).toBe(1_600_000);
  });

  it('a misconfigured warning threshold above the hard limit is not silently corrected', async () => {
    // Documents actual behavior: readUsdEnv only validates "finite and positive",
    // not "below the hard limit" — an admin who sets the warning higher than the
    // hard limit gets exactly that, since a hard-stop always fires before a
    // warning could anyway. Not a real-world useful config, but not unsafe either.
    setEnv('AI_PILOT_MONTHLY_WARNING_USD', '50');
    setEnv('AI_PILOT_MONTHLY_HARD_LIMIT_USD', '20');
    const { aiWarningLimitUnits, aiBudgetLimitUnits } = await import('./ai');
    expect(aiWarningLimitUnits()).toBe(5_000_000);
    expect(aiBudgetLimitUnits()).toBe(2_000_000);
  });
});

describe('unitsToUsd — inverse of the internal USD-to-cost-units conversion', () => {
  it('round-trips the default monthly budget back to its configured USD figure', async () => {
    const { aiBudgetLimitUnits, unitsToUsd } = await import('./ai');
    expect(unitsToUsd(aiBudgetLimitUnits())).toBe(20);
  });

  it('round-trips the default warning threshold back to its configured USD figure', async () => {
    const { aiWarningLimitUnits, unitsToUsd } = await import('./ai');
    expect(unitsToUsd(aiWarningLimitUnits())).toBe(16);
  });

  it('reports zero spend as $0', async () => {
    const { unitsToUsd } = await import('./ai');
    expect(unitsToUsd(0)).toBe(0);
  });
});

describe('resolveAiExtractor (Part 8 §5: the DB config becomes authoritative once touched)', () => {
  const db = {} as unknown as Db;
  const encryption = {} as unknown as KeyManagementPort;

  function fakeConfig(overrides: Partial<AiProviderConfig> = {}): AiProviderConfig {
    return {
      id: 'config-1',
      status: 'ACTIVE',
      provider: 'openai',
      model: 'gpt-5-db-configured',
      reasoningEffort: null,
      apiKeyCiphertext: Buffer.from('ciphertext'),
      apiKeyNonce: Buffer.from('nonce'),
      apiKeyVersion: 'v1',
      apiKeyFingerprint: '...test',
      keyRevokedAt: null,
      dataPolicyApproved: true,
      budgetLimitUnits: 2_000_000,
      perDocumentBudgetLimitUnits: null,
      maxAttemptsPerDocument: null,
      maxPagesPerDocument: null,
      cacheMaxAgeDays: null,
      maxConcurrentCalls: null,
      notes: null,
      createdByAccountId: null,
      createdAt: new Date(),
      activatedAt: new Date(),
      supersededAt: null,
      disabledAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    hasAnyAiProviderConfig.mockReset();
    getActiveAiProviderConfig.mockReset();
    revealAiProviderApiKey.mockReset();
  });

  it('falls back to createAiExtractor (env-based) when no admin has ever configured AI settings', async () => {
    hasAnyAiProviderConfig.mockResolvedValue(false);
    setEnv('AI_ENABLED', 'true');
    setEnv('OPENAI_API_KEY', 'sk-env-test');
    const { resolveAiExtractor } = await import('./ai');

    const resolved = await resolveAiExtractor(db, encryption);

    expect(resolved).toBeDefined();
    expect(getActiveAiProviderConfig).not.toHaveBeenCalled();
    expect(revealAiProviderApiKey).not.toHaveBeenCalled();
    // The pilot env-var defaults (no overrides set) -- proves the fresh-
    // install path resolves limits from env vars, matching the "AI cost and
    // volume caps" describe block's own established defaults above.
    expect(resolved?.limits).toEqual({
      budgetLimitUnits: 2_000_000,
      perDocumentBudgetLimitUnits: 50_000,
      maxAttemptsPerDocument: 3,
      maxPagesPerDocument: 25,
      cacheMaxAgeDays: 30,
      maxConcurrentCalls: 5,
    });
  });

  it("builds the adapter from the ACTIVE DB config's own provider/model, ignoring env vars entirely", async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(
      fakeConfig({ model: 'gpt-5-db-configured', reasoningEffort: 'high' }),
    );
    revealAiProviderApiKey.mockResolvedValue('sk-from-db');
    // No env vars set at all (beforeEach clears them) -- proves this path never reads them.
    const { resolveAiExtractor } = await import('./ai');

    const resolved = await resolveAiExtractor(db, encryption);

    expect(resolved).toBeDefined();
    expect(resolved?.ai.cacheKeyComponents().model).toBe('gpt-5-db-configured');
    expect(resolved?.ai.cacheKeyComponents().reasoningEffort).toBe('high');
    expect(revealAiProviderApiKey).toHaveBeenCalledWith(
      db,
      encryption,
      expect.objectContaining({ id: 'config-1' }),
    );
  });

  it("resolves limits from the ACTIVE config's own columns, falling back to pilot env defaults per-field when a column is NULL", async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(
      fakeConfig({ budgetLimitUnits: 999_000 }), // every other limit column left null (fakeConfig's own default)
    );
    revealAiProviderApiKey.mockResolvedValue('sk-from-db');
    const { resolveAiExtractor } = await import('./ai');

    const resolved = await resolveAiExtractor(db, encryption);

    expect(resolved?.limits).toEqual({
      budgetLimitUnits: 999_000, // the ACTIVE row's own required column
      perDocumentBudgetLimitUnits: 50_000, // null on the row -> pilot env default
      maxAttemptsPerDocument: 3,
      maxPagesPerDocument: 25,
      cacheMaxAgeDays: 30,
      maxConcurrentCalls: 5,
    });
  });

  it("resolves every limit from the ACTIVE config's own columns when none are NULL", async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(
      fakeConfig({
        budgetLimitUnits: 999_000,
        perDocumentBudgetLimitUnits: 12_000,
        maxAttemptsPerDocument: 7,
        maxPagesPerDocument: 40,
        cacheMaxAgeDays: 3,
        maxConcurrentCalls: 9,
      }),
    );
    revealAiProviderApiKey.mockResolvedValue('sk-from-db');
    const { resolveAiExtractor } = await import('./ai');

    const resolved = await resolveAiExtractor(db, encryption);

    expect(resolved?.limits).toEqual({
      budgetLimitUnits: 999_000,
      perDocumentBudgetLimitUnits: 12_000,
      maxAttemptsPerDocument: 7,
      maxPagesPerDocument: 40,
      cacheMaxAgeDays: 3,
      maxConcurrentCalls: 9,
    });
  });

  it('returns undefined once any config exists but none is ACTIVE (kill switch engaged), even with env vars fully configured', async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(undefined);
    setEnv('AI_ENABLED', 'true');
    setEnv('OPENAI_API_KEY', 'sk-env-test');
    const { resolveAiExtractor } = await import('./ai');

    const extractor = await resolveAiExtractor(db, encryption);

    expect(extractor).toBeUndefined();
    expect(revealAiProviderApiKey).not.toHaveBeenCalled();
  });

  it('returns undefined for an ACTIVE config naming a provider this codebase does not implement', async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(fakeConfig({ provider: 'mistral' }));
    const { resolveAiExtractor } = await import('./ai');

    const extractor = await resolveAiExtractor(db, encryption);

    expect(extractor).toBeUndefined();
    expect(revealAiProviderApiKey).not.toHaveBeenCalled();
  });

  it("builds a GeminiExtractionAdapter from the ACTIVE config's own provider/model when provider is 'gemini'", async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(
      fakeConfig({ provider: 'gemini', model: 'gemini-3.8-flash', reasoningEffort: 'high' }),
    );
    revealAiProviderApiKey.mockResolvedValue('AIza-from-db');
    const { resolveAiExtractor } = await import('./ai');

    const resolved = await resolveAiExtractor(db, encryption);

    expect(resolved).toBeDefined();
    expect(resolved?.ai.cacheKeyComponents().model).toBe('gemini-3.8-flash');
    // Gemini has no reasoning-effort dial (see GeminiExtractionAdapter's own
    // doc comment) -- its cache key never claims to depend on one, even
    // though the config row carries a value for the field.
    expect(resolved?.ai.cacheKeyComponents().reasoningEffort).toBeUndefined();
    expect(revealAiProviderApiKey).toHaveBeenCalledWith(
      db,
      encryption,
      expect.objectContaining({ id: 'config-1', provider: 'gemini' }),
    );
  });

  it("builds an AnthropicExtractionAdapter from the ACTIVE config's own provider/model when provider is 'anthropic'", async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(
      fakeConfig({ provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'high' }),
    );
    revealAiProviderApiKey.mockResolvedValue('sk-ant-from-db');
    const { resolveAiExtractor } = await import('./ai');

    const resolved = await resolveAiExtractor(db, encryption);

    expect(resolved).toBeDefined();
    expect(resolved?.ai.cacheKeyComponents().model).toBe('claude-opus-5-5');
    // Claude has no reasoning-effort dial (see AnthropicExtractionAdapter's
    // own doc comment) -- its cache key never claims to depend on one, even
    // though the config row carries a value for the field.
    expect(resolved?.ai.cacheKeyComponents().reasoningEffort).toBeUndefined();
    expect(revealAiProviderApiKey).toHaveBeenCalledWith(
      db,
      encryption,
      expect.objectContaining({ id: 'config-1', provider: 'anthropic' }),
    );
  });

  it('returns undefined when an ACTIVE openai config exists but no encryption port is available', async () => {
    hasAnyAiProviderConfig.mockResolvedValue(true);
    getActiveAiProviderConfig.mockResolvedValue(fakeConfig());
    const { resolveAiExtractor } = await import('./ai');

    const extractor = await resolveAiExtractor(db, undefined);

    expect(extractor).toBeUndefined();
    expect(revealAiProviderApiKey).not.toHaveBeenCalled();
  });

  describe('resolveAiLimits -- read-only view of the currently governing caps, for admin display', () => {
    it('returns the pilot env defaults on a fresh install', async () => {
      hasAnyAiProviderConfig.mockResolvedValue(false);
      const { resolveAiLimits } = await import('./ai');

      const limits = await resolveAiLimits(db);

      expect(limits).toEqual({
        budgetLimitUnits: 2_000_000,
        perDocumentBudgetLimitUnits: 50_000,
        maxAttemptsPerDocument: 3,
        maxPagesPerDocument: 25,
        cacheMaxAgeDays: 30,
        maxConcurrentCalls: 5,
      });
      expect(getActiveAiProviderConfig).not.toHaveBeenCalled();
    });

    it("returns the ACTIVE config's own budget, ignoring env vars entirely", async () => {
      hasAnyAiProviderConfig.mockResolvedValue(true);
      getActiveAiProviderConfig.mockResolvedValue(fakeConfig({ budgetLimitUnits: 999_000 }));
      setEnv('AI_PILOT_MONTHLY_HARD_LIMIT_USD', '5');
      const { resolveAiLimits } = await import('./ai');

      const limits = await resolveAiLimits(db);

      expect(limits.budgetLimitUnits).toBe(999_000);
    });

    it('falls back to the pilot env defaults once any config exists but none is ACTIVE (kill switch engaged) -- there is no more specific number to show', async () => {
      hasAnyAiProviderConfig.mockResolvedValue(true);
      getActiveAiProviderConfig.mockResolvedValue(undefined);
      const { resolveAiLimits } = await import('./ai');

      const limits = await resolveAiLimits(db);

      expect(limits.budgetLimitUnits).toBe(2_000_000);
    });
  });
});
