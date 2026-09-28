import { createHash } from 'node:crypto';
import type { FactStatus, ProposalType } from '@visastack/core';
import { type Result, err, isOk, ok } from '@visastack/core';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import type { AiOcrCacheKeyComponents, AiOcrContentType, AiOcrOutcome, AiOcrPort } from './ocr';
import type { KeyManagementPort } from './ports';
import { recordProductEvent } from './product-events';
import { type EditFactResult, editFact, getCurrentFactVersion } from './profile';

/**
 * AI Gateway (Build Spec §8; master directive §8/§26 item 4): extraction
 * produces field PROPOSALS - never silent writes. Extraction requires
 * AI_EXTRACTION consent and respects a durable, platform-wide cost budget
 * (the sum of every recorded `ai_extraction_runs` row - not an in-memory
 * counter that resets every request). A proposal only enters the Master
 * Profile through an explicit, atomic approval that reuses the manual-edit
 * machinery (immutable version, full provenance, unknown fields rejected).
 * The concrete model provider (OpenAI Responses API, `gpt-5.6-terra`) sits
 * behind `AiExtractionPort`.
 *
 * `runOcr` (Part 8 §9) lives in this same file, not `ocr.ts`, so it can
 * share the budget/concurrency accounting helpers below directly: OCR and
 * extraction bill through the same admin-configured provider relationship
 * and the same platform-wide ledger, so their enforcement logic stays
 * co-located rather than split across a public export boundary. `ocr.ts`
 * itself stays scoped to the `AiOcrPort` contract and the bytes-preparation
 * step (`renderOcrSourceImage`), the parts that are genuinely OCR-only.
 */

export interface FieldProposal {
  readonly type: ProposalType;
  /** Canonical field key the model mapped to (absent for UNMAPPED). */
  readonly fieldKey?: string;
  readonly value?: string;
  /** 0..1 model confidence; persisted as 0-100 to match the rest of the schema. */
  readonly confidence: number;
  readonly rationale?: string;
  /** The exact source-text excerpt the model cites as support for this value. */
  readonly evidenceSnippet?: string;
}

export interface AiUsage {
  /** Total billed units -- unchanged meaning, still what budget enforcement sums. */
  readonly costUnits: number;
  /** Part 8 §11 ("track separately: input units; output; cached"). */
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly cachedUnits: number;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  /** Which adapter actually served this call -- Part 8 §4's "Result" list. */
  readonly provider: string;
  /** The provider's own request/response id, where the API exposes one. */
  readonly providerRequestId?: string;
  /** Wall-clock time for the provider round trip, in milliseconds. */
  readonly latencyMs: number;
}

export interface AiExtractionResult {
  readonly proposals: readonly FieldProposal[];
  readonly usage: AiUsage;
}

export interface AiExtractionInput {
  readonly documentVersionId: string;
  /** Deterministic text already extracted from the document (Build Spec §6). */
  readonly text: string;
  /** Canonical field keys the model may map to; it cannot invent others. */
  readonly allowedFieldKeys: readonly string[];
}

/**
 * Part 8 §4 ("explicitly handle: refusal; truncation; missing usage; schema
 * failure; unsupported parameter; auth failure; rate limit; timeout").
 * `timeout`/`auth_failed`/`refused`/`truncated` are each their own code
 * (never folded into the generic `upstream_error`) specifically so a caller
 * -- or a future admin-facing failure dashboard -- can tell "the network
 * hung" apart from "the provider rejected the key" apart from "the model
 * declined to answer" apart from "the model ran out of output budget
 * mid-response," each of which needs a different operator response.
 */
export type AiExtractionErrorCode =
  | 'upstream_error'
  | 'invalid_response'
  | 'rate_limited'
  | 'timeout'
  | 'auth_failed'
  | 'refused'
  | 'truncated'
  /**
   * Part 8 §5 ("kill switch: rechecked immediately before outbound call").
   * `runExtraction`'s own doing, never returned by an adapter -- synthesized
   * when `killSwitchCheck` refuses right before the call would otherwise
   * have been made, so the adapter is never actually invoked.
   */
  | 'disabled';

export type AiExtractionOutcome =
  | { readonly ok: true; readonly result: AiExtractionResult }
  | {
      readonly ok: false;
      readonly code: AiExtractionErrorCode;
      readonly message: string;
      readonly provider?: string;
      readonly latencyMs?: number;
    };

export interface AiCacheKeyComponents {
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly reasoningEffort?: string;
}

export interface AiExtractionPort {
  extract(input: AiExtractionInput): Promise<AiExtractionOutcome>;
  /**
   * The configuration components of the cache key (master directive §7
   * "PR 9": "content hash + task version + parser version + prompt version +
   * schema version + model + reasoning configuration"), exposed so the
   * caller can compute a full cache key and check for a reusable prior run
   * BEFORE paying for a call — `extract`'s own return only reveals this
   * after the fact.
   */
  cacheKeyComponents(): AiCacheKeyComponents;
}

function toPersistedConfidence(confidence: number): number {
  return Math.max(0, Math.min(100, Math.round(confidence * 100)));
}

/**
 * The durable, platform-wide AI spend so far -- the cost ledger IS this sum.
 * Sums `ai_extraction_runs` AND `ocr_runs` together (Part 8 Chunk 18's own
 * user-confirmed decision): both bill through the same admin-configured
 * provider/API key in reality -- one bill, one budget -- so "platform-wide
 * spend" means every AI Gateway task combined, not text extraction alone.
 * The admin dashboard's own spend meter (`apps/web/src/app/app/admin/
 * page.tsx`) calls this function directly, so it picks up true combined
 * spend automatically once OCR calls exist, with no separate change needed
 * there.
 */
export async function totalAiCostUnits(db: Db): Promise<number> {
  const [extraction, ocr] = await Promise.all([
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.aiExtractionRuns.costUnits}), 0)` })
        .from(schema.aiExtractionRuns),
    ),
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.ocrRuns.costUnits}), 0)` })
        .from(schema.ocrRuns),
    ),
  ]);
  return Number(extraction?.total ?? 0) + Number(ocr?.total ?? 0);
}

/**
 * The durable AI spend so far for one specific document (per-document cap),
 * combined across `ai_extraction_runs` and `ocr_runs` for the identical
 * reason `totalAiCostUnits` is -- a per-document cap exists to bound how
 * much any single document can cost, a concern that applies the same way
 * regardless of which AI Gateway task the spend came from.
 */
export async function documentAiCostUnits(db: Db, documentVersionId: string): Promise<number> {
  const [extraction, ocr] = await Promise.all([
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.aiExtractionRuns.costUnits}), 0)` })
        .from(schema.aiExtractionRuns)
        .where(eq(schema.aiExtractionRuns.documentVersionId, documentVersionId)),
    ),
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.ocrRuns.costUnits}), 0)` })
        .from(schema.ocrRuns)
        .where(eq(schema.ocrRuns.documentVersionId, documentVersionId)),
    ),
  ]);
  return Number(extraction?.total ?? 0) + Number(ocr?.total ?? 0);
}

