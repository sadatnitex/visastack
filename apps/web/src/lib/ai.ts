import 'server-only';
import {
  AnthropicExtractionAdapter,
  AnthropicOcrAdapter,
  GeminiExtractionAdapter,
  GeminiOcrAdapter,
  OpenAiExtractionAdapter,
  OpenAiOcrAdapter,
} from '@visastack/adapters';
import {
  type AiClassifyPort,
  type AiExtractionPort,
  type AiOcrPort,
  type AiProviderConfig,
  type Db,
  type KeyManagementPort,
  getActiveAiProviderConfig,
  getAiProviderConfigForFallback,
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
  /** Part 8 §13 (cross-provider fallback). Present only when the ACTIVE config has fallback enabled and its designated target is currently eligible -- see `resolveFallbackExtractor`'s own doc comment for the live re-verification this performs. */
  readonly fallback?: { readonly ai: AiExtractionPort };
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

/**
 * Returns `AiExtractionPort & AiClassifyPort`, not just `AiExtractionPort`
 * -- every case below is one of the three adapter classes that Chunk C
 * (Part 8 AI-01 item 2) wired to implement BOTH ports on the same instance,
 * so `resolveAiClassifier` reuses this SAME function unchanged rather than
 * duplicating an equivalent construction switch for classification.
 */
function buildAdapterForConfig(
  config: AiProviderConfig,
  apiKey: string,
): AiExtractionPort & AiClassifyPort {
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
/**
 * Part 8 §13 (cross-provider fallback): re-verifies the ACTIVE config's
 * designated fallback target LIVE, at the exact moment it might actually be
 * dispatched to -- never trusting `fallbackProviderConfigId` as a permanent
 * fact from whenever `activateAiProviderConfig` first checked it, since the
 * target's own `keyRevokedAt` can change afterward (`revokeAiProviderConfigKey`
 * is a mutation on an existing row, unlike everything else on a config,
 * which is set once and never edited). The genuinely-different-provider and
 * data-policy checks are re-run too even though activation already enforced
 * them -- defense in depth costs nothing here, and this is exactly the
 * boundary directive §13 names ("provider already passed same privacy/task/
 * budget gates"). Returns undefined (never a throw) for every ineligible
 * case, exactly like every other fail-closed check in this file -- a
 * fallback that can no longer be trusted simply does not exist as far as
 * the caller is concerned, it is never worth degrading to anyway.
 */
async function resolveFallbackExtractor(
  db: Db,
  encryption: KeyManagementPort,
  primary: AiProviderConfig,
): Promise<{ ai: AiExtractionPort } | undefined> {
  if (!primary.fallbackEnabled || !primary.fallbackProviderConfigId) return undefined;
  const target = await getAiProviderConfigForFallback(db, primary.fallbackProviderConfigId);
  if (!target) return undefined;
  if (target.provider === primary.provider) return undefined;
  if (!target.dataPolicyApproved || target.keyRevokedAt !== null) return undefined;
  if (!IMPLEMENTED_PROVIDERS.has(target.provider)) return undefined;
  const apiKey = await revealAiProviderApiKey(db, encryption, target);
  return { ai: buildAdapterForConfig(target, apiKey) };
}

export async function resolveAiExtractor(
  db: Db,
  encryption: KeyManagementPort | undefined,
): Promise<ResolvedAiExtractor | undefined> {
  if (await hasAnyAiProviderConfig(db)) {
    const config = await getActiveAiProviderConfig(db);
    if (!config || !encryption || !IMPLEMENTED_PROVIDERS.has(config.provider)) return undefined;
    const apiKey = await revealAiProviderApiKey(db, encryption, config);
    const fallback = await resolveFallbackExtractor(db, encryption, config);
    return {
      ai: buildAdapterForConfig(config, apiKey),
      limits: limitsFromConfig(config),
      ...(fallback ? { fallback } : {}),
    };
  }
  const ai = createAiExtractor();
  return ai ? { ai, limits: limitsFromConfig(undefined) } : undefined;
}

/**
 * The adapter an admin-triggered synthetic connection test should use against
 * a SPECIFIC config row (Part 8 §5 / J15's own admin journey: "config OpenAI;
 * test; activate" -- testing happens BEFORE a config is ever ACTIVE, so this
 * takes the config the caller already fetched by id via
 * `getAiProviderConfigById`, never the active one `resolveAiExtractor` reads).
 * Mirrors that function's fail-closed rules -- an unimplemented provider or a
 * missing encryption port returns undefined, never a throw -- but deliberately
 * has no `limits`/budget return value: a synthetic test never touches
 * `runExtraction`'s budget, cache, or kill-switch machinery, since it is not a
 * billable extraction run (directive's own instruction: "do not use customer
 * documents").
 */
export async function resolveTestAdapter(
  db: Db,
  encryption: KeyManagementPort | undefined,
  config: AiProviderConfig,
): Promise<AiExtractionPort | undefined> {
  if (!encryption || !IMPLEMENTED_PROVIDERS.has(config.provider)) return undefined;
  const apiKey = await revealAiProviderApiKey(db, encryption, config);
  return buildAdapterForConfig(config, apiKey);
}

export interface ResolvedAiClassifier {
  readonly ai: AiClassifyPort;
  readonly limits: AiLimits;
}

/**
 * The classify adapter (and its governing limits) a live document-type
 * classification call should use (Part 8 AI-01 item 2), built from the SAME
 * ACTIVE `ai_provider_configs` row `resolveAiExtractor` reads -- reuses
 * `buildAdapterForConfig` unchanged (see its own doc comment) since every
 * implemented provider's adapter class satisfies both ports already.
 *
 * Deliberately no env-var-only fallback path (unlike `resolveAiExtractor`'s
 * own `createAiExtractor()` branch): classification is a Commercial-V1-native
 * capability introduced well after the DB-config system already existed, so
 * there is no legacy env-var-configurable predecessor to preserve behavior
 * for. An install with no `ai_provider_configs` row at all simply has no AI
 * classification available -- the deterministic classifier
 * (`classification.ts`) and manual entry remain fully functional regardless,
 * matching Part 8's own "manual core must remain functional with AI
 * disabled" requirement.
 *
 * No cross-provider fallback field yet (Part 8 §13) -- deliberately deferred,
 * matching `runClassification`'s own doc comment.
 */
export async function resolveAiClassifier(
  db: Db,
  encryption: KeyManagementPort | undefined,
): Promise<ResolvedAiClassifier | undefined> {
  if (!(await hasAnyAiProviderConfig(db))) return undefined;
  const config = await getActiveAiProviderConfig(db);
  if (!config || !encryption || !IMPLEMENTED_PROVIDERS.has(config.provider)) return undefined;
  const apiKey = await revealAiProviderApiKey(db, encryption, config);
  return { ai: buildAdapterForConfig(config, apiKey), limits: limitsFromConfig(config) };
}

/**
 * Providers with a real OCR adapter (Part 8 §9), separate from
 * `IMPLEMENTED_PROVIDERS` above -- OCR reuses the same admin-configured AI
 * Gateway provider/key (Part 8 Chunk 14's own architecture decision). All
 * three directive-named providers now have an `AiOcrPort` implementation,
 * matching `IMPLEMENTED_PROVIDERS`'s own now-complete set. Keep this set and
 * `buildOcrAdapterForConfig`'s own switch in sync if a fourth provider ever
 * ships.
 */
const IMPLEMENTED_OCR_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'anthropic', 'gemini']);

