import 'server-only';
import {
  AnthropicExtractionAdapter,
  GeminiExtractionAdapter,
  OpenAiExtractionAdapter,
} from '@visastack/adapters';
import {
  type AiExtractionPort,
  type AiProviderConfig,
  type Db,
  type KeyManagementPort,
  getActiveAiProviderConfig,
  hasAnyAiProviderConfig,
  revealAiProviderApiKey,
} from '@visastack/services';

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

/** The six operational caps below, resolved from whichever source currently governs them (env vars, or an ACTIVE DB config's own columns). */
export interface AiLimits {
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits: number;
  readonly maxAttemptsPerDocument: number;
  readonly maxPagesPerDocument: number;
  readonly cacheMaxAgeDays: number;
  readonly maxConcurrentCalls: number;
}

export interface ResolvedAiExtractor {
  readonly ai: AiExtractionPort;
  readonly limits: AiLimits;
}

/**
 * Every provider this codebase can actually dispatch to via a DB config
 * (Part 8 §3: "ship production adapters for OpenAI API; Google Gemini API;
 * Anthropic Claude API" -- all three now implemented). Checked BEFORE
 * `revealAiProviderApiKey` runs (below), not after building the adapter --
 * an unimplemented provider must never pay for a real KMS decrypt of a key
 * it is never going to use. Keep this set and `buildAdapterForConfig`'s own
 * switch in sync when a new provider ships.
 */
const IMPLEMENTED_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'anthropic', 'gemini']);

function buildAdapterForConfig(config: AiProviderConfig, apiKey: string): AiExtractionPort {
  const shared = {
    apiKey,
    model: config.model,
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    storeResponses: false,
  };
  switch (config.provider) {
    case 'openai':
      return new OpenAiExtractionAdapter(shared);
    case 'anthropic':
      return new AnthropicExtractionAdapter(shared);
    case 'gemini':
      return new GeminiExtractionAdapter(shared);
    default:
      // Unreachable in practice: resolveAiExtractor only calls this once
      // IMPLEMENTED_PROVIDERS.has(config.provider) is already true. Throwing
      // rather than silently defaulting to some adapter guards against the
      // two ever drifting apart (a provider added to one but not the other)
      // actually dispatching to the WRONG provider's API with the wrong
      // provider's just-decrypted key.
      throw new Error(`buildAdapterForConfig: unhandled provider "${config.provider}"`);
  }
}

/**
 * The adapter (and its governing limits) a live extraction call should
 * actually use (Part 8 §5: once an admin has ever engaged with AI Settings
 * at all, the DB becomes authoritative for what runs, not just whether
 * anything runs -- see `isAiDispatchAllowed`'s identical "has the table ever
 * been touched" rule, which this mirrors so the two functions can never
 * disagree about which world we're in).
 *
 * On a fresh install where `ai_provider_configs` is still empty, this is
 * `createAiExtractor()` unchanged plus the six env-var limit functions below
 * -- today's 100% env-var behavior, completely unaffected (and still
 * OpenAI-only: the env-var fallback path predates the DB config system and
 * was never extended to other providers, since it exists only to cover a
 * fresh install that has not yet engaged with AI Settings at all). The
 * instant a first row exists, only a genuinely ACTIVE config naming an
 * implemented provider (`buildAdapterForConfig`, above) can produce an
 * adapter here, with a working encryption port to decrypt its key --
 * anything else (nothing ACTIVE, an unimplemented provider, no KMS
 * configured) returns undefined rather than silently falling back to stale
 * env vars, matching the kill switch's own fail-closed posture once the DB
 * path is in play. When it does resolve, its `limits` come from that SAME
 * config row (never a second, separately-timed read) -- each of the five
 * optional columns falls back to its own env-var default individually when
 * NULL on that row, since Part 8 §5's admin form lets an operator leave any
 * of them unset; `budgetLimitUnits` alone is never NULL (the schema requires
 * it at creation).
 *
 * `storeResponses`/`projectId` have no DB-config equivalent yet (Part 8 §5's
 * "set limits"/"set reviewed data policy" journey doesn't cover them) --
 * `storeResponses` defaults to `false` (privacy minimization) rather than
 * inheriting whatever `OPENAI_STORE_RESPONSES` happens to be set to, and
 * `projectId` is OpenAI-specific so `buildAdapterForConfig` never passes it.
 */
export async function resolveAiExtractor(
  db: Db,
  encryption: KeyManagementPort | undefined,
): Promise<ResolvedAiExtractor | undefined> {
  if (await hasAnyAiProviderConfig(db)) {
    const config = await getActiveAiProviderConfig(db);
    if (!config || !encryption || !IMPLEMENTED_PROVIDERS.has(config.provider)) return undefined;
    const apiKey = await revealAiProviderApiKey(db, encryption, config);
    return { ai: buildAdapterForConfig(config, apiKey), limits: limitsFromConfig(config) };
  }
  const ai = createAiExtractor();
  return ai ? { ai, limits: limitsFromConfig(undefined) } : undefined;
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

/** Exported for the AI Gateway admin UI, so a USD figure typed into the settings form converts to cost units the same way the env-var caps above do -- one conversion, never a second invented scheme. */
export function usdToUnits(usd: number): number {
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

/** `config` is `undefined` on a fresh install; each field otherwise falls back to its own env-var default individually when NULL on that row (an admin may leave any of the five optional limits unset). */
function limitsFromConfig(config: AiProviderConfig | undefined): AiLimits {
  return {
    budgetLimitUnits: config?.budgetLimitUnits ?? aiBudgetLimitUnits(),
    perDocumentBudgetLimitUnits:
      config?.perDocumentBudgetLimitUnits ?? aiPerDocumentBudgetLimitUnits(),
    maxAttemptsPerDocument: config?.maxAttemptsPerDocument ?? aiMaxAttemptsPerDocument(),
    maxPagesPerDocument: config?.maxPagesPerDocument ?? aiMaxPagesPerDocument(),
    cacheMaxAgeDays: config?.cacheMaxAgeDays ?? aiCacheMaxAgeDays(),
    maxConcurrentCalls: config?.maxConcurrentCalls ?? aiMaxConcurrentCalls(),
  };
}

/**
 * Read-only view of the six operational limits currently in effect --
 * for admin display (e.g. the platform-admin spend meter) where no adapter
 * is being built, so `resolveAiExtractor`'s own single-config-read discipline
 * doesn't apply. Shares the identical "authoritative once touched" rule (via
 * the same `hasAnyAiProviderConfig` check) so a display value can never
 * silently disagree with what `resolveAiExtractor` actually dispatched with
 * moments earlier.
 */
export async function resolveAiLimits(db: Db): Promise<AiLimits> {
  if (!(await hasAnyAiProviderConfig(db))) return limitsFromConfig(undefined);
  return limitsFromConfig(await getActiveAiProviderConfig(db));
}