/**
 * How many times AI extraction has genuinely been invoked (paid or failed)
 * for one document — a cache hit is excluded (finding #28, post-programme
 * defect register). A cache hit still inserts its own `aiExtractionRuns` row
 * (`servedFromCacheRunId` set, `costUnits: 0`) so its cost is correctly
 * free, but before this fix that row was ALSO counted here, which ran
 * before the cache lookup ever had a chance to short-circuit the request —
 * with the default limit of 3, one paid call followed by 2 cache hits
 * permanently blocked a 4th, still-cache-hit-eligible identical request,
 * even though it would have cost nothing and done no new AI work. Excluding
 * `servedFromCacheRunId`-set rows makes repeat cache hits free in both
 * senses — cost and attempt budget — leaving the limit to gate only
 * genuinely new (uncached) invocations, which is what it exists to bound.
 *
 * Deliberately `ai_extraction_runs`-only, unlike the cost/concurrency
 * helpers below -- an attempt limit bounds retries of a SPECIFIC task on a
 * document, not overall spend. Sharing this counter with `ocr_runs` would
 * wrongly block a document's first-ever OCR attempt just because text
 * extraction had already exhausted its own attempt budget on that same
 * document, two genuinely different actions a caller invokes separately.
 */
export async function countAiExtractionAttempts(
  db: Db,
  documentVersionId: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.aiExtractionRuns.id })
    .from(schema.aiExtractionRuns)
    .where(
      and(
        eq(schema.aiExtractionRuns.documentVersionId, documentVersionId),
        isNull(schema.aiExtractionRuns.servedFromCacheRunId),
      ),
    );
  return rows.length;
}

/**
 * How many times OCR has genuinely been invoked (paid or failed) for one
 * document -- the OCR-specific mirror of `countAiExtractionAttempts` right
 * above, with the identical cache-hit exclusion and the identical reason it
 * is its own, separate counter rather than a shared one: an attempt limit
 * bounds retries of a SPECIFIC task on a document, not overall spend, and
 * OCR and text extraction are genuinely different actions a caller invokes
 * separately -- the same reasoning `countAiExtractionAttempts`'s own doc
 * comment gives for why it, in turn, is not folded into `ocr_runs`.
 */
export async function countOcrAttempts(db: Db, documentVersionId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.ocrRuns.id })
    .from(schema.ocrRuns)
    .where(
      and(
        eq(schema.ocrRuns.documentVersionId, documentVersionId),
        isNull(schema.ocrRuns.servedFromCacheRunId),
      ),
    );
  return rows.length;
}

/**
 * Self-healing for `IN_FLIGHT` reservations (Part 8 §11's concurrency gate):
 * a row is inserted BEFORE the outbound provider call and only updated to
 * SUCCEEDED/FAILED after it returns (see `runExtraction`), so a process that
 * crashes or loses its connection in between leaves a row that would
 * otherwise occupy a concurrency slot -- and inflate the budget reservation
 * below -- forever. Anything older than this is treated as abandoned and
 * released to FAILED. Comfortably longer than the adapter's own request
 * timeout (60s default, `DEFAULT_TIMEOUT_MS` in openai-extraction.ts) so a
 * call that is genuinely still in flight is never prematurely released out
 * from under itself.
 *
 * Releases stale rows in BOTH `ai_extraction_runs` and `ocr_runs` -- an
 * abandoned OCR reservation would otherwise occupy a platform-wide
 * concurrency slot exactly as permanently as a stale text-extraction one.
 */
const IN_FLIGHT_STALE_MS = 5 * 60 * 1000;

async function releaseStaleInFlightCalls(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - IN_FLIGHT_STALE_MS);
  await Promise.all([
    db
      .update(schema.aiExtractionRuns)
      .set({ status: 'FAILED', errorCode: 'in_flight_expired' })
      .where(
        and(
          eq(schema.aiExtractionRuns.status, 'IN_FLIGHT'),
          lt(schema.aiExtractionRuns.createdAt, cutoff),
        ),
      ),
    db
      .update(schema.ocrRuns)
      .set({ status: 'FAILED', errorCode: 'in_flight_expired' })
      .where(and(eq(schema.ocrRuns.status, 'IN_FLIGHT'), lt(schema.ocrRuns.createdAt, cutoff))),
  ]);
}

/**
 * How many calls are genuinely in progress right now, platform-wide -- the
 * concurrency gate IS this count. Counts BOTH `ai_extraction_runs` and
 * `ocr_runs` (Part 8 Chunk 18's shared-cap decision): a provider-side
 * concurrent-request limit is a property of the account making the calls,
 * not of which AI Gateway task each call happens to be for.
 */
async function countInFlightCalls(db: Db): Promise<number> {
  const [extractionRows, ocrRows] = await Promise.all([
    db
      .select({ id: schema.aiExtractionRuns.id })
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.status, 'IN_FLIGHT')),
    db
      .select({ id: schema.ocrRuns.id })
      .from(schema.ocrRuns)
      .where(eq(schema.ocrRuns.status, 'IN_FLIGHT')),
  ]);
  return extractionRows.length + ocrRows.length;
}

/** Same as `countInFlightCalls`, scoped to one document -- the per-document budget check's own concurrency exposure. */
async function countInFlightCallsForDocument(db: Db, documentVersionId: string): Promise<number> {
  const [extractionRows, ocrRows] = await Promise.all([
    db
      .select({ id: schema.aiExtractionRuns.id })
      .from(schema.aiExtractionRuns)
      .where(
        and(
          eq(schema.aiExtractionRuns.status, 'IN_FLIGHT'),
          eq(schema.aiExtractionRuns.documentVersionId, documentVersionId),
        ),
      ),
    db
      .select({ id: schema.ocrRuns.id })
      .from(schema.ocrRuns)
      .where(
        and(
          eq(schema.ocrRuns.status, 'IN_FLIGHT'),
          eq(schema.ocrRuns.documentVersionId, documentVersionId),
        ),
      ),
  ]);
  return extractionRows.length + ocrRows.length;
}

/**
 * The highest `costUnits` any SUCCEEDED run has ever actually recorded,
 * platform-wide -- real evidence, never an invented pricing formula, used as
 * a conservative stand-in for "what an in-flight call might cost" (Part 8
 * §11: "reserve conservative worst-case cost ... concurrent calls may not
 * race available budget"). Starts at 0 before any call has ever completed
 * and only ever ratchets upward from genuine recorded spend -- deliberately
 * coarser than a true per-call estimate, which would need real per-model
 * pricing/token-count data this codebase does not have yet (a separate,
 * larger gap; see the doc comment on `runExtraction`).
 *
 * Takes the max across BOTH `ai_extraction_runs` and `ocr_runs` -- OCR and
 * text-extraction calls can genuinely cost different amounts (image tokens
 * vs. text tokens), and using the higher of the two observed maximums is
 * still a safe, conservative reservation for either kind of in-flight call,
 * never an under-estimate.
 */
async function maxObservedCostUnits(db: Db): Promise<number> {
  const [extraction, ocr] = await Promise.all([
    first(
      await db
        .select({ max: sql<string>`coalesce(max(${schema.aiExtractionRuns.costUnits}), 0)` })
        .from(schema.aiExtractionRuns)
        .where(eq(schema.aiExtractionRuns.status, 'SUCCEEDED')),
    ),
    first(
      await db
        .select({ max: sql<string>`coalesce(max(${schema.ocrRuns.costUnits}), 0)` })
        .from(schema.ocrRuns)
        .where(eq(schema.ocrRuns.status, 'SUCCEEDED')),
    ),
  ]);
  return Math.max(Number(extraction?.max ?? 0), Number(ocr?.max ?? 0));
}

/** The deterministic parser version that produced this document's text (a cache-key component). */
async function latestParserVersion(db: Db, documentVersionId: string): Promise<string | null> {
  const row = first(
    await db
      .select({ parserVersion: schema.extractionRuns.parserVersion })
      .from(schema.extractionRuns)
      .where(
        and(
          eq(schema.extractionRuns.documentVersionId, documentVersionId),
          eq(schema.extractionRuns.status, 'SUCCEEDED'),
        ),
      )
      .orderBy(desc(schema.extractionRuns.createdAt))
      .limit(1),
  );
  return row?.parserVersion ?? null;
}