function buildOcrAdapterForConfig(config: AiProviderConfig, apiKey: string): AiOcrPort {
  switch (config.provider) {
    case 'openai':
      return new OpenAiOcrAdapter({ apiKey, model: config.model, storeResponses: false });
    case 'anthropic':
      return new AnthropicOcrAdapter({ apiKey, model: config.model, storeResponses: false });
    case 'gemini':
      return new GeminiOcrAdapter({ apiKey, model: config.model, storeResponses: false });
    default:
      // Unreachable in practice: resolveOcrAdapter only calls this once
      // IMPLEMENTED_OCR_PROVIDERS.has(config.provider) is already true --
      // see buildAdapterForConfig's own identical reasoning above.
      throw new Error(`buildOcrAdapterForConfig: unhandled provider "${config.provider}"`);
  }
}

export interface ResolvedOcrAdapter {
  readonly ai: AiOcrPort;
  readonly limits: AiLimits;
  /** Part 8 §13 (cross-provider fallback), mirroring `ResolvedAiExtractor`'s own field exactly. */
  readonly fallback?: { readonly ai: AiOcrPort };
}

/**
 * The OCR adapter (and its governing limits) a live OCR call should use,
 * built from the SAME ACTIVE `ai_provider_configs` row `resolveAiExtractor`
 * reads (Part 8 Chunk 14: OCR deliberately reuses the existing,
 * admin-configured AI Gateway provider rather than a second,
 * independently-configured OCR component). Unlike `resolveAiExtractor`,
 * there is no env-var fallback path here -- OCR is Commercial-V1-native and
 * was never env-var-configurable the way text extraction historically was,
 * so an install with no `ai_provider_configs` row at all simply has no OCR
 * available, full stop (the manual-entry path is always the fallback, per
 * Part 8 §9's own "manual entry always available" requirement). Returns
 * `undefined` -- never a throw -- for every fail-closed case
 * `resolveAiExtractor` itself already treats that way: no config touched
 * yet, nothing genuinely ACTIVE, an ACTIVE config naming a provider with no
 * OCR adapter (`IMPLEMENTED_OCR_PROVIDERS`, a SEPARATE, smaller set than
 * text extraction's own -- an ACTIVE Gemini or Anthropic config is real for
 * text extraction but not yet for OCR), or no encryption port available.
 *
 * `limits` come from the identical `limitsFromConfig`/`resolveAiLimits`
 * machinery `resolveAiExtractor` itself uses, never a second, separately
 * computed set of numbers -- Part 8 Chunk 18's own user-confirmed decision
 * was that OCR shares the SAME platform-wide budget/concurrency ledger as
 * text extraction (implemented in `packages/services/src/ai.ts`'s shared
 * accounting helpers), so the two adapters must also resolve to the exact
 * same limit values, not independently-drifting ones. This function
 * originally returned the bare adapter only, before that decision existed;
 * now that it does, returning `{ai, limits}` keeps this the same shape as
 * `resolveAiExtractor` rather than leaving two different resolver
 * conventions for what are now symmetric concerns.
 */
