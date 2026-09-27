import 'server-only';
import { OpenAiExtractionAdapter } from '@visastack/adapters';
import type { AiExtractionPort } from '@visastack/services';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

function readUsdEnv(name: string, fallbackUsd: number): number {
  const raw = readEnv(name);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackUsd;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * The AI Gateway is an OPTIONAL pilot feature (master directive §5: "OpenAI
 * API pilot project"), unlike storage which every upload depends on — so
 * there is no fail-closed production requirement here, just "on" or "off".
 * Requires BOTH the explicit `AI_ENABLED` master switch AND a configured API
 * key — a stray `OPENAI_API_KEY` alone (e.g. left over in an environment)
 * never silently turns the feature on. Returns undefined when unavailable;
 * callers must treat that as "AI extraction unavailable" and hide the
 * feature, never crash.
 */
export function createAiExtractor(): AiExtractionPort | undefined {
  if (readEnv('AI_ENABLED') !== 'true') return undefined;
  const provider = readEnv('AI_PROVIDER');
  if (provider && provider !== 'openai') return undefined; // only the OpenAI adapter exists so far.
  const apiKey = readEnv('OPENAI_API_KEY');
  if (!apiKey) return undefined;

  const model = readEnv('OPENAI_MODEL_PRIMARY');
  const projectId = readEnv('OPENAI_PROJECT_ID');
  const reasoningEffort = readEnv('OPENAI_REASONING_EFFORT');
  return new OpenAiExtractionAdapter({
    apiKey,
    ...(model ? { model } : {}),
    ...(projectId ? { projectId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    storeResponses: readEnv('OPENAI_STORE_RESPONSES') === 'true',
  });
}

/**
 * Very rough $/1M-token blended rate used ONLY to translate the
 * operator-facing USD budget knobs (env contract, below) into the
 * token-based "cost units" the service layer's durable ledger tracks
 * (packages/services/src/ai.ts — costUnits IS billed tokens, a driftless,
 * unitless proxy for spend). Deliberately conservative and approximate —
 * NOT a billing source of truth — revisit if OpenAI's published pricing for
 * the configured model changes materially.
 */
const APPROX_USD_PER_MILLION_TOKENS = 10;

function usdToUnits(usd: number): number {
  return Math.round((usd / APPROX_USD_PER_MILLION_TOKENS) * 1_000_000);
}

/** Inverse of usdToUnits — an approximate USD figure for admin display only, never a billing source of truth. */
export function unitsToUsd(units: number): number {
  return (units / 1_000_000) * APPROX_USD_PER_MILLION_TOKENS;
}

const DEFAULT_MONTHLY_BUDGET_USD = 20;
// ~80% of the hard limit, matching the platform storage quota's
// warning/hard-stop ratio (500MB warn / 700MB hard stop).
const DEFAULT_MONTHLY_WARNING_USD = 16;
const DEFAULT_PER_DOCUMENT_BUDGET_USD = 0.5;
// Bounded-retry and document-length caps, like the budget caps above, are
// conservative pilot defaults rather than an "unset = unlimited" escape
// hatch — a blank AI_MAX_ATTEMPTS/AI_MAX_PAGES_PER_DOCUMENT in .env.example
// must still fail closed, the same way a blank QUOTA_* var does.
const DEFAULT_MAX_ATTEMPTS_PER_DOCUMENT = 3;
const DEFAULT_MAX_PAGES_PER_DOCUMENT = 25;
// Part 8 §11's own named default: "5 concurrent model calls platform-wide".
const DEFAULT_MAX_CONCURRENT_CALLS = 5;
// PRV-02 (master directive Part 7 §11): "AI cache: <=30d later" -- the
// directive's own retention table calls this a proposed default, not an
// immutable legal fact, hence env-overridable like every cap above.
const DEFAULT_CACHE_MAX_AGE_DAYS = 30;

/** Platform-wide pilot budget cap, in cost units (env: AI_PILOT_MONTHLY_HARD_LIMIT_USD). */
export function aiBudgetLimitUnits(): number {
  return usdToUnits(readUsdEnv('AI_PILOT_MONTHLY_HARD_LIMIT_USD', DEFAULT_MONTHLY_BUDGET_USD));
}

/**
 * Admin-warning threshold, in cost units (env: AI_PILOT_MONTHLY_WARNING_USD —
 * master directive §7 "PR 9" cost controls: "admin warning" as a distinct
 * signal from the hard stop). Below the hard limit's own default when unset,
 * so a fresh install still gets an early warning rather than none.
 */
export function aiWarningLimitUnits(): number {
  return usdToUnits(readUsdEnv('AI_PILOT_MONTHLY_WARNING_USD', DEFAULT_MONTHLY_WARNING_USD));
}

/** Per-document spend cap, in cost units (env: AI_PER_DOCUMENT_LIMIT_USD). */
export function aiPerDocumentBudgetLimitUnits(): number {
  return usdToUnits(readUsdEnv('AI_PER_DOCUMENT_LIMIT_USD', DEFAULT_PER_DOCUMENT_BUDGET_USD));
}

/** Max AI invocations per document (env: AI_MAX_ATTEMPTS). */
export function aiMaxAttemptsPerDocument(): number {
  return readPositiveIntEnv('AI_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS_PER_DOCUMENT);
}

/** Refuse documents longer than this many pages (env: AI_MAX_PAGES_PER_DOCUMENT). */
export function aiMaxPagesPerDocument(): number {
  return readPositiveIntEnv('AI_MAX_PAGES_PER_DOCUMENT', DEFAULT_MAX_PAGES_PER_DOCUMENT);
}

/** Max age of a reusable cache hit, in days (env: AI_CACHE_MAX_AGE_DAYS). */
export function aiCacheMaxAgeDays(): number {
  return readPositiveIntEnv('AI_CACHE_MAX_AGE_DAYS', DEFAULT_CACHE_MAX_AGE_DAYS);
}

/** Most AI extraction calls allowed in flight platform-wide at once (env: AI_MAX_CONCURRENT_CALLS). */
export function aiMaxConcurrentCalls(): number {
  return readPositiveIntEnv('AI_MAX_CONCURRENT_CALLS', DEFAULT_MAX_CONCURRENT_CALLS);
}