/**
 * Deterministic cache key (master directive §7 "PR 9"): content hash + task
 * version + parser version + prompt version + schema version + model +
 * reasoning configuration. Identical inputs under an identical configuration
 * always produce the same key, so a later request can find and reuse a
 * SUCCEEDED run instead of paying for the model call again -- this is also
 * the duplicate-prevention mechanism the directive asks for separately:
 * re-running extraction on the very same document version under the same
 * config is, by definition, the same cache key. "Reuse" is bounded by
 * recency, not just by key match: `runExtraction`'s own cache lookup also
 * requires the matching run to be within `cacheMaxAgeDays` (PRV-02, Part 7
 * §11's "AI cache: <=30d later"), so an old match still triggers a fresh,
 * billed extraction rather than being served forever.
 */
const TASK_VERSION = 'field_extraction_v1';

function computeCacheKey(
  contentHash: string,
  parserVersion: string,
  cacheKeyComponents: AiCacheKeyComponents,
): string {
  const parts = [
    contentHash,
    TASK_VERSION,
    parserVersion,
    cacheKeyComponents.model,
    cacheKeyComponents.promptVersion,
    cacheKeyComponents.schemaVersion,
    cacheKeyComponents.reasoningEffort ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * OCR's own cache key -- `ocr_runs.cache_key`'s own doc comment:
 * `sha256(contentHash|model|promptVersion)`, deliberately simpler than
 * `computeCacheKey` above since OCR has no parser/schema-version or
 * reasoning-effort dial to fold in. `contentHash` here is a hash of the
 * actual rendered image bytes about to be sent (computed by `runOcr`
 * itself), mirroring `runExtraction`'s own "hash of the exact content about
 * to be sent" choice -- not `document_versions.sha256`, which is a
 * caller-optional column that can be null.
 */
function computeOcrCacheKey(
  contentHash: string,
  cacheKeyComponents: AiOcrCacheKeyComponents,
): string {
  const parts = [contentHash, cacheKeyComponents.model, cacheKeyComponents.promptVersion];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface EvidenceLocationResult {
  readonly charStart: number;
  readonly charEnd: number;
}

/**
 * AI-04 (evidence grounding): the system prompt instructs the model to
 * ground every value in "an exact, verbatim substring copied from the
 * document text," but nothing before this checked that -- a hallucinated or
 * paraphrased citation would sail through with no server-side signal
 * distinguishing it from a genuine one. An exact substring search is the
 * deliberately simple, zero-false-positive check: if this returns a
 * position, the snippet provably, byte-for-byte appears in the source text
 * the model was given. Deliberately does NOT fall back to a
 * whitespace-normalized or fuzzy match -- an unverified snippet is not
 * dropped anywhere downstream (still persisted, still reviewable), so a
 * false negative here (a genuine quote that differs only in whitespace/OCR
 * artifacts) costs nothing but an extra moment of human scrutiny, while a
 * false positive from a looser match could wrongly badge a fabricated
 * citation as confirmed -- the wrong failure direction for a trust signal.
 */
function locateEvidenceSnippet(sourceText: string, snippet: string): EvidenceLocationResult | null {
  if (!snippet) return null;
  const charStart = sourceText.indexOf(snippet);
  if (charStart === -1) return null;
  return { charStart, charEnd: charStart + snippet.length };
}

async function latestPageCount(db: Db, documentVersionId: string): Promise<number | null> {
  const row = first(
    await db
      .select({ pageCount: schema.extractionRuns.pageCount })
      .from(schema.extractionRuns)
      .where(
        and(
          eq(schema.extractionRuns.documentVersionId, documentVersionId),
          eq(schema.extractionRuns.status, 'SUCCEEDED'),
        ),
      )
      .orderBy(desc(schema.extractionRuns.createdAt))
      .limit(1),
  );
  return row?.pageCount ?? null;
}

export interface RunExtractionInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly documentVersionId: string;
  readonly text: string;
  /** Platform-wide pilot budget cap (master directive §8/§21 — cost controls; env: AI_PILOT_MONTHLY_HARD_LIMIT_USD). */
  readonly budgetLimitUnits: number;
  /** Per-document spend cap, in the same cost units (env: AI_PER_DOCUMENT_LIMIT_USD). Unset = no cap. */
  readonly perDocumentBudgetLimitUnits?: number;
  /** Max AI invocations per document, regardless of cost (env: AI_MAX_ATTEMPTS). Unset = no cap. */
  readonly maxAttemptsPerDocument?: number;
  /** Refuse documents whose deterministic extraction reported more pages than this (env: AI_MAX_PAGES_PER_DOCUMENT). Unset = no cap. */
  readonly maxPagesPerDocument?: number;
  /**
   * Part 8 §11's own named default ("5 concurrent model calls
   * platform-wide"; env: AI_MAX_CONCURRENT_CALLS): the most calls this
   * function will ever let sit `IN_FLIGHT` (reserved but not yet resolved)
   * at once, platform-wide, regardless of budget headroom. Unset = no cap,
   * matching every other optional limit here.
   */
  readonly maxConcurrentCalls?: number;
  /**
   * PRV-02 (master directive Part 7 §11): "AI cache: <=30d later." A cache
   * hit older than this is never served -- treated as a miss, so a fresh
   * (correctly billed) extraction runs instead. Unlike the caps above,
   * unset does NOT mean "no limit": it falls back to the 30-day default
   * (`DEFAULT_CACHE_MAX_AGE_DAYS`), since the whole point is bounding how
   * long extracted proposal data stays reachable, not an opt-in ceiling.
   */
  readonly cacheMaxAgeDays?: number;
  /**
   * Part 8 §5 ("kill switch: rechecked immediately before outbound call,
   * including queued jobs"). Called once, right before the adapter is ever
   * invoked (phase 2, after every phase-1 check has already passed and a
   * slot has been reserved) -- resolving `false` skips the call entirely
   * and records the run FAILED with `errorCode: 'disabled'`, exactly as if
   * the call itself had refused, without ever reaching the adapter. Unset
   * means no kill switch is wired up (dispatch is always allowed), matching
   * every other optional check here.
   */
  readonly killSwitchCheck?: () => Promise<boolean>;
}

const DEFAULT_CACHE_MAX_AGE_DAYS = 30;

export type FieldProposalRow = typeof schema.fieldProposals.$inferSelect;

export interface RunExtractionSummary {
  readonly aiExtractionRunId: string;
  readonly proposals: readonly FieldProposalRow[];
}

/**
 * Run AI extraction over a document, persisting the proposals it returns
 * WITHOUT mutating the profile. Consent-gated (AI_EXTRACTION) and
 * budget-guarded against the durable ledger; every invocation -- success or
 * failure -- is recorded and audited.
 *
 * Three phases (Part 8 §11: "before dispatch atomically reserve
 * conservative worst-case cost ... concurrent calls may not race available
 * budget ... reconcile actual usage later"):
 *
 * 1. RESERVE -- a short, locked transaction runs every check (budget,
 *    per-document budget, page cap, cache lookup, attempt cap, concurrency
 *    cap) and, on a genuine cache MISS that clears them all, inserts an
 *    IN_FLIGHT marker row instead of calling the adapter. A cache HIT (or
 *    any refusal) resolves entirely inside this phase and never proceeds
 *    further.
 * 2. CALL -- the outbound `ai.extract()` call runs with NO transaction and
 *    NO lock held, so it can never block anything else, and multiple calls
 *    can genuinely run at once (up to `maxConcurrentCalls`).
 * 3. RECONCILE -- a fresh, unlocked transaction updates that same marker
 *    row to SUCCEEDED or FAILED with the real outcome, then does the
 *    existing proposal/evidence/audit/product-event work. No lock is needed
 *    here: the row is addressed by its own id, so no other call can ever
 *    contend for it.
 *
 * Before this fix, both advisory locks below were held for the ENTIRE
 * transaction, INCLUDING the outbound provider call -- serializing every AI
 * call platform-wide to concurrency 1 instead of the directive's named
 * default of 5, and holding a database connection open for the whole
 * network round trip. Shrinking the locked section to just phase 1 (a
 * database-only check-and-reserve step, normally milliseconds) fixes that
 * while preserving every guarantee the locks existed for -- see below.
 *
 * Processing idempotency (master directive §7 "PR 6"): phase 1 runs inside
 * a Postgres advisory lock keyed on `documentVersionId`. Without it, two
 * near-simultaneous requests for the same document (a double-click, a
 * network retry) could both read the same attempts/budget counts, both
 * pass, and both reserve a slot -- exceeding `maxAttemptsPerDocument`/the
 * budget caps by more than the intended one-at-a-time margin. The lock
 * serializes the CHECK-AND-RESERVE step: the second caller's checks only
 * run after the first has fully committed its own reservation, so it sees
 * the true, up-to-date counts (including that reservation). This does not
 * limit *deliberate* bounded retries (up to `maxAttemptsPerDocument`), and
 * it no longer limits genuine concurrent DIFFERENT-document dispatch at
 * all, since the lock is released the instant phase 1 commits.
 *
 * That per-document lock is deliberately scoped to `documentVersionId` (its
 * own docstring said so), so it does nothing for the PLATFORM-wide budget
 * or concurrency checks specifically: two concurrent requests for two
 * DIFFERENT documents never contend for the same per-document key. A
 * second, fixed (not document-derived) advisory lock closes this: every
 * call also takes `pg_advisory_xact_lock(hashtext('visastack:ai-platform-
 * budget'))` before reading the platform totals, serializing every phase-1
 * reservation platform-wide against every other one's eventual commit, not
 * merely against each other's check (finding #20, post-programme defect
 * register). Mirrors `uploads.ts`'s `reserveUpload`, the same
 * fixed-key-lock-for-the-critical-section pattern already proven there for
 * an identical platform-wide-hard-cap-under-concurrency guarantee.
 *
 * "Concurrent calls may not race available budget" (Part 8 §11) is enforced
 * without inventing a per-model pricing formula -- real per-model pricing
 * data does not exist in this codebase yet (a separate, larger gap). Instead
 * each budget check treats every currently-IN_FLIGHT call, plus the one
 * about to be reserved, as though it will cost `maxObservedCostUnits`: the
 * highest `costUnits` any SUCCEEDED run has ever actually recorded,
 * platform-wide. That is real evidence, never a guess -- it starts at 0
 * before any call has ever completed and only ever ratchets up from genuine
 * recorded spend, matching the directive's own "conservative worst-case"
 * framing. It is deliberately coarser than a true per-call estimate (which
 * would need real pricing/token-count data), but it closes the actual race:
 * N concurrent calls can no longer all pass the same check believing they
 * are the only spender, using only data already on the ledger. NOT yet
 * handled (a separate, distinct gap, tracked separately in
 * docs/commercial-v1/known-issues.md): "uncertain timeout outcome: keep
 * reservation until reconciled" -- today, exactly as before this fix, a
 * timed-out call is costed at 0 the instant it resolves, since there is no
 * mechanism yet to later confirm whether the provider actually processed
 * and will bill for it.
 *
 * Concurrency itself is capped the same way, using the same lock: phase 1
 * counts IN_FLIGHT rows platform-wide and refuses to reserve a new one once
 * `maxConcurrentCalls` is reached. `releaseStaleInFlightCalls` self-heals a
 * row whose own call crashed or lost its connection between reserving and
 * reconciling, so an abandoned reservation cannot occupy a slot (or inflate
 * the budget reservation above) forever.
 *
 * The optional `killSwitchCheck` (Part 8 §5) is deliberately re-consulted at
 * the START of phase 2, not folded into phase 1's checks: a reservation made
 * in phase 1 could otherwise sit for a while (queued behind
 * `maxConcurrentCalls`, in a future world where phase 2 is itself queued)
 * before phase 2 actually runs, and the directive's own wording is explicit
 * that the switch must be rechecked "immediately before outbound call,
 * including queued jobs" -- checking only once, back in phase 1, would miss
 * exactly the case the directive is naming.
 *
 * None of the three guarantees above (per-document serialization,
 * platform-wide budget/concurrency serialization, or the reservation math
 * itself) is exercised by a `Promise.all` race test the way other
 * concurrency fixes in this codebase are: PGlite (the test driver) fully
 * serializes `db.transaction()` calls -- a second one's callback never
 * starts until the first has committed -- so two overlapping phase-1
 * transactions can never actually interleave in-process, whether or not
 * either lock exists. All three instead rest on Postgres's own documented
 * `pg_advisory_xact_lock` semantics (held until the current transaction
 * ends; a concurrent session requesting the same key blocks until then),
 * which is standard, well-established behavior, not something this
 * codebase is inventing. See `ai.test.ts`'s note above the (deliberately
 * absent) race test for how this was confirmed rather than assumed.
 */
type ExtractionReservation =
  | { readonly kind: 'final'; readonly outcome: Result<RunExtractionSummary, ServiceError> }
  | {
      readonly kind: 'proceed';
      readonly runId: string;
      readonly allowedFieldKeys: readonly string[];
      readonly cacheKey: string;
    };

export async function runExtraction(
  db: Db,
  ai: AiExtractionPort,
  input: RunExtractionInput,
): Promise<Result<RunExtractionSummary, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to run extraction for this applicant'));
  }
  if (!(await hasConsent(db, applicant.ownerAccountId, 'AI_EXTRACTION'))) {
    return err(serviceError('consent_required', 'AI_EXTRACTION consent is required'));
  }

  const reservation = await db.transaction(async (tx): Promise<ExtractionReservation> => {
    // Fixed key, acquired first (and held for this whole phase-1
    // transaction, same as the per-document lock below): serializes the
    // platform-wide budget/concurrency check-and-reserve step against every
    // OTHER concurrent call's own phase 1 too, not only same-document ones
    // (finding #20, post-programme defect register).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('visastack:ai-platform-budget'))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.documentVersionId}))`);

    // Self-heal before reading any counts, so an abandoned reservation from
    // a crashed prior call never wrongly occupies a concurrency slot or
    // inflates the budget reservation below.
    await releaseStaleInFlightCalls(tx);

    // Real evidence, never invented -- see maxObservedCostUnits's own doc
    // comment and the docstring above for why this stands in for a true
    // per-call cost estimate.
    const worstCase = await maxObservedCostUnits(tx);
    const inFlightPlatform = await countInFlightCalls(tx);

    const used = (await totalAiCostUnits(tx)) + (inFlightPlatform + 1) * worstCase;
    if (used >= input.budgetLimitUnits) {
      return { kind: 'final', outcome: err(serviceError('invalid', 'AI budget exhausted')) };
    }
    if (input.perDocumentBudgetLimitUnits !== undefined) {
      const inFlightDocument = await countInFlightCallsForDocument(tx, input.documentVersionId);
      const documentUsed =
        (await documentAiCostUnits(tx, input.documentVersionId)) +
        (inFlightDocument + 1) * worstCase;
      if (documentUsed >= input.perDocumentBudgetLimitUnits) {
        return {
          kind: 'final',
          outcome: err(serviceError('invalid', 'AI budget exhausted for this document')),
        };
      }
    }
    if (input.maxPagesPerDocument !== undefined) {
      const pageCount = await latestPageCount(tx, input.documentVersionId);
      if (pageCount !== null && pageCount > input.maxPagesPerDocument) {
        return {
          kind: 'final',
          outcome: err(
            serviceError('invalid', 'document exceeds the configured page limit for AI extraction'),
          ),
        };
      }
    }

    const allowedFieldKeys = (
      await tx.select({ key: schema.fieldDefinitions.key }).from(schema.fieldDefinitions)
    ).map((r) => r.key);

    const contentHash = createHash('sha256').update(input.text).digest('hex');
    const parserVersion = (await latestParserVersion(tx, input.documentVersionId)) ?? 'unknown';
    const cacheKey = computeCacheKey(contentHash, parserVersion, ai.cacheKeyComponents());

    const cacheMaxAgeDays = input.cacheMaxAgeDays ?? DEFAULT_CACHE_MAX_AGE_DAYS;
    const cacheCutoff = new Date(Date.now() - cacheMaxAgeDays * 24 * 60 * 60 * 1000);
    const cached = first(
      await tx
        .select()
        .from(schema.aiExtractionRuns)
        .where(
          and(
            eq(schema.aiExtractionRuns.cacheKey, cacheKey),
            eq(schema.aiExtractionRuns.status, 'SUCCEEDED'),
            // PRV-02 (Part 7 §11): "AI cache: <=30d later" -- a hit older
            // than this is never served, so the next block below falls
            // through to a genuine (correctly billed) extraction instead.
            gte(schema.aiExtractionRuns.createdAt, cacheCutoff),
          ),
        )
        .orderBy(desc(schema.aiExtractionRuns.createdAt))
        .limit(1),
    );

    if (cached) {
      const run = required(
        first(
          await tx
            .insert(schema.aiExtractionRuns)
            .values({
              documentVersionId: input.documentVersionId,
              applicantId: input.applicantId,
              status: 'SUCCEEDED',
              modelVersion: cached.modelVersion,
              promptVersion: cached.promptVersion,
              schemaVersion: cached.schemaVersion,
              costUnits: 0,
              // Descriptive only (which provider originally produced this
              // data) -- providerRequestId/latencyMs/the unit breakdown stay
              // null: a cache hit makes no new provider call to report on.
              provider: cached.provider,
              cacheKey,
              servedFromCacheRunId: cached.id,
            })
            .returning(),
        ),
        'ai extraction run',
      );
      const sourceProposals = await tx
        .select()
        .from(schema.fieldProposals)
        .where(eq(schema.fieldProposals.aiExtractionRunId, cached.id));
      const savedProposals: FieldProposalRow[] = [];
      for (const source of sourceProposals) {
        const saved = required(
          first(
            await tx
              .insert(schema.fieldProposals)
              .values({
                aiExtractionRunId: run.id,
                documentVersionId: input.documentVersionId,
                applicantId: input.applicantId,
                type: source.type,
                fieldKey: source.fieldKey,
                value: source.value,
                confidence: source.confidence,
                rationale: source.rationale,
              })
              .returning(),
          ),
          'field proposal',
        );
        const sourceEvidence = await tx
          .select()
          .from(schema.evidenceLocations)
          .where(eq(schema.evidenceLocations.fieldProposalId, source.id));
        for (const evidence of sourceEvidence) {
          await tx.insert(schema.evidenceLocations).values({
            fieldProposalId: saved.id,
            snippet: evidence.snippet,
            charStart: evidence.charStart,
            charEnd: evidence.charEnd,
            verified: evidence.verified,
          });
        }
        savedProposals.push(saved);
      }
      await appendAuditEvent(tx, {
        eventType: 'AI_EXTRACTION_CACHE_HIT',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { aiExtractionRunId: run.id, servedFromCacheRunId: cached.id, cacheKey },
      });
      return {
        kind: 'final',
        outcome: ok({ aiExtractionRunId: run.id, proposals: savedProposals }),
      };
    }

    // Only reached on a genuine cache MISS -- from here on, proceeding
    // actually costs a real invocation. The attempt-limit gate belongs HERE,
    // not earlier alongside the budget checks (finding #28, post-programme
    // defect register): `countAiExtractionAttempts` already excludes cache
    // rows from its count, but that alone isn't sufficient once the count
    // reaches the limit exactly -- a gate evaluated before the cache lookup
    // would still refuse a cache-hit-eligible request purely because it
    // hadn't yet been given the chance to discover it would cost nothing.
    // Moving the gate here means it is only ever consulted for a request
    // that is actually about to consume a genuine attempt, matching "only
    // genuine paid invocations count against it" exactly. The budget checks
    // above deliberately keep their original position, before the cache
    // lookup -- an exhausted budget is a hard stop regardless of whether
    // this specific request would have been free (see the platform-budget
    // test "a cache hit still fails closed once the platform-wide budget is
    // exhausted"); attempts and budget are different knobs with different
    // intended semantics. `maxPagesPerDocument` is deliberately left in its
    // original position too -- out of finding #28's scope, which names only
    // the attempt count.
    if (input.maxAttemptsPerDocument !== undefined) {
      const attempts = await countAiExtractionAttempts(tx, input.documentVersionId);
      if (attempts >= input.maxAttemptsPerDocument) {
        return {
          kind: 'final',
          outcome: err(
            serviceError('invalid', 'AI extraction attempt limit reached for this document'),
          ),
        };
      }
    }

    // Part 8 §11's named default ("5 concurrent model calls
    // platform-wide"): `inFlightPlatform` was already counted above, under
    // the same lock, so reusing it here is still exact -- nothing else
    // could have changed it since (the lock is still held, and everything
    // between there and here only reads).
    if (input.maxConcurrentCalls !== undefined && inFlightPlatform >= input.maxConcurrentCalls) {
      return {
        kind: 'final',
        outcome: err(
          serviceError(
            'rate_limited',
            'too many AI extraction calls in flight platform-wide; try again shortly',
          ),
        ),
      };
    }

    const run = required(
      first(
        await tx
          .insert(schema.aiExtractionRuns)
          .values({
            documentVersionId: input.documentVersionId,
            applicantId: input.applicantId,
            status: 'IN_FLIGHT',
            modelVersion: 'unknown',
            promptVersion: 'unknown',
          })
          .returning(),
      ),
      'ai extraction run',
    );

    return { kind: 'proceed', runId: run.id, allowedFieldKeys, cacheKey };
  });

  if (reservation.kind === 'final') return reservation.outcome;
  const { runId, allowedFieldKeys, cacheKey } = reservation;

  // Part 8 §5's kill switch, rechecked here -- immediately before the
  // outbound call, after every phase-1 check already passed and a slot was
  // already reserved -- rather than only once back in phase 1. A refusal
  // synthesizes a `disabled` outcome instead of calling the adapter at all,
  // so the same phase-3 FAILED-recording logic below handles it uniformly.
  const killSwitchAllows = input.killSwitchCheck ? await input.killSwitchCheck() : true;

  // Deliberately outside any transaction and holding no lock -- this is the
  // whole fix: the outbound network call no longer blocks any other AI
  // extraction call platform-wide.
  const outcome: AiExtractionOutcome = killSwitchAllows
    ? await ai.extract({
        documentVersionId: input.documentVersionId,
        text: input.text,
        allowedFieldKeys,
      })
    : { ok: false, code: 'disabled', message: 'AI extraction is currently disabled' };

  return db.transaction(async (tx) => {
    if (!outcome.ok) {
      await tx
        .update(schema.aiExtractionRuns)
        .set({
          status: 'FAILED',
          provider: outcome.provider ?? null,
          latencyMs: outcome.latencyMs ?? null,
          errorCode: outcome.code,
        })
        .where(eq(schema.aiExtractionRuns.id, runId));
      await appendAuditEvent(tx, {
        eventType: 'AI_EXTRACTION_FAILED',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { errorCode: outcome.code, aiExtractionRunId: runId },
      });
      // 'disabled' is a deliberate configuration state, not an upstream
      // failure -- the same distinction budget-exhausted/attempt-limit
      // refusals elsewhere in this function already make with 'invalid'.
      return err(
        serviceError(outcome.code === 'disabled' ? 'invalid' : 'upstream_error', outcome.message),
      );
    }

    const { proposals, usage } = outcome.result;

    await tx
      .update(schema.aiExtractionRuns)
      .set({
        status: 'SUCCEEDED',
        modelVersion: usage.modelVersion,
        promptVersion: usage.promptVersion,
        schemaVersion: usage.schemaVersion,
        costUnits: usage.costUnits,
        provider: usage.provider,
        providerRequestId: usage.providerRequestId ?? null,
        inputUnits: usage.inputUnits,
        outputUnits: usage.outputUnits,
        cachedUnits: usage.cachedUnits,
        latencyMs: usage.latencyMs,
        cacheKey,
      })
      .where(eq(schema.aiExtractionRuns.id, runId));

    const savedProposals: FieldProposalRow[] = [];
    for (const proposal of proposals) {
      const saved = required(
        first(
          await tx
            .insert(schema.fieldProposals)
            .values({
              aiExtractionRunId: runId,
              documentVersionId: input.documentVersionId,
              applicantId: input.applicantId,
              type: proposal.type,
              fieldKey: proposal.fieldKey ?? null,
              value: proposal.value ?? null,
              confidence: toPersistedConfidence(proposal.confidence),
              rationale: proposal.rationale ?? null,
            })
            .returning(),
        ),
        'field proposal',
      );
      if (proposal.evidenceSnippet) {
        const located = locateEvidenceSnippet(input.text, proposal.evidenceSnippet);
        await tx.insert(schema.evidenceLocations).values({
          fieldProposalId: saved.id,
          snippet: proposal.evidenceSnippet,
          charStart: located?.charStart ?? null,
          charEnd: located?.charEnd ?? null,
          verified: located !== null,
        });
      }
      savedProposals.push(saved);
    }

    await appendAuditEvent(tx, {
      eventType: 'AI_EXTRACTION_RUN',
      actorAccountId: input.actorAccountId,
      method: 'DOCUMENT',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'document_version',
      resourceId: input.documentVersionId,
      metadata: {
        aiExtractionRunId: runId,
        proposals: savedProposals.length,
        costUnits: usage.costUnits,
        modelVersion: usage.modelVersion,
        provider: usage.provider,
        latencyMs: usage.latencyMs,
      },
    });
    await recordProductEvent(tx, {
      eventType: 'AI_EXTRACTION_RUN',
      accountId: input.actorAccountId,
    });

    return ok({ aiExtractionRunId: runId, proposals: savedProposals });
  });
}