/** Part 8 §13 (cross-provider fallback), mirroring `resolveFallbackExtractor`'s own live re-verification exactly, for OCR's own separate (smaller) implemented-provider set. */
async function resolveFallbackOcrAdapter(
  db: Db,
  encryption: KeyManagementPort,
  primary: AiProviderConfig,
): Promise<{ ai: AiOcrPort } | undefined> {
  if (!primary.fallbackEnabled || !primary.fallbackProviderConfigId) return undefined;
  const target = await getAiProviderConfigForFallback(db, primary.fallbackProviderConfigId);
  if (!target) return undefined;
  if (target.provider === primary.provider) return undefined;
  if (!target.dataPolicyApproved || target.keyRevokedAt !== null) return undefined;
  if (!IMPLEMENTED_OCR_PROVIDERS.has(target.provider)) return undefined;
  const apiKey = await revealAiProviderApiKey(db, encryption, target);
  return { ai: buildOcrAdapterForConfig(target, apiKey) };
}

export async function resolveOcrAdapter(
  db: Db,
  encryption: KeyManagementPort | undefined,
): Promise<ResolvedOcrAdapter | undefined> {
  if (!(await hasAnyAiProviderConfig(db))) return undefined;
  const config = await getActiveAiProviderConfig(db);
  if (!config || !encryption || !IMPLEMENTED_OCR_PROVIDERS.has(config.provider)) return undefined;
  const apiKey = await revealAiProviderApiKey(db, encryption, config);
  const fallback = await resolveFallbackOcrAdapter(db, encryption, config);
  return {
    ai: buildOcrAdapterForConfig(config, apiKey),
    limits: limitsFromConfig(config),
    ...(fallback ? { fallback } : {}),
  };
}

/**
 * Cheap "is OCR available at all" check for display gates (e.g. the
 * applicant document page deciding whether to show a "Run OCR" trigger) --
 * no KMS decrypt, unlike `resolveOcrAdapter` itself, since a page only needs
 * to know whether to SHOW the option, not to actually build a working
 * adapter. Shares `resolveOcrAdapter`'s identical fail-closed provider
 * check so the two can never disagree about whether OCR is genuinely
 * available.
 */
export async function isOcrConfigured(db: Db): Promise<boolean> {
  if (!(await hasAnyAiProviderConfig(db))) return false;
  const config = await getActiveAiProviderConfig(db);
  return Boolean(config && IMPLEMENTED_OCR_PROVIDERS.has(config.provider));
}

/** Cheap "is AI classification available" check for page rendering (Part 8 AI-01 item 2) -- mirrors `isOcrConfigured`'s identical shape, never decrypting a key just to show a boolean. */
export async function isClassificationConfigured(db: Db): Promise<boolean> {
  if (!(await hasAnyAiProviderConfig(db))) return false;
  const config = await getActiveAiProviderConfig(db);
  return Boolean(config && IMPLEMENTED_PROVIDERS.has(config.provider));
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
