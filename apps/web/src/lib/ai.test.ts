import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * AI Gateway configuration (master directive §8/§21 cost controls, §7 "PR 6"
 * free-tier gap closure): every cap here is a conservative pilot default,
 * applied the moment an env var is left unset — never an "unlimited until
 * configured" escape hatch, matching how packages/services/quotas.ts treats
 * its own blank QUOTA_* vars.
 */

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

  it('lets an administrator override every cap via env', async () => {
    setEnv('AI_PILOT_MONTHLY_HARD_LIMIT_USD', '5');
    setEnv('AI_PER_DOCUMENT_LIMIT_USD', '0.1');
    setEnv('AI_MAX_ATTEMPTS', '1');
    setEnv('AI_MAX_PAGES_PER_DOCUMENT', '2');
    setEnv('AI_CACHE_MAX_AGE_DAYS', '7');
    const {
      aiBudgetLimitUnits,
      aiPerDocumentBudgetLimitUnits,
      aiMaxAttemptsPerDocument,
      aiMaxPagesPerDocument,
      aiCacheMaxAgeDays,
    } = await import('./ai');
    expect(aiBudgetLimitUnits()).toBe(500_000);
    expect(aiPerDocumentBudgetLimitUnits()).toBe(10_000);
    expect(aiMaxAttemptsPerDocument()).toBe(1);
    expect(aiMaxPagesPerDocument()).toBe(2);
    expect(aiCacheMaxAgeDays()).toBe(7);
  });

  it('ignores invalid overrides and keeps the safe pilot defaults', async () => {
    setEnv('AI_MAX_ATTEMPTS', 'not-a-number');
    setEnv('AI_MAX_PAGES_PER_DOCUMENT', '-5');
    setEnv('AI_CACHE_MAX_AGE_DAYS', '0');
    const { aiMaxAttemptsPerDocument, aiMaxPagesPerDocument, aiCacheMaxAgeDays } = await import(
      './ai'
    );
    expect(aiMaxAttemptsPerDocument()).toBe(3);
    expect(aiMaxPagesPerDocument()).toBe(25);
    expect(aiCacheMaxAgeDays()).toBe(30);
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