export interface RunOcrInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly documentVersionId: string;
  /** Already-rendered bytes (`renderOcrSourceImage`'s own output) -- mirrors `RunExtractionInput.text`, which is likewise caller-supplied, not computed inside this function. */
  readonly imageBytes: Uint8Array;
  readonly contentType: AiOcrContentType;
  /** Same shared, platform-wide budget `runExtraction` enforces (Part 8 Chunk 18/19) -- pass the identical resolved value both call sites use. */
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits?: number;
  /** OCR's own attempt counter (`countOcrAttempts`), never `countAiExtractionAttempts` -- see that function's doc comment. */
  readonly maxAttemptsPerDocument?: number;
  readonly maxConcurrentCalls?: number;
  readonly cacheMaxAgeDays?: number;
  readonly killSwitchCheck?: () => Promise<boolean>;
}

export type OcrRunRow = typeof schema.ocrRuns.$inferSelect;

export interface RunOcrSummary {
  readonly ocrRun: OcrRunRow;
}

type OcrReservation =
  | { readonly kind: 'final'; readonly outcome: Result<RunOcrSummary, ServiceError> }
  | { readonly kind: 'proceed'; readonly runId: string; readonly cacheKey: string };

/**
 * Run AI OCR over a document's already-rendered image bytes, persisting the
 * result directly onto its own `ocr_runs` row. Unlike `runExtraction`, there
 * is no field-proposal/evidence machinery here -- OCR's whole output IS the
 * row (extracted text plus review issues); a later, separate step would run
 * `runExtraction` over that text to get field proposals, reusing it
 * unchanged, not this function.
 *
 * Consent-gated on `AI_OCR`, deliberately distinct from `AI_EXTRACTION`
 * (raw image bytes are a materially larger disclosure than derived text).
 * Budget/concurrency-guarded against the SAME durable, shared ledger
 * `runExtraction` uses (Part 8 Chunk 18/19's own user-confirmed shared-cap
 * decision): every helper this function calls (`totalAiCostUnits`,
 * `countInFlightCalls`, `maxObservedCostUnits`, `releaseStaleInFlightCalls`,
 * ...) already reads across both `ai_extraction_runs` AND `ocr_runs`, so
 * there is no separate accounting path to keep in sync. Both advisory locks
 * below are the SAME fixed/derived keys `runExtraction` takes, so an OCR
 * call and an extraction call on the same document (or platform-wide)
 * genuinely serialize against each other's reservation step, not merely
 * against their own kind -- required for the shared budget to actually be
 * race-safe, not just summed correctly after the fact.
 *
 * Same three-phase reserve/call/reconcile structure as `runExtraction`, for
 * the identical reasons (see that function's own doc comment for the full
 * rationale, not repeated here): phase 1 is a short, locked transaction that
 * checks budget/concurrency/attempts and either serves a cache hit or
 * reserves an `IN_FLIGHT` row; phase 2 is the unlocked outbound call; phase 3
 * is a fresh, unlocked transaction that reconciles the result.
 *
 * Deliberately simpler than `runExtraction` in ways that are scope
 * decisions, not oversights:
 * - No `maxPagesPerDocument` cap -- `renderOcrSourceImage` already bounds
 *   every call to page 1 of the source document by construction (its own
 *   doc comment: "only page 1 of a multi-page scanned PDF"), so a
 *   page-count reservation check here would be checking a number that can
 *   only ever be 1.
 * - No `allowedFieldKeys` -- OCR produces raw text, not field proposals;
 *   there is no registry to constrain it against at this stage.
 */
