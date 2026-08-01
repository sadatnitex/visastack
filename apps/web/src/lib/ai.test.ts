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
  'AI_PER_DOCUMENT_LIMIT_USD',
  'AI_MAX_ATTEMPTS',
  'AI_MAX_PAGES_PER_DOCUMENT',
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

  it('lets an administrator override every cap via env', async () => {
    setEnv('AI_PILOT_MONTHLY_HARD_LIMIT_USD', '5');
    setEnv('AI_PER_DOCUMENT_LIMIT_USD', '0.1');
    setEnv('AI_MAX_ATTEMPTS', '1');
    setEnv('AI_MAX_PAGES_PER_DOCUMENT', '2');
    const {
      aiBudgetLimitUnits,
      aiPerDocumentBudgetLimitUnits,
      aiMaxAttemptsPerDocument,
      aiMaxPagesPerDocument,
    } = await import('./ai');
    expect(aiBudgetLimitUnits()).toBe(500_000);
    expect(aiPerDocumentBudgetLimitUnits()).toBe(10_000);
    expect(aiMaxAttemptsPerDocument()).toBe(1);
    expect(aiMaxPagesPerDocument()).toBe(2);
  });

  it('ignores invalid overrides and keeps the safe pilot defaults', async () => {
    setEnv('AI_MAX_ATTEMPTS', 'not-a-number');
    setEnv('AI_MAX_PAGES_PER_DOCUMENT', '-5');
    const { aiMaxAttemptsPerDocument, aiMaxPagesPerDocument } = await import('./ai');
    expect(aiMaxAttemptsPerDocument()).toBe(3);
    expect(aiMaxPagesPerDocument()).toBe(25);
  });
});