export async function runOcr(
  db: Db,
  ai: AiOcrPort,
  input: RunOcrInput,
): Promise<Result<RunOcrSummary, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to run OCR for this applicant'));
  }
  if (!(await hasConsent(db, applicant.ownerAccountId, 'AI_OCR'))) {
    return err(serviceError('consent_required', 'AI_OCR consent is required'));
  }

  const reservation = await db.transaction(async (tx): Promise<OcrReservation> => {
    // Same fixed platform-wide key and same document-derived key
    // `runExtraction` locks -- see this function's own doc comment for why
    // that cross-function serialization is required, not incidental.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('visastack:ai-platform-budget'))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.documentVersionId}))`);

    await releaseStaleInFlightCalls(tx);

    const worstCase = await maxObservedCostUnits(tx);
    const inFlightPlatform = await countInFlightCalls(tx);

    const used = (await totalAiCostUnits(tx)) + (inFlightPlatform + 1) * worstCase;
    if (used >= input.budgetLimitUnits) {
      return { kind: 'final', outcome: err(serviceError('invalid', 'AI budget exhausted')) };
    }
    if (input.perDocumentBudgetLimitUnits !== undefined) {
      const inFlightDocument = await countInFlightCallsForDocument(tx, input.documentVersionId);
      const documentUsed =
        (await documentAiCostUnits(tx, input.documentVersionId)) +
        (inFlightDocument + 1) * worstCase;
      if (documentUsed >= input.perDocumentBudgetLimitUnits) {
        return {
          kind: 'final',
          outcome: err(serviceError('invalid', 'AI budget exhausted for this document')),
        };
      }
    }

    const contentHash = createHash('sha256').update(input.imageBytes).digest('hex');
    const cacheKey = computeOcrCacheKey(contentHash, ai.cacheKeyComponents());

    const cacheMaxAgeDays = input.cacheMaxAgeDays ?? DEFAULT_CACHE_MAX_AGE_DAYS;
    const cacheCutoff = new Date(Date.now() - cacheMaxAgeDays * 24 * 60 * 60 * 1000);
    const cached = first(
      await tx
        .select()
        .from(schema.ocrRuns)
        .where(
          and(
            eq(schema.ocrRuns.cacheKey, cacheKey),
            eq(schema.ocrRuns.status, 'SUCCEEDED'),
            // PRV-02 (Part 7 §11): "AI cache: <=30d later" -- same rule
            // `runExtraction` applies, an old match falls through to a
            // genuine (correctly billed) OCR call instead of being served.
            gte(schema.ocrRuns.createdAt, cacheCutoff),
          ),
        )
        .orderBy(desc(schema.ocrRuns.createdAt))
        .limit(1),
    );

    if (cached) {
      const run = required(
        first(
          await tx
            .insert(schema.ocrRuns)
            .values({
              documentVersionId: input.documentVersionId,
              applicantId: input.applicantId,
              status: 'SUCCEEDED',
              provider: cached.provider,
              modelVersion: cached.modelVersion,
              promptVersion: cached.promptVersion,
              extractedText: cached.extractedText,
              reviewIssues: cached.reviewIssues,
              costUnits: 0,
              cacheKey,
              servedFromCacheRunId: cached.id,
            })
            .returning(),
        ),
        'ocr run',
      );
      await appendAuditEvent(tx, {
        eventType: 'AI_OCR_CACHE_HIT',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { ocrRunId: run.id, servedFromCacheRunId: cached.id, cacheKey },
      });
      return { kind: 'final', outcome: ok({ ocrRun: run }) };
    }

    // Only reached on a genuine cache MISS -- same ordering rationale as
    // `runExtraction`'s own identically-placed attempt-limit check: a cache
    // hit costs nothing, so the attempt gate must not see this request until
    // it is known to actually need a genuine, billable invocation.
    if (input.maxAttemptsPerDocument !== undefined) {
      const attempts = await countOcrAttempts(tx, input.documentVersionId);
      if (attempts >= input.maxAttemptsPerDocument) {
        return {
          kind: 'final',
          outcome: err(serviceError('invalid', 'OCR attempt limit reached for this document')),
        };
      }
    }

    if (input.maxConcurrentCalls !== undefined && inFlightPlatform >= input.maxConcurrentCalls) {
      return {
        kind: 'final',
        outcome: err(
          serviceError(
            'rate_limited',
            'too many AI calls in flight platform-wide; try again shortly',
          ),
        ),
      };
    }

    const run = required(
      first(
        await tx
          .insert(schema.ocrRuns)
          .values({
            documentVersionId: input.documentVersionId,
            applicantId: input.applicantId,
            status: 'IN_FLIGHT',
            provider: 'unknown',
            modelVersion: 'unknown',
            promptVersion: 'unknown',
          })
          .returning(),
      ),
      'ocr run',
    );

    return { kind: 'proceed', runId: run.id, cacheKey };
  });

  if (reservation.kind === 'final') return reservation.outcome;
  const { runId, cacheKey } = reservation;

  // Part 8 §5's kill switch, rechecked here exactly as `runExtraction`
  // rechecks it -- immediately before the outbound call, after every phase-1
  // check already passed and a slot was already reserved.
  const killSwitchAllows = input.killSwitchCheck ? await input.killSwitchCheck() : true;

  const outcome: AiOcrOutcome = killSwitchAllows
    ? await ai.performOcr({
        documentVersionId: input.documentVersionId,
        imageBytes: input.imageBytes,
        contentType: input.contentType,
      })
    : { ok: false, code: 'disabled', message: 'AI OCR is currently disabled' };

  return db.transaction(async (tx) => {
    if (!outcome.ok) {
      await tx
        .update(schema.ocrRuns)
        .set({
          status: 'FAILED',
          // `provider`/`modelVersion`/`promptVersion` are NOT NULL on
          // `ocr_runs` (unlike `ai_extraction_runs`, where they are nullable
          // for historical pre-column rows -- `ocr_runs` has none, so it
          // never needed that escape hatch): a synthesized `disabled`
          // outcome carries no `provider` at all, so this falls back to the
          // same 'unknown' placeholder the IN_FLIGHT insert above already
          // used, never null.
          provider: outcome.provider ?? 'unknown',
          latencyMs: outcome.latencyMs ?? null,
          errorCode: outcome.code,
        })
        .where(eq(schema.ocrRuns.id, runId));
      await appendAuditEvent(tx, {
        eventType: 'AI_OCR_FAILED',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { errorCode: outcome.code, ocrRunId: runId },
      });
      return err(
        serviceError(outcome.code === 'disabled' ? 'invalid' : 'upstream_error', outcome.message),
      );
    }

    const { text, reviewIssues, usage } = outcome.result;

    const run = required(
      first(
        await tx
          .update(schema.ocrRuns)
          .set({
            status: 'SUCCEEDED',
            provider: usage.provider,
            modelVersion: usage.modelVersion,
            promptVersion: usage.promptVersion,
            extractedText: text,
            reviewIssues,
            costUnits: usage.costUnits,
            providerRequestId: usage.providerRequestId ?? null,
            inputUnits: usage.inputUnits,
            outputUnits: usage.outputUnits,
            latencyMs: usage.latencyMs,
            cacheKey,
          })
          .where(eq(schema.ocrRuns.id, runId))
          .returning(),
      ),
      'ocr run',
    );

    await appendAuditEvent(tx, {
      eventType: 'AI_OCR_RUN',
      actorAccountId: input.actorAccountId,
      method: 'DOCUMENT',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'document_version',
      resourceId: input.documentVersionId,
      metadata: {
        ocrRunId: runId,
        costUnits: usage.costUnits,
        modelVersion: usage.modelVersion,
        provider: usage.provider,
        latencyMs: usage.latencyMs,
        reviewIssues,
      },
    });
    await recordProductEvent(tx, { eventType: 'AI_OCR_RUN', accountId: input.actorAccountId });

    return ok({ ocrRun: run });
  });
}

const TRUSTED_FACT_STATUSES: readonly FactStatus[] = [
  'APPLICANT_CONFIRMED',
  'DOCUMENT_SUPPORTED',
  'AGENCY_REVIEWED',
];

async function findExistingFactId(
  db: Db,
  applicantId: string,
  fieldKey: string,
  repeatingRecordKey: string | null,
): Promise<string | undefined> {
  const rows = await db
    .select({ id: schema.facts.id })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .where(
      and(
        eq(schema.facts.applicantId, applicantId),
        eq(schema.fieldDefinitions.key, fieldKey),
        repeatingRecordKey === null
          ? isNull(schema.facts.repeatingRecordKey)
          : eq(schema.facts.repeatingRecordKey, repeatingRecordKey),
      ),
    )
    .limit(1);
  return first(rows)?.id;
}

export interface ApproveProposalInput {
  readonly actorAccountId: string;
  readonly proposalId: string;
  /** Edit-before-approve: applied instead of the proposed value when set and different. */
  readonly correctedValue?: string;
  readonly repeatingRecordKey?: string;
  /**
   * Required to approve a proposal targeting a SENSITIVE/RESTRICTED field
   * (Commercial V1 SEC-03), passed straight through to `editFact`, which
   * is the sole place that actually decides a port is needed. Omitted here,
   * approving a proposal for such a field fails the same
   * `encryption_unavailable` way a direct manual edit would.
   */
  readonly encryption?: KeyManagementPort;
}

/**
 * Apply an approved (optionally human-corrected) proposal to the Master
 * Profile — the ONLY path from a persisted proposal to a fact. Reuses
 * `editFact` for the atomic write, tagging the immutable version with
 * DOCUMENT provenance. Refuses to re-decide an already-decided proposal
 * (idempotency guard, matching `decideDocumentName`'s convention). If an
 * already-trusted fact value exists and differs, the new version is still
 * written but flagged CONFLICTED and a `conflicts` row records the
 * disagreement — never a silent overwrite of a trusted value.
 */
export async function approveProposal(
  db: Db,
  input: ApproveProposalInput,
): Promise<Result<EditFactResult, ServiceError>> {
  const proposal = first(
    await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.id, input.proposalId))
      .limit(1),
  );
  if (!proposal) return err(serviceError('not_found', 'proposal not found'));
  if (proposal.status !== 'PENDING') {
    return err(serviceError('invalid', 'this proposal has already been decided'));
  }
  if (proposal.type === 'UNMAPPED' || !proposal.fieldKey) {
    return err(serviceError('unknown_field', 'proposal has no canonical field to approve'));
  }
  // A local const's narrowing (unlike a property access) survives into the
  // nested transaction closure below.
  const fieldKey: string = proposal.fieldKey;

  const applicant = await getApplicant(db, proposal.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to decide this proposal'));
  }

  const correctedValue = input.correctedValue?.trim();
  const finalValue = correctedValue || proposal.value;
  if (!finalValue) return err(serviceError('invalid', 'proposal has no value to approve'));

  const run = required(
    first(
      await db
        .select()
        .from(schema.aiExtractionRuns)
        .where(eq(schema.aiExtractionRuns.id, proposal.aiExtractionRunId))
        .limit(1),
    ),
    'ai extraction run',
  );

  const repeatingRecordKey = input.repeatingRecordKey ?? null;
  const existingFactId = await findExistingFactId(
    db,
    proposal.applicantId,
    fieldKey,
    repeatingRecordKey,
  );
  let conflict: { factId: string; previousFactVersionId: string } | undefined;
  if (existingFactId) {
    const currentVersion = await getCurrentFactVersion(db, existingFactId);
    if (
      currentVersion &&
      currentVersion.value !== finalValue &&
      TRUSTED_FACT_STATUSES.includes(currentVersion.status)
    ) {
      conflict = { factId: existingFactId, previousFactVersionId: currentVersion.id };
    }
  }

  // Atomic approval (master directive §7 "PR 8"): the fact write and the
  // proposal decision (status, correction feedback, conflict record) must
  // commit or roll back together. editFact runs its own transaction — nested
  // here as a savepoint within this one — so a failure writing the proposal
  // decision AFTER the fact has already changed rolls back the fact change
  // too, instead of leaving the proposal stuck PENDING forever against an
  // already-mutated profile.
  return db.transaction(async (tx) => {
    const editResult = await editFact(tx, {
      actorAccountId: input.actorAccountId,
      applicantId: proposal.applicantId,
      fieldKey,
      value: finalValue,
      status: conflict ? 'CONFLICTED' : 'DOCUMENT_SUPPORTED',
      method: 'DOCUMENT',
      sourceDocumentVersionId: proposal.documentVersionId,
      modelVersion: run.modelVersion,
      promptVersion: run.promptVersion,
      reason: 'ai_proposal_approved',
      ...(repeatingRecordKey ? { repeatingRecordKey } : {}),
      ...(input.encryption ? { encryption: input.encryption } : {}),
    });
    if (!isOk(editResult)) return editResult;

    const { version } = editResult.value;
    await tx
      .update(schema.fieldProposals)
      .set({
        status: 'APPROVED',
        decidedByAccountId: input.actorAccountId,
        decidedAt: new Date(),
        factVersionId: version.id,
      })
      .where(eq(schema.fieldProposals.id, proposal.id));

    if (correctedValue && correctedValue !== proposal.value) {
      await tx.insert(schema.correctionFeedback).values({
        fieldProposalId: proposal.id,
        originalValue: proposal.value,
        correctedValue,
      });
    }

    if (conflict) {
      await tx.insert(schema.conflicts).values({
        fieldProposalId: proposal.id,
        factId: conflict.factId,
        previousFactVersionId: conflict.previousFactVersionId,
        newFactVersionId: version.id,
        note: `AI proposed "${finalValue}" but the current confirmed value differs`,
      });
    }

    return editResult;
  });
}

export interface RejectProposalInput {
  readonly actorAccountId: string;
  readonly proposalId: string;
  readonly reason?: string;
}

/** Reject a PENDING proposal — no fact mutation, just a recorded decision. */
export async function rejectProposal(
  db: Db,
  input: RejectProposalInput,
): Promise<Result<FieldProposalRow, ServiceError>> {
  const proposal = first(
    await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.id, input.proposalId))
      .limit(1),
  );
  if (!proposal) return err(serviceError('not_found', 'proposal not found'));
  if (proposal.status !== 'PENDING') {
    return err(serviceError('invalid', 'this proposal has already been decided'));
  }

  const applicant = await getApplicant(db, proposal.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to decide this proposal'));
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.fieldProposals)
          .set({
            status: 'REJECTED',
            decidedByAccountId: input.actorAccountId,
            decidedAt: new Date(),
          })
          .where(eq(schema.fieldProposals.id, input.proposalId))
          .returning(),
      ),
      'field proposal',
    );
    await appendAuditEvent(tx, {
      eventType: 'AI_PROPOSAL_REJECTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proposal.applicantId,
      resourceType: 'field_proposal',
      resourceId: proposal.id,
      metadata: { fieldKey: proposal.fieldKey, reason: input.reason },
    });
    return ok(updated);
  });
}

export type EvidenceLocationRow = typeof schema.evidenceLocations.$inferSelect;

export interface ProposalWithEvidence {
  readonly proposal: FieldProposalRow;
  readonly evidence: readonly EvidenceLocationRow[];
}

/** Pending proposals for an applicant (the review queue), newest first. */
export async function listPendingProposals(
  db: Db,
  applicantId: string,
): Promise<ProposalWithEvidence[]> {
  const proposals = await db
    .select()
    .from(schema.fieldProposals)
    .where(
      and(
        eq(schema.fieldProposals.applicantId, applicantId),
        eq(schema.fieldProposals.status, 'PENDING'),
      ),
    )
    .orderBy(desc(schema.fieldProposals.createdAt));

  const result: ProposalWithEvidence[] = [];
  for (const proposal of proposals) {
    const evidence = await db
      .select()
      .from(schema.evidenceLocations)
      .where(eq(schema.evidenceLocations.fieldProposalId, proposal.id));
    result.push({ proposal, evidence });
  }
  return result;
}
