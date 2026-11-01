import { createHash } from 'node:crypto';
import type { FactStatus, ProposalType } from '@visastack/core';
import { type Result, err, isOk, ok } from '@visastack/core';
import type { AiReadingFeature } from '@visastack/core/ai-features';
import { CATALOGUE_DOCUMENTS, isRepeatingFieldKey } from '@visastack/core/catalogue';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import {
  type AiFeatureCharge,
  type AiFeatureGate,
  aiDailyLimitRefusal,
  aiFeatureRefusal,
  aiOwnerContext,
  chargeAiFeatureUse,
  hasScanCover,
  leaveScanCover,
  openAiFeatureGate,
  refundAiFeatureUse,
  useScanCover,
} from './ai-feature-settings';
import { scopeFieldKeys } from './ai-field-scope';
import {
  CONNECTOR_MODEL_PREFIX,
  connectionIdOfRun,
  excludingDeterministicRuns,
  isConnectorModelVersion,
} from './ai-run-kinds';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { CLASSIFIABLE_DOCUMENT_TYPES } from './classification';
import { hasConsent } from './consent';
import { isFixedFieldKey } from './consistency';
import { type Db, first, required, schema } from './db';
import { type DocumentNameVersion, proposeDocumentName } from './document-naming';
import { documentVersionBelongsToApplicant } from './document-version-owner';
import { getDocumentTypeOfVersion } from './documents';
import { type ServiceError, serviceError } from './errors';
import { getLatestExtractedText } from './intake';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';
import { buildProposedName, extensionOf } from './naming';
import type {
  AiOcrCacheKeyComponents,
  AiOcrContentType,
  AiOcrErrorCode,
  AiOcrOutcome,
  AiOcrPort,
} from './ocr';
import type { KeyManagementPort } from './ports';
import { recordProductEvent } from './product-events';
import {
  type EditFactResult,
  type FactVersion,
  editFact,
  getCurrentFactVersion,
  revealFactVersionValue,
} from './profile';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';

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
  /**
   * Which provider gives the answer (owner request 2026-10-25). Part of every
   * cache key, so a reading cached from one provider is never served as
   * another's, even when an admin types the same model name for both. Every
   * real adapter sets it; it is optional only so older test doubles keep
   * their keys.
   */
  readonly provider?: string;
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

/**
 * Part 8 AI-01 item 2 ("document type suggestion"). A genuinely separate
 * port from `AiExtractionPort` -- NOT a bolted-on optional method -- so a
 * provider adapter class can implement it independently (Chunk C wires the
 * three existing extraction adapter classes to also `implements
 * AiClassifyPort`, letting them share credentials/config/timeout handling
 * without coupling the two interfaces themselves). Input is deliberately
 * the same SHAPE as `AiExtractionInput` (already deterministically-extracted
 * text, never raw file bytes) -- classification reuses `AI_EXTRACTION`
 * consent for exactly that reason, never a new consent type: this is not a
 * materially larger disclosure than field extraction already is.
 */
export interface AiClassifyInput {
  readonly documentVersionId: string;
  readonly text: string;
  /** The canonical document-type vocabulary (`classification.ts`'s own `CLASSIFIABLE_DOCUMENT_TYPES`); the model cannot invent others. */
  readonly allowedTypes: readonly string[];
}

export interface AiClassifyResult {
  /** null when the model also could not confidently classify -- never a guess, mirrors `ClassificationResult.classifiedType`'s own convention. */
  readonly suggestedType: string | null;
  /** 0..1 model confidence; persisted as 0-100 to match the rest of the schema. */
  readonly confidence: number;
  readonly rationale?: string;
  readonly usage: AiUsage;
}

export type AiClassifyOutcome =
  | { readonly ok: true; readonly result: AiClassifyResult }
  | {
      readonly ok: false;
      readonly code: AiExtractionErrorCode;
      readonly message: string;
      readonly provider?: string;
      readonly latencyMs?: number;
    };

export interface AiClassifyPort {
  classify(input: AiClassifyInput): Promise<AiClassifyOutcome>;
  /**
   * Deliberately NOT named `cacheKeyComponents` -- Chunk C wires the three
   * existing extraction adapter classes to also `implements AiClassifyPort`,
   * and a same-named, same-signature method on both interfaces would force
   * one implementation to serve both, unable to ever return two DIFFERENT
   * schema versions for two genuinely different tasks. Otherwise reuses
   * `AiCacheKeyComponents` unchanged (`reasoningEffort` stays optional) --
   * classification's cache key is computed the identical way `runExtraction`'s
   * own is.
   */
  classifyCacheKeyComponents(): AiCacheKeyComponents;
}

/**
 * Part 8 AI-01 item 5 ("explanation of an ALREADY-DETERMINED deterministic
 * readiness gap"). A third genuinely separate port, for the same reason
 * `AiClassifyPort` is: the input/output shape differs from both extraction
 * and classification. Scoped to only the two RUL-04 states
 * (`packages/services/src/missions.ts`'s own `RequirementResultState`) that
 * actually mean "requirement not met" -- CRITICAL_GAP (required) and
 * ATTENTION (optional) -- never CONFLICTING/EXPIRING_STALE/UNVERIFIED, which
 * are richer states describing a DIFFERENT kind of problem than a missing
 * requirement, out of this task's literal "a gap" scope. Deliberately no
 * applicant-specific data in the input at all -- see `ai_explanation_runs`'s
 * own doc comment in schema.ts for why that means no consent gate applies
 * either.
 */
export interface AiExplainInput {
  readonly requirementKind: 'FIELD' | 'DOCUMENT';
  readonly requirementKey: string;
  readonly state: 'CRITICAL_GAP' | 'ATTENTION';
  readonly citation: string;
  readonly optional: boolean;
}

export interface AiExplainResult {
  readonly explanation: string;
  readonly usage: AiUsage;
}

export type AiExplainOutcome =
  | { readonly ok: true; readonly result: AiExplainResult }
  | {
      readonly ok: false;
      readonly code: AiExtractionErrorCode;
      readonly message: string;
      readonly provider?: string;
      readonly latencyMs?: number;
    };

export interface AiExplainPort {
  explain(input: AiExplainInput): Promise<AiExplainOutcome>;
  /** Deliberately NOT named `cacheKeyComponents`/`classifyCacheKeyComponents` -- same collision-avoidance reasoning as `AiClassifyPort`'s own. */
  explainCacheKeyComponents(): AiCacheKeyComponents;
}

/**
 * Part 8 AI-01 item 4 ("possible inconsistency flag"), the fourth and last
 * port extending the canonical AI Gateway. Compares one document's
 * deterministically-extracted text against the applicant's OWN
 * already-confirmed (TRUSTED-status, STANDARD-sensitivity) profile facts --
 * never a second document, never protected/sensitive field values, and
 * never a re-determination of any fact's correctness. Purely advisory: even
 * a returned flag never implies which side (document or profile) is
 * actually wrong, only that a human should look.
 */
export interface AiInconsistencyInput {
  readonly documentVersionId: string;
  readonly text: string;
  readonly profileFacts: readonly { readonly fieldKey: string; readonly value: string }[];
}

export interface AiInconsistencyFlag {
  readonly description: string;
  /** 0..1 model confidence; persisted as 0-100 to match the rest of the schema. */
  readonly confidence: number;
  readonly rationale?: string;
}

export interface AiInconsistencyResult {
  /** Empty is a genuine, common, good outcome -- "found nothing" -- mirroring `runExtraction`'s own empty-proposals convention. */
  readonly flags: readonly AiInconsistencyFlag[];
  readonly usage: AiUsage;
}

export type AiInconsistencyOutcome =
  | { readonly ok: true; readonly result: AiInconsistencyResult }
  | {
      readonly ok: false;
      readonly code: AiExtractionErrorCode;
      readonly message: string;
      readonly provider?: string;
      readonly latencyMs?: number;
    };

export interface AiInconsistencyPort {
  checkConsistency(input: AiInconsistencyInput): Promise<AiInconsistencyOutcome>;
  /** Deliberately its own name, not shared with any other port's cache-key method -- same collision-avoidance reasoning as `AiClassifyPort`'s own. */
  inconsistencyCacheKeyComponents(): AiCacheKeyComponents;
}

function toPersistedConfidence(confidence: number): number {
  return Math.max(0, Math.min(100, Math.round(confidence * 100)));
}

/**
 * Anti-automation limit shared by all five AI Gateway tasks (Part 9 §6:
 * "Rate-limit: ... AI"). The budget, attempt and concurrency caps below bound
 * SPEND; this bounds how fast one account can drive those paths at all (a
 * script cycling many documents stays inside every per-document cap yet still
 * hammers the provider). One bucket per actor across every task, so splitting
 * the same abuse across tasks does not multiply the allowance. Called once per
 * user-initiated run, before any reservation, and never again for the
 * cross-provider fallback attempt inside that same run.
 */
async function aiRateLimitRefusal(
  db: Db,
  actorAccountId: string,
): Promise<ServiceError | undefined> {
  const decision = await checkRateLimit(
    db,
    { subjectId: actorAccountId, action: 'ai.run', label: 'AI' },
    RATE_LIMITS.AI_RUN,
  );
  return decision.allowed ? undefined : serviceError('rate_limited', decision.reason);
}

/**
 * A call the kill switch stopped after its slot was reserved made no model call, so the use it
 * counted today is given back (S28): only real calls count. The one place every kind of AI call
 * does this.
 */
async function refundIfSwitchedOff(
  db: Db,
  charge: AiFeatureCharge | null,
  outcome: { readonly ok: true } | { readonly ok: false; readonly code: string },
): Promise<void> {
  if (!outcome.ok && outcome.code === 'disabled') await refundAiFeatureUse(db, charge);
}

/**
 * The durable, platform-wide AI spend so far -- the cost ledger IS this sum.
 * Sums `ai_extraction_runs`, `ocr_runs`, AND `ai_classification_runs`
 * together (Part 8 Chunk 18's own user-confirmed decision, extended for
 * AI-01's classification task the same way): all three bill through the
 * same admin-configured provider/API key in reality -- one bill, one
 * budget -- so "platform-wide spend" means every AI Gateway task combined,
 * never just one task alone. The admin dashboard's own spend meter
 * (`apps/web/src/app/app/admin/page.tsx`) calls this function directly, so
 * it picks up true combined spend automatically as new tasks are added,
 * with no separate change needed there.
 */
export async function totalAiCostUnits(db: Db): Promise<number> {
  const [extraction, ocr, classification, explanation, inconsistency] = await Promise.all([
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.aiExtractionRuns.costUnits}), 0)` })
        .from(schema.aiExtractionRuns)
        // A rule-based reading is not an AI call and costs nothing (S5, ADR 0019).
        .where(excludingDeterministicRuns(schema.aiExtractionRuns.modelVersion)),
    ),
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.ocrRuns.costUnits}), 0)` })
        .from(schema.ocrRuns),
    ),
    first(
      await db
        .select({
          total: sql<string>`coalesce(sum(${schema.aiClassificationRuns.costUnits}), 0)`,
        })
        .from(schema.aiClassificationRuns),
    ),
    first(
      await db
        .select({
          total: sql<string>`coalesce(sum(${schema.aiExplanationRuns.costUnits}), 0)`,
        })
        .from(schema.aiExplanationRuns),
    ),
    first(
      await db
        .select({
          total: sql<string>`coalesce(sum(${schema.aiInconsistencyRuns.costUnits}), 0)`,
        })
        .from(schema.aiInconsistencyRuns),
    ),
  ]);
  return (
    Number(extraction?.total ?? 0) +
    Number(ocr?.total ?? 0) +
    Number(classification?.total ?? 0) +
    Number(explanation?.total ?? 0) +
    Number(inconsistency?.total ?? 0)
  );
}

/**
 * The durable AI spend so far for one specific document (per-document cap),
 * combined across `ai_extraction_runs`, `ocr_runs`, AND
 * `ai_classification_runs` for the identical reason `totalAiCostUnits` is --
 * a per-document cap exists to bound how much any single document can cost,
 * a concern that applies the same way regardless of which AI Gateway task
 * the spend came from.
 */
export async function documentAiCostUnits(db: Db, documentVersionId: string): Promise<number> {
  const [extraction, ocr, classification, inconsistency] = await Promise.all([
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.aiExtractionRuns.costUnits}), 0)` })
        .from(schema.aiExtractionRuns)
        .where(
          and(
            eq(schema.aiExtractionRuns.documentVersionId, documentVersionId),
            excludingDeterministicRuns(schema.aiExtractionRuns.modelVersion),
          ),
        ),
    ),
    first(
      await db
        .select({ total: sql<string>`coalesce(sum(${schema.ocrRuns.costUnits}), 0)` })
        .from(schema.ocrRuns)
        .where(eq(schema.ocrRuns.documentVersionId, documentVersionId)),
    ),
    first(
      await db
        .select({
          total: sql<string>`coalesce(sum(${schema.aiClassificationRuns.costUnits}), 0)`,
        })
        .from(schema.aiClassificationRuns)
        .where(eq(schema.aiClassificationRuns.documentVersionId, documentVersionId)),
    ),
    first(
      await db
        .select({
          total: sql<string>`coalesce(sum(${schema.aiInconsistencyRuns.costUnits}), 0)`,
        })
        .from(schema.aiInconsistencyRuns)
        .where(eq(schema.aiInconsistencyRuns.documentVersionId, documentVersionId)),
    ),
  ]);
  return (
    Number(extraction?.total ?? 0) +
    Number(ocr?.total ?? 0) +
    Number(classification?.total ?? 0) +
    Number(inconsistency?.total ?? 0)
  );
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
        // A rule-based reading (the passport's machine-readable lines) is not an AI attempt.
        excludingDeterministicRuns(schema.aiExtractionRuns.modelVersion),
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
 * How many times AI classification has genuinely been invoked for one
 * document -- the classification-specific mirror of `countAiExtractionAttempts`/
 * `countOcrAttempts`, same cache-hit exclusion, same reason it is its own
 * counter rather than shared with either: a document exhausting its
 * extraction (or OCR) attempt budget must never also block its first-ever
 * classification attempt, a genuinely different action invoked separately.
 */
export async function countAiClassificationAttempts(
  db: Db,
  documentVersionId: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.aiClassificationRuns.id })
    .from(schema.aiClassificationRuns)
    .where(
      and(
        eq(schema.aiClassificationRuns.documentVersionId, documentVersionId),
        isNull(schema.aiClassificationRuns.servedFromCacheRunId),
      ),
    );
  return rows.length;
}

/** How many times an inconsistency check has genuinely been invoked for one document -- the inconsistency-specific mirror of `countAiClassificationAttempts`, same cache-hit exclusion, same reason it is its own independent counter. */
export async function countAiInconsistencyAttempts(
  db: Db,
  documentVersionId: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.aiInconsistencyRuns.id })
    .from(schema.aiInconsistencyRuns)
    .where(
      and(
        eq(schema.aiInconsistencyRuns.documentVersionId, documentVersionId),
        isNull(schema.aiInconsistencyRuns.servedFromCacheRunId),
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
    db
      .update(schema.aiClassificationRuns)
      .set({ status: 'FAILED', errorCode: 'in_flight_expired' })
      .where(
        and(
          eq(schema.aiClassificationRuns.status, 'IN_FLIGHT'),
          lt(schema.aiClassificationRuns.createdAt, cutoff),
        ),
      ),
    db
      .update(schema.aiExplanationRuns)
      .set({ status: 'FAILED', errorCode: 'in_flight_expired' })
      .where(
        and(
          eq(schema.aiExplanationRuns.status, 'IN_FLIGHT'),
          lt(schema.aiExplanationRuns.createdAt, cutoff),
        ),
      ),
    db
      .update(schema.aiInconsistencyRuns)
      .set({ status: 'FAILED', errorCode: 'in_flight_expired' })
      .where(
        and(
          eq(schema.aiInconsistencyRuns.status, 'IN_FLIGHT'),
          lt(schema.aiInconsistencyRuns.createdAt, cutoff),
        ),
      ),
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
  const [extractionRows, ocrRows, classificationRows, explanationRows, inconsistencyRows] =
    await Promise.all([
      db
        .select({ id: schema.aiExtractionRuns.id })
        .from(schema.aiExtractionRuns)
        .where(eq(schema.aiExtractionRuns.status, 'IN_FLIGHT')),
      db
        .select({ id: schema.ocrRuns.id })
        .from(schema.ocrRuns)
        .where(eq(schema.ocrRuns.status, 'IN_FLIGHT')),
      db
        .select({ id: schema.aiClassificationRuns.id })
        .from(schema.aiClassificationRuns)
        .where(eq(schema.aiClassificationRuns.status, 'IN_FLIGHT')),
      db
        .select({ id: schema.aiExplanationRuns.id })
        .from(schema.aiExplanationRuns)
        .where(eq(schema.aiExplanationRuns.status, 'IN_FLIGHT')),
      db
        .select({ id: schema.aiInconsistencyRuns.id })
        .from(schema.aiInconsistencyRuns)
        .where(eq(schema.aiInconsistencyRuns.status, 'IN_FLIGHT')),
    ]);
  return (
    extractionRows.length +
    ocrRows.length +
    classificationRows.length +
    explanationRows.length +
    inconsistencyRows.length
  );
}

/** Same as `countInFlightCalls`, scoped to one document -- the per-document budget check's own concurrency exposure. */
async function countInFlightCallsForDocument(db: Db, documentVersionId: string): Promise<number> {
  const [extractionRows, ocrRows, classificationRows, inconsistencyRows] = await Promise.all([
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
    db
      .select({ id: schema.aiClassificationRuns.id })
      .from(schema.aiClassificationRuns)
      .where(
        and(
          eq(schema.aiClassificationRuns.status, 'IN_FLIGHT'),
          eq(schema.aiClassificationRuns.documentVersionId, documentVersionId),
        ),
      ),
    db
      .select({ id: schema.aiInconsistencyRuns.id })
      .from(schema.aiInconsistencyRuns)
      .where(
        and(
          eq(schema.aiInconsistencyRuns.status, 'IN_FLIGHT'),
          eq(schema.aiInconsistencyRuns.documentVersionId, documentVersionId),
        ),
      ),
  ]);
  return (
    extractionRows.length + ocrRows.length + classificationRows.length + inconsistencyRows.length
  );
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
  const [extraction, ocr, classification, explanation, inconsistency] = await Promise.all([
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
    first(
      await db
        .select({
          max: sql<string>`coalesce(max(${schema.aiClassificationRuns.costUnits}), 0)`,
        })
        .from(schema.aiClassificationRuns)
        .where(eq(schema.aiClassificationRuns.status, 'SUCCEEDED')),
    ),
    first(
      await db
        .select({
          max: sql<string>`coalesce(max(${schema.aiExplanationRuns.costUnits}), 0)`,
        })
        .from(schema.aiExplanationRuns)
        .where(eq(schema.aiExplanationRuns.status, 'SUCCEEDED')),
    ),
    first(
      await db
        .select({
          max: sql<string>`coalesce(max(${schema.aiInconsistencyRuns.costUnits}), 0)`,
        })
        .from(schema.aiInconsistencyRuns)
        .where(eq(schema.aiInconsistencyRuns.status, 'SUCCEEDED')),
    ),
  ]);
  return Math.max(
    Number(extraction?.max ?? 0),
    Number(ocr?.max ?? 0),
    Number(classification?.max ?? 0),
    Number(explanation?.max ?? 0),
    Number(inconsistency?.max ?? 0),
  );
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

/** The provider part of a cache key: empty for a test double that names none, so its keys stay as they were. */
function providerKeyPart(components: { readonly provider?: string }): readonly string[] {
  return components.provider ? [`provider:${components.provider}`] : [];
}

function computeCacheKey(
  contentHash: string,
  parserVersion: string,
  cacheKeyComponents: AiCacheKeyComponents,
  scopedFieldKeys?: readonly string[],
  kindVocabulary?: readonly string[],
): string {
  const parts = [
    contentHash,
    TASK_VERSION,
    parserVersion,
    cacheKeyComponents.model,
    cacheKeyComponents.promptVersion,
    cacheKeyComponents.schemaVersion,
    cacheKeyComponents.reasoningEffort ?? '',
    ...providerKeyPart(cacheKeyComponents),
  ];
  // A reading limited to a document type's fields must never be served to, or from, a reading
  // with a different list. Unscoped readings keep their existing key, so nothing already cached moves.
  if (scopedFieldKeys) parts.push(`fields:${[...scopedFieldKeys].sort().join(',')}`);
  // Same rule for the list of kinds a document may be given: a suggestion made from the short
  // rules list is never served for the full catalogue list, or the other way round.
  if (kindVocabulary) parts.push(`kinds:${[...kindVocabulary].sort().join(',')}`);
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * OCR's own cache key -- `ocr_runs.cache_key`'s own doc comment:
 * `sha256(contentHash|model|promptVersion)`, deliberately simpler than
 * `computeCacheKey` above since OCR has no parser/schema version. A reasoning
 * effort, when the adapter sends one, is added as its own part, so a key
 * made without one stays exactly as it was. `contentHash` here is a hash of the
 * actual rendered image bytes about to be sent (computed by `runOcr`
 * itself), mirroring `runExtraction`'s own "hash of the exact content about
 * to be sent" choice -- not `document_versions.sha256`, which is a
 * caller-optional column that can be null.
 */
function computeOcrCacheKey(
  contentHash: string,
  cacheKeyComponents: AiOcrCacheKeyComponents,
): string {
  const parts = [
    contentHash,
    cacheKeyComponents.model,
    cacheKeyComponents.promptVersion,
    ...providerKeyPart(cacheKeyComponents),
    ...(cacheKeyComponents.reasoningEffort ? [`effort:${cacheKeyComponents.reasoningEffort}`] : []),
  ];
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
  /**
   * Which AI feature this reading is (S28): the automatic reading job passes
   * `ai_automatic_reading`, a person's own request `ai_document_reading`. Required, so a new
   * caller cannot skip the platform owner's switch, the plan or the daily limit.
   */
  readonly feature: AiReadingFeature;
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
  /**
   * Part 8 §13 (cross-provider fallback), OFF (undefined) by default. See
   * `runExtraction`'s own doc comment for the full triggering/eligibility
   * rules -- this function only ever dispatches to it, never decides
   * whether it was correct to provide.
   */
  readonly fallback?: { readonly ai: AiExtractionPort };
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
 *
 * Cross-provider fallback (Part 8 §13, `input.fallback`): when the primary
 * call's outcome is a directive-named RECOVERABLE failure (`timeout` or
 * `rate_limited` only -- never `refused`, which would be exactly the "shop
 * for a desired answer" the directive forbids, and never `auth_failed`/
 * `invalid_response`/`disabled` either, matching "do not retry: auth
 * failure; invalid input; consent denial"), phases 1-3 run a SECOND time
 * against `input.fallback.ai`, writing their own `ai_extraction_runs` row
 * with `triggeredByRunId` pointing back at the primary row. This function
 * trusts whatever adapter it is given for `input.fallback.ai` without
 * re-checking eligibility itself -- the caller (`resolveAiExtractor`,
 * apps/web) is responsible for only ever populating it once the fallback
 * config's own eligibility (data policy approved, key not revoked, a
 * genuinely different provider) has been freshly re-verified.
 */
type ExtractionReservation =
  | { readonly kind: 'final'; readonly outcome: Result<RunExtractionSummary, ServiceError> }
  | {
      readonly kind: 'proceed';
      readonly runId: string;
      readonly allowedFieldKeys: readonly string[];
      readonly cacheKey: string;
      readonly charge: AiFeatureCharge | null;
    };

/**
 * Phase 1 (RESERVE), factored out of `runExtraction` so it can run a second
 * time for a cross-provider fallback attempt without duplicating any of its
 * own checks -- see `runExtraction`'s own doc comment ("Cross-provider
 * fallback") for why every check here composes correctly for a fallback
 * call for free. `triggeredByRunId`, set only for a fallback attempt, links
 * whatever row this reservation creates back to the primary row that
 * triggered it.
 */
async function reserveExtractionSlot(
  db: Db,
  ai: AiExtractionPort,
  input: RunExtractionInput,
  gate: AiFeatureGate | null,
  triggeredByRunId?: string,
): Promise<ExtractionReservation> {
  return db.transaction(async (tx): Promise<ExtractionReservation> => {
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

    const registeredFieldKeys = (
      await tx.select({ key: schema.fieldDefinitions.key }).from(schema.fieldDefinitions)
    ).map((r) => r.key);
    // The kind the person set, or the rules' confident one still waiting for them: a narrowing
    // only, never a saved kind (owner request 2026-10-25 left intake suggesting, not setting it).
    const readAsKind = await getDocumentTypeOfVersion(tx, input.documentVersionId);
    // Narrowed to what this kind of document carries, so the model is never offered, and a person
    // never sees a proposal for, a field the document cannot hold.
    const fieldScope = scopeFieldKeys(registeredFieldKeys, readAsKind);
    const allowedFieldKeys = fieldScope.keys;

    const contentHash = createHash('sha256').update(input.text).digest('hex');
    const parserVersion = (await latestParserVersion(tx, input.documentVersionId)) ?? 'unknown';
    const cacheKey = computeCacheKey(
      contentHash,
      parserVersion,
      ai.cacheKeyComponents(),
      fieldScope.scoped ? allowedFieldKeys : undefined,
    );

    const cacheMaxAgeDays = input.cacheMaxAgeDays ?? DEFAULT_CACHE_MAX_AGE_DAYS;
    const cacheCutoff = new Date(Date.now() - cacheMaxAgeDays * 24 * 60 * 60 * 1000);
    const cached = first(
      await tx
        .select()
        .from(schema.aiExtractionRuns)
        .where(
          and(
            eq(schema.aiExtractionRuns.cacheKey, cacheKey),
            // Reuse stays inside one person's records: another applicant's identical text is read afresh.
            eq(schema.aiExtractionRuns.applicantId, input.applicantId),
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
              ...(triggeredByRunId ? { triggeredByRunId } : {}),
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

    // The feature's use today is counted here, last, once every other check has passed and a
    // real call is certain: a cache hit, a refusal or a fallback attempt is never counted (S28).
    // A cover a counted scan of this file left is used first, once, in this same transaction:
    // the file was already counted (S28 round 4).
    const charge = gate
      ? ((await useScanCover(tx, gate, input.documentVersionId)) ??
        (await chargeAiFeatureUse(tx, gate)))
      : null;
    if (gate && !charge) {
      return { kind: 'final', outcome: err(aiDailyLimitRefusal(gate)) };
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
            ...(triggeredByRunId ? { triggeredByRunId } : {}),
          })
          .returning(),
      ),
      'ai extraction run',
    );

    return { kind: 'proceed', runId: run.id, allowedFieldKeys, cacheKey, charge };
  });
}

interface ExtractionDispatchResult {
  /** Raw adapter outcome, so a caller can inspect its error code to decide whether to attempt a fallback. */
  readonly outcome: AiExtractionOutcome;
  readonly result: Result<RunExtractionSummary, ServiceError>;
}

/**
 * Phases 2 (CALL) and 3 (RECONCILE), factored out for the identical reason
 * as `reserveExtractionSlot` -- reused unchanged for a fallback attempt
 * against a different `ai`/`runId`/`allowedFieldKeys`/`cacheKey`.
 */
async function dispatchAndReconcile(
  db: Db,
  ai: AiExtractionPort,
  input: RunExtractionInput,
  runId: string,
  allowedFieldKeys: readonly string[],
  cacheKey: string,
): Promise<ExtractionDispatchResult> {
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

  const result = await db.transaction(async (tx) => {
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
  return { outcome, result };
}

/**
 * The applicant an AI reading acts for, once the caller is shown to be their owner and the file
 * version is shown to be one of theirs (S2, M12). Someone else's applicant, someone else's
 * version, a missing record and a malformed id all answer the same, so a refusal never says
 * which one it was.
 */
async function loadOwnedApplicant(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly applicantId: string;
    readonly documentVersionId: string;
  },
): Promise<Result<NonNullable<Awaited<ReturnType<typeof getApplicant>>>, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant || applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('not_found', 'applicant not found'));
  }
  if (!(await documentVersionBelongsToApplicant(db, input.documentVersionId, input.applicantId))) {
    return err(serviceError('not_found', 'document version not found'));
  }
  return ok(applicant);
}

/** Part 8 §13: only these two directive-named codes ever justify a fallback attempt -- see the doc comment on `runExtraction` below ("Cross-provider fallback") for the full reasoning. */
function isRecoverableForFallback(code: AiExtractionErrorCode): boolean {
  return code === 'timeout' || code === 'rate_limited';
}

export async function runExtraction(
  db: Db,
  ai: AiExtractionPort,
  input: RunExtractionInput,
): Promise<Result<RunExtractionSummary, ServiceError>> {
  const owned = await loadOwnedApplicant(db, input);
  if (!owned.ok) return err(owned.error);
  const ownerAccountId = owned.value.ownerAccountId;
  // The feature first (S28): the platform, the platform owner's switch and the plan, then the
  // person's consent. Today's limit is checked after these, once it is known whether a scan of
  // this file already counted it (below). A refusal here reads no cover and uses none.
  const gate = await openAiFeatureGate(db, input.feature, aiOwnerContext(ownerAccountId), {
    alreadyCounted: true,
  });
  if (!gate.ok) return err(aiFeatureRefusal(gate.error));
  if (!(await hasConsent(db, ownerAccountId, 'AI_EXTRACTION'))) {
    return err(serviceError('consent_required', 'AI extraction consent is required'));
  }
  // One file is one use (S28 rounds 4 and 5): a counted scan of this very file, for this feature
  // and person, leaves one cover. With one waiting, today's limit does not stop the details and
  // the cover is used, once, where they would be counted (in the reserve transaction). Without
  // one, today's limit applies now and the details are counted.
  if (!(await hasScanCover(db, gate.value, input.documentVersionId))) {
    const limited = await openAiFeatureGate(db, input.feature, aiOwnerContext(ownerAccountId));
    if (!limited.ok) return err(aiFeatureRefusal(limited.error));
  }
  return extractAfterGate(db, ai, input, gate.value);
}

/** `runExtraction` once the feature is on. */
async function extractAfterGate(
  db: Db,
  ai: AiExtractionPort,
  input: RunExtractionInput,
  gate: AiFeatureGate,
): Promise<Result<RunExtractionSummary, ServiceError>> {
  const rateLimited = await aiRateLimitRefusal(db, input.actorAccountId);
  if (rateLimited) return err(rateLimited);

  const reservation = await reserveExtractionSlot(db, ai, input, gate);
  if (reservation.kind === 'final') return reservation.outcome;

  const primary = await dispatchAndReconcile(
    db,
    ai,
    input,
    reservation.runId,
    reservation.allowedFieldKeys,
    reservation.cacheKey,
  );
  await refundIfSwitchedOff(db, reservation.charge, primary.outcome);
  if (primary.outcome.ok) return primary.result;
  if (!input.fallback || !isRecoverableForFallback(primary.outcome.code)) return primary.result;

  // Cross-provider fallback (Part 8 §13): the primary row above is already
  // fully reconciled to FAILED, so this second reservation is an honest,
  // independent check against the current (now primary-free) ledger state,
  // not a race against it -- see `runExtraction`'s own doc comment.
  const fallbackReservation = await reserveExtractionSlot(
    db,
    input.fallback.ai,
    input,
    null,
    reservation.runId,
  );
  if (fallbackReservation.kind === 'final') return fallbackReservation.outcome;

  const fallback = await dispatchAndReconcile(
    db,
    input.fallback.ai,
    input,
    fallbackReservation.runId,
    fallbackReservation.allowedFieldKeys,
    fallbackReservation.cacheKey,
  );
  return fallback.result;
}

// --- AI-assisted document type classification (Part 8 AI-01 item 2) -------
//
// Advisory only, exactly like field extraction: `runClassification` never
// writes `document_classifications` directly, only a PENDING
// `document_type_proposals` row a human must decide on
// (`approveDocumentTypeProposal`/`rejectDocumentTypeProposal`). Shares the
// SAME platform-wide budget ledger, advisory locks, and AI_EXTRACTION
// consent gate `runExtraction` uses (this file's own doc comment explains
// why OCR lives here rather than in a separate file -- classification is
// co-located for the identical reason). Deliberately its OWN run table
// (`ai_classification_runs`) rather than folded into `ai_extraction_runs`
// with a discriminator -- `countAiExtractionAttempts`'s own doc comment
// already establishes that a per-task attempt limit must stay independent
// per task, which a shared table would need a filter on every query to
// preserve; a dedicated table gets that for free, matching `ocr_runs`'s own
// precedent one table up. No cross-provider fallback yet (Part 8 §13) --
// deliberately deferred, matching AI-09's own precedent of shipping a task's
// core capability before its fallback wiring.
export type DocumentTypeProposalRow = typeof schema.documentTypeProposals.$inferSelect;

export interface RunClassificationInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly documentVersionId: string;
  readonly text: string;
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits?: number;
  readonly maxAttemptsPerDocument?: number;
  readonly maxPagesPerDocument?: number;
  readonly maxConcurrentCalls?: number;
  readonly cacheMaxAgeDays?: number;
  readonly killSwitchCheck?: () => Promise<boolean>;
}

export interface RunClassificationSummary {
  readonly aiClassificationRunId: string;
  /** Null when the model also could not confidently classify -- nothing for a human to review, exactly like extraction's own empty-proposals case. */
  readonly proposal: DocumentTypeProposalRow | null;
}

type ClassificationReservation =
  | { readonly kind: 'final'; readonly outcome: Result<RunClassificationSummary, ServiceError> }
  | {
      readonly kind: 'proceed';
      readonly runId: string;
      readonly allowedTypes: readonly string[];
      readonly cacheKey: string;
      readonly charge: AiFeatureCharge | null;
    };

/**
 * Which kinds the model may choose from. `rules` is `runClassification`'s original list (the
 * kinds the deterministic classifier itself can produce) and keeps its existing cache keys; a
 * list is a set of catalogue kinds chosen by `suggestDocumentKind` (owner request 2026-10-25),
 * and is part of the cache key.
 */
type KindVocabulary = 'rules' | readonly string[];

/** Every kind in the document catalogue, by its standard key. */
const CATALOGUE_DOCUMENT_KINDS: readonly string[] = CATALOGUE_DOCUMENTS.map((entry) => entry.key);

/** Phase 1 (RESERVE) -- structurally mirrors `reserveExtractionSlot`; see that function's own doc comment (on `runExtraction`) for the full reasoning behind every check and lock here. */
async function reserveClassificationSlot(
  db: Db,
  ai: AiClassifyPort,
  input: RunClassificationInput,
  gate: AiFeatureGate | null,
  vocabulary: KindVocabulary = 'rules',
): Promise<ClassificationReservation> {
  return db.transaction(async (tx): Promise<ClassificationReservation> => {
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
    if (input.maxPagesPerDocument !== undefined) {
      const pageCount = await latestPageCount(tx, input.documentVersionId);
      if (pageCount !== null && pageCount > input.maxPagesPerDocument) {
        return {
          kind: 'final',
          outcome: err(
            serviceError(
              'invalid',
              'document exceeds the configured page limit for AI classification',
            ),
          ),
        };
      }
    }

    const allowedTypes = vocabulary === 'rules' ? CLASSIFIABLE_DOCUMENT_TYPES : vocabulary;
    const contentHash = createHash('sha256').update(input.text).digest('hex');
    const parserVersion = (await latestParserVersion(tx, input.documentVersionId)) ?? 'unknown';
    const cacheKey = computeCacheKey(
      contentHash,
      parserVersion,
      ai.classifyCacheKeyComponents(),
      undefined,
      vocabulary === 'rules' ? undefined : vocabulary,
    );

    const cacheMaxAgeDays = input.cacheMaxAgeDays ?? DEFAULT_CACHE_MAX_AGE_DAYS;
    const cacheCutoff = new Date(Date.now() - cacheMaxAgeDays * 24 * 60 * 60 * 1000);
    const cached = first(
      await tx
        .select()
        .from(schema.aiClassificationRuns)
        .where(
          and(
            eq(schema.aiClassificationRuns.cacheKey, cacheKey),
            // Reuse stays inside one person's records: another applicant's identical text is read afresh.
            eq(schema.aiClassificationRuns.applicantId, input.applicantId),
            eq(schema.aiClassificationRuns.status, 'SUCCEEDED'),
            gte(schema.aiClassificationRuns.createdAt, cacheCutoff),
          ),
        )
        .orderBy(desc(schema.aiClassificationRuns.createdAt))
        .limit(1),
    );

    if (cached) {
      const run = required(
        first(
          await tx
            .insert(schema.aiClassificationRuns)
            .values({
              documentVersionId: input.documentVersionId,
              applicantId: input.applicantId,
              status: 'SUCCEEDED',
              modelVersion: cached.modelVersion,
              promptVersion: cached.promptVersion,
              schemaVersion: cached.schemaVersion,
              costUnits: 0,
              provider: cached.provider,
              cacheKey,
              servedFromCacheRunId: cached.id,
            })
            .returning(),
        ),
        'ai classification run',
      );
      const sourceProposal = first(
        await tx
          .select()
          .from(schema.documentTypeProposals)
          .where(eq(schema.documentTypeProposals.aiClassificationRunId, cached.id)),
      );
      let savedProposal: DocumentTypeProposalRow | null = null;
      if (sourceProposal) {
        savedProposal = required(
          first(
            await tx
              .insert(schema.documentTypeProposals)
              .values({
                aiClassificationRunId: run.id,
                documentVersionId: input.documentVersionId,
                applicantId: input.applicantId,
                suggestedType: sourceProposal.suggestedType,
                confidence: sourceProposal.confidence,
                rationale: sourceProposal.rationale,
              })
              .returning(),
          ),
          'document type proposal',
        );
      }
      await appendAuditEvent(tx, {
        eventType: 'AI_CLASSIFICATION_CACHE_HIT',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { aiClassificationRunId: run.id, servedFromCacheRunId: cached.id, cacheKey },
      });
      return {
        kind: 'final',
        outcome: ok({ aiClassificationRunId: run.id, proposal: savedProposal }),
      };
    }

    if (input.maxAttemptsPerDocument !== undefined) {
      const attempts = await countAiClassificationAttempts(tx, input.documentVersionId);
      if (attempts >= input.maxAttemptsPerDocument) {
        return {
          kind: 'final',
          outcome: err(
            serviceError('invalid', 'AI classification attempt limit reached for this document'),
          ),
        };
      }
    }

    if (input.maxConcurrentCalls !== undefined && inFlightPlatform >= input.maxConcurrentCalls) {
      return {
        kind: 'final',
        outcome: err(
          serviceError(
            'rate_limited',
            'too many AI classification calls in flight platform-wide; try again shortly',
          ),
        ),
      };
    }

    // The feature's use today is counted here, last, once every other check has passed and a
    // real call is certain: a cache hit, a refusal or a fallback attempt is never counted (S28).
    const charge = gate ? await chargeAiFeatureUse(tx, gate) : null;
    if (gate && !charge) {
      return { kind: 'final', outcome: err(aiDailyLimitRefusal(gate)) };
    }

    const run = required(
      first(
        await tx
          .insert(schema.aiClassificationRuns)
          .values({
            documentVersionId: input.documentVersionId,
            applicantId: input.applicantId,
            status: 'IN_FLIGHT',
            modelVersion: 'unknown',
            promptVersion: 'unknown',
          })
          .returning(),
      ),
      'ai classification run',
    );

    return { kind: 'proceed', runId: run.id, allowedTypes, cacheKey, charge };
  });
}

interface ClassificationDispatchResult {
  readonly outcome: AiClassifyOutcome;
  readonly result: Result<RunClassificationSummary, ServiceError>;
}

/** Phases 2 (CALL) and 3 (RECONCILE) -- structurally mirrors `dispatchAndReconcile`. */
async function dispatchAndReconcileClassification(
  db: Db,
  ai: AiClassifyPort,
  input: RunClassificationInput,
  runId: string,
  allowedTypes: readonly string[],
  cacheKey: string,
): Promise<ClassificationDispatchResult> {
  const killSwitchAllows = input.killSwitchCheck ? await input.killSwitchCheck() : true;

  const outcome: AiClassifyOutcome = killSwitchAllows
    ? await ai.classify({
        documentVersionId: input.documentVersionId,
        text: input.text,
        allowedTypes,
      })
    : { ok: false, code: 'disabled', message: 'AI classification is currently disabled' };

  const result = await db.transaction(async (tx) => {
    if (!outcome.ok) {
      await tx
        .update(schema.aiClassificationRuns)
        .set({
          status: 'FAILED',
          provider: outcome.provider ?? null,
          latencyMs: outcome.latencyMs ?? null,
          errorCode: outcome.code,
        })
        .where(eq(schema.aiClassificationRuns.id, runId));
      await appendAuditEvent(tx, {
        eventType: 'AI_CLASSIFICATION_FAILED',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { errorCode: outcome.code, aiClassificationRunId: runId },
      });
      return err(
        serviceError(outcome.code === 'disabled' ? 'invalid' : 'upstream_error', outcome.message),
      );
    }

    const { suggestedType, confidence, rationale, usage } = outcome.result;

    await tx
      .update(schema.aiClassificationRuns)
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
      .where(eq(schema.aiClassificationRuns.id, runId));

    // No proposal row when the model also could not confidently classify, or
    // named a type outside the allowed vocabulary (never trusted blindly,
    // exactly like extraction's own UNMAPPED/UNCERTAIN handling) -- nothing
    // for a human to review either way.
    let savedProposal: DocumentTypeProposalRow | null = null;
    if (suggestedType && allowedTypes.includes(suggestedType)) {
      savedProposal = required(
        first(
          await tx
            .insert(schema.documentTypeProposals)
            .values({
              aiClassificationRunId: runId,
              documentVersionId: input.documentVersionId,
              applicantId: input.applicantId,
              suggestedType,
              confidence: toPersistedConfidence(confidence),
              rationale: rationale ?? null,
            })
            .returning(),
        ),
        'document type proposal',
      );
    }

    await appendAuditEvent(tx, {
      eventType: 'AI_CLASSIFICATION_RUN',
      actorAccountId: input.actorAccountId,
      method: 'DOCUMENT',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'document_version',
      resourceId: input.documentVersionId,
      metadata: {
        aiClassificationRunId: runId,
        proposed: savedProposal !== null,
        costUnits: usage.costUnits,
        modelVersion: usage.modelVersion,
        provider: usage.provider,
        latencyMs: usage.latencyMs,
      },
    });
    await recordProductEvent(tx, {
      eventType: 'AI_CLASSIFICATION_RUN',
      accountId: input.actorAccountId,
    });

    return ok({ aiClassificationRunId: runId, proposal: savedProposal });
  });
  return { outcome, result };
}

/**
 * Run AI document-type classification (Part 8 AI-01 item 2), persisting an
 * advisory proposal WITHOUT mutating `document_classifications`. Refuses to
 * run at all when the deterministic classifier (`classification.ts`) already
 * reached a confident result, or when a suggestion is already pending review
 * for this document -- this task exists to fill a genuine deterministic gap,
 * never to second-guess or duplicate it.
 */
export async function runClassification(
  db: Db,
  ai: AiClassifyPort,
  input: RunClassificationInput,
): Promise<Result<RunClassificationSummary, ServiceError>> {
  const owned = await loadOwnedApplicant(db, input);
  if (!owned.ok) return err(owned.error);
  const applicant = owned.value;
  // The same feature as `suggestDocumentKind` (S28), checked before consent.
  const gate = await openAiFeatureGate(
    db,
    'ai_document_kind',
    aiOwnerContext(applicant.ownerAccountId),
  );
  if (!gate.ok) return err(aiFeatureRefusal(gate.error));
  if (!(await hasConsent(db, applicant.ownerAccountId, 'AI_EXTRACTION'))) {
    return err(serviceError('consent_required', 'AI extraction consent is required'));
  }

  const existing = first(
    await db
      .select({
        classifiedType: schema.documentClassifications.classifiedType,
        reviewRequired: schema.documentClassifications.reviewRequired,
      })
      .from(schema.documentClassifications)
      .where(eq(schema.documentClassifications.documentVersionId, input.documentVersionId))
      .orderBy(desc(schema.documentClassifications.createdAt))
      .limit(1),
  );
  if (existing && existing.classifiedType !== null && !existing.reviewRequired) {
    return err(
      serviceError('invalid', 'this document already has a confident deterministic classification'),
    );
  }
  const pending = first(
    await db
      .select({ id: schema.documentTypeProposals.id })
      .from(schema.documentTypeProposals)
      .where(
        and(
          eq(schema.documentTypeProposals.documentVersionId, input.documentVersionId),
          eq(schema.documentTypeProposals.status, 'PENDING'),
        ),
      )
      .limit(1),
  );
  if (pending) {
    return err(serviceError('invalid', 'a classification suggestion is already pending review'));
  }

  // After the no-op refusals above on purpose: re-clicking on an already
  // classified or already pending document spends nothing, so it must not
  // burn the actor's allowance either.
  const rateLimited = await aiRateLimitRefusal(db, input.actorAccountId);
  if (rateLimited) return err(rateLimited);

  const reservation = await reserveClassificationSlot(db, ai, input, gate.value);
  if (reservation.kind === 'final') return reservation.outcome;

  const dispatched = await dispatchAndReconcileClassification(
    db,
    ai,
    input,
    reservation.runId,
    reservation.allowedTypes,
    reservation.cacheKey,
  );
  await refundIfSwitchedOff(db, reservation.charge, dispatched.outcome);
  return dispatched.result;
}

export interface ApproveDocumentTypeProposalInput {
  readonly actorAccountId: string;
  readonly proposalId: string;
}

/**
 * Approve an AI document-type suggestion: writes a new, AI_APPROVED
 * `document_classifications` row (never overwriting the proposal's own
 * record, and never touching a deterministic row), then reuses the EXACT
 * SAME downstream effects the deterministic path gets at intake time
 * (`intake.ts`'s own `runExtractionStep`) -- filling `documents.docType`
 * only if still null, and triggering a naming proposal via the identical
 * `buildProposedName`/`proposeDocumentName` machinery. An AI-approved
 * classification is never treated any differently from a deterministic one
 * by either downstream system, satisfying AI-01 item 3 ("safe filename/name
 * suggestion") through reuse rather than a second naming implementation.
 */
export async function approveDocumentTypeProposal(
  db: Db,
  input: ApproveDocumentTypeProposalInput,
): Promise<Result<DocumentTypeProposalRow, ServiceError>> {
  const proposal = first(
    await db
      .select()
      .from(schema.documentTypeProposals)
      .where(eq(schema.documentTypeProposals.id, input.proposalId))
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

  const lifecycle = await lifecycleTablesPresent(db);
  const document = first(
    await db
      .select({
        id: schema.documents.id,
        originalName: schema.documents.originalName,
        docType: schema.documents.docType,
      })
      .from(schema.documents)
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.documentId, schema.documents.id),
      )
      .where(
        and(
          eq(schema.documentVersions.id, proposal.documentVersionId),
          // A command on one document: presentDocumentCondition (deleted answers as missing).
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));

  const extractionRun = required(
    first(
      await db
        .select({ id: schema.extractionRuns.id })
        .from(schema.extractionRuns)
        .where(
          and(
            eq(schema.extractionRuns.documentVersionId, proposal.documentVersionId),
            eq(schema.extractionRuns.status, 'SUCCEEDED'),
          ),
        )
        .orderBy(desc(schema.extractionRuns.createdAt))
        .limit(1),
    ),
    'extraction run',
  );

  return db.transaction(async (tx) => {
    const classification = required(
      first(
        await tx
          .insert(schema.documentClassifications)
          .values({
            extractionRunId: extractionRun.id,
            documentVersionId: proposal.documentVersionId,
            classifiedType: proposal.suggestedType,
            confidence: proposal.confidence,
            reviewRequired: false,
            rationale: proposal.rationale,
            source: 'AI_APPROVED',
          })
          .returning(),
      ),
      'document classification',
    );

    const updated = required(
      first(
        await tx
          .update(schema.documentTypeProposals)
          .set({
            status: 'APPROVED',
            decidedByAccountId: input.actorAccountId,
            decidedAt: new Date(),
            classificationId: classification.id,
          })
          .where(eq(schema.documentTypeProposals.id, input.proposalId))
          .returning(),
      ),
      'document type proposal',
    );

    if (!document.docType) {
      await tx
        .update(schema.documents)
        .set({ docType: proposal.suggestedType })
        .where(eq(schema.documents.id, document.id));
    }
    const proposedName = buildProposedName({
      classifiedType: proposal.suggestedType,
      primarySubject: applicant.displayName ?? 'Unknown',
      extension: extensionOf(document.originalName),
    });
    await proposeDocumentName(tx, { documentId: document.id, proposedName });

    await appendAuditEvent(tx, {
      eventType: 'AI_CLASSIFICATION_PROPOSAL_APPROVED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proposal.applicantId,
      resourceType: 'document_type_proposal',
      resourceId: proposal.id,
      metadata: { suggestedType: proposal.suggestedType, classificationId: classification.id },
    });
    await recordProductEvent(tx, {
      eventType: 'AI_PROPOSAL_ACCEPTED',
      accountId: input.actorAccountId,
      dimension: 'CLASSIFICATION',
    });

    return ok(updated);
  });
}

export interface RejectDocumentTypeProposalInput {
  readonly actorAccountId: string;
  readonly proposalId: string;
  readonly reason?: string;
}

/** Reject a PENDING document-type suggestion -- no classification written, just a recorded decision. */
export async function rejectDocumentTypeProposal(
  db: Db,
  input: RejectDocumentTypeProposalInput,
): Promise<Result<DocumentTypeProposalRow, ServiceError>> {
  const proposal = first(
    await db
      .select()
      .from(schema.documentTypeProposals)
      .where(eq(schema.documentTypeProposals.id, input.proposalId))
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
          .update(schema.documentTypeProposals)
          .set({
            status: 'REJECTED',
            decidedByAccountId: input.actorAccountId,
            decidedAt: new Date(),
          })
          .where(eq(schema.documentTypeProposals.id, input.proposalId))
          .returning(),
      ),
      'document type proposal',
    );
    await appendAuditEvent(tx, {
      eventType: 'AI_CLASSIFICATION_PROPOSAL_REJECTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proposal.applicantId,
      resourceType: 'document_type_proposal',
      resourceId: proposal.id,
      metadata: { suggestedType: proposal.suggestedType, reason: input.reason },
    });
    await recordProductEvent(tx, {
      eventType: 'AI_PROPOSAL_REJECTED',
      accountId: input.actorAccountId,
      dimension: 'CLASSIFICATION',
    });
    return ok(updated);
  });
}

/** Pending document-type suggestions for an applicant (the review queue), newest first -- mirrors `listPendingProposals`'s identical shape/contract. */
export async function listPendingDocumentTypeProposals(
  db: Db,
  applicantId: string,
): Promise<DocumentTypeProposalRow[]> {
  return db
    .select()
    .from(schema.documentTypeProposals)
    .where(
      and(
        eq(schema.documentTypeProposals.applicantId, applicantId),
        eq(schema.documentTypeProposals.status, 'PENDING'),
      ),
    )
    .orderBy(desc(schema.documentTypeProposals.createdAt));
}

// --- AI naming and sorting, saved only after the person approves (owner request 2026-10-25) ---
//
// When the person runs an AI reading of a document they own, the AI also says what kind of
// document it is, chosen from the WHOLE document catalogue, and a name is suggested from that
// kind. Nothing is saved here: the kind waits as a PENDING `document_type_proposals` row and the
// name as a PENDING `document_name_versions` row, until the person accepts, edits or skips both
// together (`decideDocumentSuggestion`, document-suggestion.ts). The name is built by the same
// rules as every other suggested name (`buildProposedName`): the kind's plain label and the
// applicant's own name, never anything the model wrote, so a document number, date of birth or
// any other detail from inside the document can never end up in it.

export interface SuggestDocumentKindInput {
  readonly documentVersionId: string;
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits?: number;
  readonly maxAttemptsPerDocument?: number;
  readonly maxPagesPerDocument?: number;
  readonly maxConcurrentCalls?: number;
  readonly cacheMaxAgeDays?: number;
  readonly killSwitchCheck?: () => Promise<boolean>;
}

export type DocumentKindSuggestion =
  /** A kind from the catalogue, waiting for the person, with the name suggested for it. */
  | {
      readonly status: 'suggested';
      readonly proposal: DocumentTypeProposalRow;
      readonly nameVersion: DocumentNameVersion;
    }
  /** The model could not tell, or named something outside the catalogue: the earlier suggestion, if any, stays. */
  | { readonly status: 'no_suggestion' }
  /** The person already said what kind of document this is: nothing to suggest, nothing spent. */
  | { readonly status: 'kind_already_set' }
  /** The rules are already confident of the kind: the AI is not asked, nothing spent. */
  | { readonly status: 'rules_confident' }
  /** A suggestion for this file is already waiting for the person: nothing spent. */
  | { readonly status: 'already_suggested'; readonly proposal: DocumentTypeProposalRow };

/** File states that passed the safety scan and the content checks: anything else never gets a suggestion. */
const SUGGESTIBLE_PROCESSING_STATES: ReadonlySet<string> = new Set(['AWAITING_REVIEW', 'APPROVED']);

/**
 * Ask the AI what kind of document this file is, and suggest a name for it. The owner only,
 * through the access gate: a proof for the applicant, or for the document the file belongs to,
 * made by `requireAccess` on the top-level database handle, not inside a transaction, because
 * the provider call must never hold one open. A file of any other applicant or document is
 * reported as not found.
 * Shares every limit the other AI tasks use (consent, platform and per-document budget, attempt
 * cap, cache, kill switch, rate limit). A failed provider call returns an error and leaves any
 * earlier suggestion exactly as it was.
 */
export async function suggestDocumentKind(
  proof: AuthorizedApplicant<'MANAGE'>,
  ai: AiClassifyPort,
  input: SuggestDocumentKindInput,
): Promise<Result<DocumentKindSuggestion, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'MANAGE') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind === 'mission'
  ) {
    return err(serviceError('forbidden', 'only the owner can ask what kind of document this is'));
  }
  const db = proof.tx;
  const ownerAccountId = proof.applicant.ownerAccountId;

  // The file must be one of this applicant's own, and the very document the proof names when it
  // names one.
  const lifecycle = await lifecycleTablesPresent(db);
  const row = first(
    await db
      .select({
        documentId: schema.documents.id,
        docType: schema.documents.docType,
        originalName: schema.documents.originalName,
        safetyStatus: schema.documentVersions.safetyStatus,
        processingStatus: schema.documentVersions.processingStatus,
      })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(
        and(
          eq(schema.documentVersions.id, input.documentVersionId),
          eq(schema.documents.applicantId, proof.applicant.id),
          ...(proof.resource.kind === 'document'
            ? [eq(schema.documents.id, proof.resource.document.id)]
            : []),
          // A command on one document: presentDocumentCondition (deleted answers as missing).
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', 'document version not found'));
  if (row.safetyStatus !== 'CLEAN' || !SUGGESTIBLE_PROCESSING_STATES.has(row.processingStatus)) {
    return err(serviceError('invalid', 'this file has not finished its safety checks'));
  }
  // The feature first (S28), then consent.
  const gate = await openAiFeatureGate(db, 'ai_document_kind', { proof });
  if (!gate.ok) return err(aiFeatureRefusal(gate.error));
  if (!(await hasConsent(db, ownerAccountId, 'CORE_PROCESSING'))) {
    return err(serviceError('consent_required', 'processing consent is required'));
  }
  if (!(await hasConsent(db, ownerAccountId, 'AI_EXTRACTION'))) {
    return err(serviceError('consent_required', 'AI extraction consent is required'));
  }
  if (row.docType) return ok({ status: 'kind_already_set' });

  // The AI never second-guesses a confident rules kind (a passport whose machine-readable lines
  // pass their check digits, say): text inside a document must not be able to talk the reading
  // into a different, possibly less protected, kind. The rules suggestion stays as it is.
  const rules = first(
    await db
      .select({
        classifiedType: schema.documentClassifications.classifiedType,
        reviewRequired: schema.documentClassifications.reviewRequired,
      })
      .from(schema.documentClassifications)
      .where(eq(schema.documentClassifications.documentVersionId, input.documentVersionId))
      .orderBy(desc(schema.documentClassifications.createdAt))
      .limit(1),
  );
  if (rules?.classifiedType && !rules.reviewRequired) return ok({ status: 'rules_confident' });

  const pending = first(
    await db
      .select()
      .from(schema.documentTypeProposals)
      .where(
        and(
          eq(schema.documentTypeProposals.documentVersionId, input.documentVersionId),
          eq(schema.documentTypeProposals.status, 'PENDING'),
        ),
      )
      .orderBy(desc(schema.documentTypeProposals.createdAt))
      .limit(1),
  );
  if (pending) return ok({ status: 'already_suggested', proposal: pending });

  const text = await getLatestExtractedText(db, input.documentVersionId, proof.applicant.id);
  if (!text) return err(serviceError('invalid', 'there is no text from this file to read yet'));

  // After the no-op answers above on purpose, exactly like runClassification: asking again
  // about a document that needs nothing spends nothing.
  const rateLimited = await aiRateLimitRefusal(db, ownerAccountId);
  if (rateLimited) return err(rateLimited);

  const runInput: RunClassificationInput = {
    actorAccountId: ownerAccountId,
    applicantId: proof.applicant.id,
    documentVersionId: input.documentVersionId,
    text,
    budgetLimitUnits: input.budgetLimitUnits,
    ...(input.perDocumentBudgetLimitUnits !== undefined
      ? { perDocumentBudgetLimitUnits: input.perDocumentBudgetLimitUnits }
      : {}),
    ...(input.maxAttemptsPerDocument !== undefined
      ? { maxAttemptsPerDocument: input.maxAttemptsPerDocument }
      : {}),
    ...(input.maxPagesPerDocument !== undefined
      ? { maxPagesPerDocument: input.maxPagesPerDocument }
      : {}),
    ...(input.maxConcurrentCalls !== undefined
      ? { maxConcurrentCalls: input.maxConcurrentCalls }
      : {}),
    ...(input.cacheMaxAgeDays !== undefined ? { cacheMaxAgeDays: input.cacheMaxAgeDays } : {}),
    ...(input.killSwitchCheck ? { killSwitchCheck: input.killSwitchCheck } : {}),
  };
  // Any catalogue kind may be suggested (owner decision 2026-10-25); it is saved only on Accept,
  // and the card says so plainly when accepting would remove the fresh sign-in check
  // (`acceptingRemovesFreshSignIn`, document-suggestion.ts). The list offered is part of the
  // cache key, so a reading made from another list is never reused for this one.
  const kinds = CATALOGUE_DOCUMENT_KINDS;
  if (kinds.length === 0) return ok({ status: 'no_suggestion' });
  const reservation = await reserveClassificationSlot(db, ai, runInput, gate.value, kinds);
  let summary: Result<RunClassificationSummary, ServiceError>;
  if (reservation.kind === 'final') summary = reservation.outcome;
  else {
    const dispatched = await dispatchAndReconcileClassification(
      db,
      ai,
      runInput,
      reservation.runId,
      reservation.allowedTypes,
      reservation.cacheKey,
    );
    await refundIfSwitchedOff(db, reservation.charge, dispatched.outcome);
    summary = dispatched.result;
  }
  if (!summary.ok) return summary;
  const proposal = summary.value.proposal;
  if (!proposal) return ok({ status: 'no_suggestion' });

  let nameVersion: DocumentNameVersion;
  try {
    nameVersion = await db.transaction((tx) =>
      nameForSuggestedKind(tx, {
        documentId: row.documentId,
        kind: proposal.suggestedType,
        primarySubject: proof.applicant.displayName ?? 'Unknown',
        originalName: row.originalName,
      }),
    );
  } catch (error) {
    // Deleted while the reading ran (LC-A2): the same answer as a document that does not exist.
    if (error instanceof DocumentGoneDuringSuggestion) {
      return err(serviceError('not_found', 'document version not found'));
    }
    throw error;
  }
  return ok({ status: 'suggested', proposal, nameVersion });
}

/**
 * The name to show beside a suggested kind. Any name still waiting is set aside as replaced, so
 * only one suggestion is ever waiting, and a new one is made from the suggested kind. Locks the
 * document row first, then its names, in the same order `decideDocumentSuggestion` does, so the
 * two can never wait on each other.
 */
async function nameForSuggestedKind(
  tx: Db,
  input: {
    readonly documentId: string;
    readonly kind: string;
    readonly primarySubject: string;
    readonly originalName: string;
  },
): Promise<DocumentNameVersion> {
  await tx
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, input.documentId))
    .for('update');
  await tx
    .update(schema.documentNameVersions)
    .set({ decision: 'REJECTED', reason: 'replaced by a newer suggestion', decidedAt: new Date() })
    .where(
      and(
        eq(schema.documentNameVersions.documentId, input.documentId),
        eq(schema.documentNameVersions.decision, 'PENDING'),
      ),
    );
  const proposed = await proposeDocumentName(tx, {
    documentId: input.documentId,
    proposedName: buildProposedName({
      classifiedType: input.kind,
      primarySubject: input.primarySubject,
      extension: extensionOf(input.originalName),
    }),
    reason: 'suggested from the AI reading of this document',
  });
  if (!proposed.ok) {
    if (proposed.error.code === 'not_found') throw new DocumentGoneDuringSuggestion();
    throw new Error(`name suggestion failed: ${proposed.error.message}`);
  }
  return proposed.value;
}

/** Thrown inside the naming transaction so it rolls back when the document left meanwhile. */
class DocumentGoneDuringSuggestion extends Error {}

export interface RunOcrInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly documentVersionId: string;
  /** Already-rendered bytes (`renderOcrSourceImage`'s own output) -- mirrors `RunExtractionInput.text`, which is likewise caller-supplied, not computed inside this function. */
  readonly imageBytes: Uint8Array;
  readonly contentType: AiOcrContentType;
  /** Which AI feature this reading is (S28); see `RunExtractionInput.feature`. */
  readonly feature: AiReadingFeature;
  /** Same shared, platform-wide budget `runExtraction` enforces (Part 8 Chunk 18/19) -- pass the identical resolved value both call sites use. */
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits?: number;
  /** OCR's own attempt counter (`countOcrAttempts`), never `countAiExtractionAttempts` -- see that function's doc comment. */
  readonly maxAttemptsPerDocument?: number;
  readonly maxConcurrentCalls?: number;
  readonly cacheMaxAgeDays?: number;
  readonly killSwitchCheck?: () => Promise<boolean>;
  /** Part 8 §13 (cross-provider fallback) -- see `runExtraction`'s own doc comment for the full triggering/eligibility rules, mirrored unchanged for OCR. */
  readonly fallback?: { readonly ai: AiOcrPort };
}

export type OcrRunRow = typeof schema.ocrRuns.$inferSelect;

export interface RunOcrSummary {
  readonly ocrRun: OcrRunRow;
}

type OcrReservation =
  | { readonly kind: 'final'; readonly outcome: Result<RunOcrSummary, ServiceError> }
  | {
      readonly kind: 'proceed';
      readonly runId: string;
      readonly cacheKey: string;
      readonly charge: AiFeatureCharge | null;
    };

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
 *
 * Cross-provider fallback (Part 8 §13, `input.fallback`): identical
 * triggering/eligibility rules to `runExtraction`'s own -- see that
 * function's doc comment for the full reasoning, not repeated here.
 */
async function reserveOcrSlot(
  db: Db,
  ai: AiOcrPort,
  input: RunOcrInput,
  gate: AiFeatureGate | null,
  triggeredByRunId?: string,
): Promise<OcrReservation> {
  return db.transaction(async (tx): Promise<OcrReservation> => {
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
            // Reuse stays inside one person's records: another applicant's identical text is read afresh.
            eq(schema.ocrRuns.applicantId, input.applicantId),
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
              ...(triggeredByRunId ? { triggeredByRunId } : {}),
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

    // The feature's use today is counted here, last, once every other check has passed and a
    // real call is certain: a cache hit, a refusal or a fallback attempt is never counted (S28).
    const charge = gate ? await chargeAiFeatureUse(tx, gate) : null;
    if (gate && !charge) {
      return { kind: 'final', outcome: err(aiDailyLimitRefusal(gate)) };
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
            ...(triggeredByRunId ? { triggeredByRunId } : {}),
          })
          .returning(),
      ),
      'ocr run',
    );

    return { kind: 'proceed', runId: run.id, cacheKey, charge };
  });
}

interface OcrDispatchResult {
  /** Raw adapter outcome, so a caller can inspect its error code to decide whether to attempt a fallback. */
  readonly outcome: AiOcrOutcome;
  readonly result: Result<RunOcrSummary, ServiceError>;
}

/** Phases 2 (CALL) and 3 (RECONCILE), factored out for the identical reason as `reserveOcrSlot` -- reused unchanged for a fallback attempt. */
async function dispatchAndReconcileOcr(
  db: Db,
  ai: AiOcrPort,
  input: RunOcrInput,
  runId: string,
  cacheKey: string,
): Promise<OcrDispatchResult> {
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

  const result = await db.transaction(async (tx) => {
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
  return { outcome, result };
}

/** Part 8 §13: identical rule to `isRecoverableForFallback` above, mirrored for OCR's own error-code type. */
function isOcrRecoverableForFallback(code: AiOcrErrorCode): boolean {
  return code === 'timeout' || code === 'rate_limited';
}

export async function runOcr(
  db: Db,
  ai: AiOcrPort,
  input: RunOcrInput,
): Promise<Result<RunOcrSummary, ServiceError>> {
  const owned = await loadOwnedApplicant(db, input);
  if (!owned.ok) return err(owned.error);
  const applicant = owned.value;
  // The feature first (S28), then consent, then the spend and attempt limits.
  const gate = await openAiFeatureGate(db, input.feature, aiOwnerContext(applicant.ownerAccountId));
  if (!gate.ok) return err(aiFeatureRefusal(gate.error));
  if (!(await hasConsent(db, applicant.ownerAccountId, 'AI_OCR'))) {
    return err(serviceError('consent_required', 'AI OCR consent is required'));
  }

  const rateLimited = await aiRateLimitRefusal(db, input.actorAccountId);
  if (rateLimited) return err(rateLimited);

  const reservation = await reserveOcrSlot(db, ai, input, gate.value);
  if (reservation.kind === 'final') return reservation.outcome;

  const primary = await dispatchAndReconcileOcr(
    db,
    ai,
    input,
    reservation.runId,
    reservation.cacheKey,
  );
  // A scan that made a real call stays counted whatever happens next (S28 round 3); only one the
  // kill switch stopped before any call is given back.
  await refundIfSwitchedOff(db, reservation.charge, primary.outcome);
  // A counted scan that read text leaves one cover for this file's details (S28 round 5), from
  // whichever provider answered; a scan that failed or read nothing leaves none.
  const covered = async (
    result: Result<RunOcrSummary, ServiceError>,
  ): Promise<Result<RunOcrSummary, ServiceError>> => {
    if (result.ok && (result.value.ocrRun.extractedText ?? '').trim().length > 0) {
      await leaveScanCover(db, reservation.charge, input.documentVersionId);
    }
    return result;
  };
  if (primary.outcome.ok) return covered(primary.result);
  if (!input.fallback || !isOcrRecoverableForFallback(primary.outcome.code)) return primary.result;

  // Cross-provider fallback (Part 8 §13) -- see `runExtraction`'s own doc
  // comment for why this second reservation is an honest, independent check
  // rather than a race against the (already fully reconciled) primary.
  const fallbackReservation = await reserveOcrSlot(
    db,
    input.fallback.ai,
    input,
    null,
    reservation.runId,
  );
  if (fallbackReservation.kind === 'final') return covered(fallbackReservation.outcome);

  const fallback = await dispatchAndReconcileOcr(
    db,
    input.fallback.ai,
    input,
    fallbackReservation.runId,
    fallbackReservation.cacheKey,
  );
  return covered(fallback.result);
}

/**
 * The most recent SUCCEEDED OCR run for a document version, for display.
 * Mirrors `getLatestExtractedText`'s own shape (`intake.ts`), but returns
 * the FULL row rather than just the text: Part 8 §9's own requirement is to
 * "show ... as review issues" alongside the text, not the text alone, so a
 * caller needs `reviewIssues` too, not just `extractedText`.
 */
export async function getLatestOcrRun(
  db: Db,
  documentVersionId: string,
): Promise<OcrRunRow | undefined> {
  return first(
    await db
      .select()
      .from(schema.ocrRuns)
      .where(
        and(
          eq(schema.ocrRuns.documentVersionId, documentVersionId),
          eq(schema.ocrRuns.status, 'SUCCEEDED'),
        ),
      )
      .orderBy(desc(schema.ocrRuns.createdAt))
      .limit(1),
  );
}

const TRUSTED_FACT_STATUSES: readonly FactStatus[] = [
  'APPLICANT_CONFIRMED',
  'DOCUMENT_SUPPORTED',
  'AGENCY_REVIEWED',
];

/** Whether a saved value is one the person or a reviewer stands behind (a reading may not overwrite it silently). */
export function isTrustedFactStatus(status: FactStatus): boolean {
  return TRUSTED_FACT_STATUSES.includes(status);
}

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

/** Carries a refusal out of a transaction so everything written inside it is rolled back. */
class DecisionAborted extends Error {
  constructor(readonly result: Result<unknown, ServiceError>) {
    super('decision aborted');
  }
}

/**
 * Whether a reading differs from a value the person or a reviewer stands behind. A protected
 * value is decrypted to compare when a key service is given; without one it counts as different,
 * so nothing is ever assumed equal.
 */
async function differsFromTrusted(
  db: Db,
  current: FactVersion | undefined,
  value: string | null,
  encryption?: KeyManagementPort,
): Promise<boolean> {
  if (!current || !TRUSTED_FACT_STATUSES.includes(current.status)) return false;
  if (current.protectedKeyVersion !== null) {
    if (!encryption) return true;
    const revealed = await revealFactVersionValue(db, encryption, current);
    return !revealed.ok || revealed.value !== value;
  }
  return current.value !== value;
}

export interface ApproveProposalInput {
  readonly actorAccountId: string;
  readonly proposalId: string;
  /**
   * How the person settled a difference with the value already on file: take the document's
   * value, or keep both because the detail changed (then `effectiveFrom` says when). Without a
   * resolution a difference is saved as CONFLICTED with a conflict record, as before.
   */
  readonly resolution?: 'use_document' | 'changed';
  readonly effectiveFrom?: Date;
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
  if (input.resolution === 'changed' && !input.effectiveFrom) {
    return err(serviceError('invalid', 'say when the detail changed'));
  }
  if (input.resolution === 'changed' && proposal.fieldKey && isFixedFieldKey(proposal.fieldKey)) {
    return err(serviceError('invalid', 'this detail does not change over time'));
  }

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
  // A suggestion the person's own AI app made (S21) is the person's word once they accept it, not
  // something a document shows: it is saved as confirmed by them, entered by hand, with no source
  // document, whatever document the app named.
  const fromApp = isConnectorModelVersion(run.modelVersion);
  const sourceDocumentVersionId = proposal.documentVersionId;
  if (!fromApp && sourceDocumentVersionId === null) {
    return err(serviceError('invalid', 'proposal has no document to approve from'));
  }

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
      (await differsFromTrusted(db, currentVersion, finalValue, input.encryption))
    ) {
      conflict = { factId: existingFactId, previousFactVersionId: currentVersion.id };
    }
  }
  // The person looked at both values and chose: nothing is left to settle.
  if (input.resolution) conflict = undefined;

  // Atomic approval (master directive §7 "PR 8"): the fact write and the
  // proposal decision (status, correction feedback, conflict record) must
  // commit or roll back together. editFact runs its own transaction — nested
  // here as a savepoint within this one — so a failure writing the proposal
  // decision AFTER the fact has already changed rolls back the fact change
  // too, instead of leaving the proposal stuck PENDING forever against an
  // already-mutated profile.
  // The decision is claimed first, inside the transaction: of two decisions on the same reading
  // (two tabs, two devices), only one finds it still pending; the other changes nothing.
  try {
    return await db.transaction(async (tx) => {
      const claimed = await tx
        .update(schema.fieldProposals)
        .set({
          status: 'APPROVED',
          decidedByAccountId: input.actorAccountId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(schema.fieldProposals.id, proposal.id),
            eq(schema.fieldProposals.status, 'PENDING'),
          ),
        )
        .returning({ id: schema.fieldProposals.id });
      if (claimed.length === 0) {
        throw new DecisionAborted(
          err(serviceError('invalid', 'this proposal has already been decided')),
        );
      }
      const editResult = await editFact(tx, {
        actorAccountId: input.actorAccountId,
        applicantId: proposal.applicantId,
        fieldKey,
        value: finalValue,
        status: conflict ? 'CONFLICTED' : fromApp ? 'APPLICANT_CONFIRMED' : 'DOCUMENT_SUPPORTED',
        method: fromApp ? 'MANUAL' : 'DOCUMENT',
        ...(!fromApp && sourceDocumentVersionId ? { sourceDocumentVersionId } : {}),
        modelVersion: run.modelVersion,
        promptVersion: run.promptVersion,
        reason: fromApp ? 'ai_app_suggestion_approved' : 'ai_proposal_approved',
        ...(input.resolution === 'changed' && input.effectiveFrom
          ? { effectiveFrom: input.effectiveFrom }
          : {}),
        ...(repeatingRecordKey ? { repeatingRecordKey } : {}),
        ...(input.encryption ? { encryption: input.encryption } : {}),
      });
      // Undo the claim with everything else when the write is refused.
      if (!isOk(editResult)) throw new DecisionAborted(editResult);

      const { version } = editResult.value;
      await tx
        .update(schema.fieldProposals)
        .set({ factVersionId: version.id })
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
          note: fromApp
            ? `An AI app suggested "${finalValue}" but the current confirmed value differs`
            : `AI proposed "${finalValue}" but the current confirmed value differs`,
        });
      }

      // OPS-04 AI acceptance/correction: whether the reviewer took the proposal
      // as given or changed it first. The values themselves (the proposal and the
      // correction) stay in `correction_feedback` and never reach analytics.
      await recordProductEvent(tx, {
        eventType:
          correctedValue && correctedValue !== proposal.value
            ? 'AI_PROPOSAL_CORRECTED'
            : 'AI_PROPOSAL_ACCEPTED',
        accountId: input.actorAccountId,
        dimension: fromApp ? 'CONNECTOR' : 'EXTRACTION',
      });

      return editResult;
    });
  } catch (error) {
    if (error instanceof DecisionAborted)
      return error.result as Result<EditFactResult, ServiceError>;
    throw error;
  }
}

/**
 * A reading counts as clear when the model was confident, every quoted phrase was found word for
 * word in the document's own text, and the value itself appears in one of those phrases. Anything
 * else asks the person to look closely.
 */
export const CLEAR_PROPOSAL_CONFIDENCE = 85;

// The filler between names in a passport's machine-readable lines counts as a space.
const normaliseForMatch = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s<]+/g, ' ')
    .trim();

export function isClearReading(
  proposal: {
    readonly type: string;
    readonly fieldKey: string | null;
    readonly value: string | null;
    readonly confidence: number;
  },
  evidence: readonly { readonly verified: boolean | null; readonly snippet: string }[],
): boolean {
  const value = proposal.value ? normaliseForMatch(proposal.value) : '';
  return (
    proposal.type !== 'UNMAPPED' &&
    Boolean(proposal.fieldKey) &&
    value.length > 0 &&
    proposal.confidence >= CLEAR_PROPOSAL_CONFIDENCE &&
    evidence.length > 0 &&
    evidence.every((item) => item.verified === true) &&
    evidence.some((item) => normaliseForMatch(item.snippet).includes(value))
  );
}

export interface ApproveClearProposalsInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly proposalIds: readonly string[];
  readonly encryption?: KeyManagementPort;
}

export interface ApproveClearProposalsResult {
  readonly approved: number;
  /** Readings that are not clear, are sensitive, belong to a repeating record, or differ from a confirmed value. */
  readonly leftForReview: number;
  /** Readings already decided (another tab, a double press): not counted as waiting. */
  readonly alreadyDecided: number;
}

/**
 * "Accept all clear details" for one person: approves, one by one through `approveProposal`, only
 * clear readings for an everyday (STANDARD) field that is not part of a repeating record and does
 * not differ from a confirmed value. Every other reading stays pending for a one-at-a-time
 * decision. The page's choice of ids is never trusted: each rule is checked again here. When
 * nothing could be saved because of a refusal (consent withdrawn, for example), that refusal is
 * returned rather than a count.
 */
export async function approveClearProposals(
  db: Db,
  input: ApproveClearProposalsInput,
): Promise<Result<ApproveClearProposalsResult, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to decide these proposals'));
  }
  const ids = [...new Set(input.proposalIds)];
  if (ids.length === 0) return ok({ approved: 0, leftForReview: 0, alreadyDecided: 0 });
  // Loaded together, once, rather than one query per reading.
  const proposals = await db
    .select()
    .from(schema.fieldProposals)
    .where(
      and(
        inArray(schema.fieldProposals.id, ids),
        eq(schema.fieldProposals.applicantId, input.applicantId),
      ),
    );
  const evidence = proposals.length
    ? await db
        .select({
          fieldProposalId: schema.evidenceLocations.fieldProposalId,
          verified: schema.evidenceLocations.verified,
          snippet: schema.evidenceLocations.snippet,
        })
        .from(schema.evidenceLocations)
        .where(
          inArray(
            schema.evidenceLocations.fieldProposalId,
            proposals.map((proposal) => proposal.id),
          ),
        )
    : [];
  const keys = [
    ...new Set(proposals.flatMap((proposal) => (proposal.fieldKey ? [proposal.fieldKey] : []))),
  ];
  const definitions = keys.length
    ? await db
        .select({
          key: schema.fieldDefinitions.key,
          sensitivity: schema.fieldDefinitions.sensitivity,
        })
        .from(schema.fieldDefinitions)
        .where(inArray(schema.fieldDefinitions.key, keys))
    : [];
  const sensitivityOf = new Map(definitions.map((row) => [row.key, row.sensitivity] as const));
  // An AI app's suggestion (S21) is never accepted in bulk, whatever the page sent: each one is
  // looked at and decided on its own.
  const runIds = [...new Set(proposals.map((proposal) => proposal.aiExtractionRunId))];
  const fromApp = new Set(
    runIds.length
      ? (
          await db
            .select({
              id: schema.aiExtractionRuns.id,
              modelVersion: schema.aiExtractionRuns.modelVersion,
            })
            .from(schema.aiExtractionRuns)
            .where(inArray(schema.aiExtractionRuns.id, runIds))
        )
          .filter((run) => isConnectorModelVersion(run.modelVersion))
          .map((run) => run.id)
      : [],
  );

  let approved = 0;
  let leftForReview = ids.length - proposals.length;
  let alreadyDecided = 0;
  let refusal: ServiceError | undefined;
  for (const proposal of proposals) {
    if (proposal.status !== 'PENDING') {
      alreadyDecided += 1;
      continue;
    }
    const fieldKey = proposal.fieldKey;
    const quotes = evidence.filter((item) => item.fieldProposalId === proposal.id);
    if (
      !fieldKey ||
      fromApp.has(proposal.aiExtractionRunId) ||
      !isClearReading(proposal, quotes) ||
      sensitivityOf.get(fieldKey) !== 'STANDARD' ||
      isRepeatingFieldKey(fieldKey)
    ) {
      leftForReview += 1;
      continue;
    }
    const existingFactId = await findExistingFactId(db, proposal.applicantId, fieldKey, null);
    const current = existingFactId ? await getCurrentFactVersion(db, existingFactId) : undefined;
    if (await differsFromTrusted(db, current, proposal.value, input.encryption)) {
      leftForReview += 1;
      continue;
    }
    const result = await approveProposal(db, {
      actorAccountId: input.actorAccountId,
      proposalId: proposal.id,
      ...(input.encryption ? { encryption: input.encryption } : {}),
    });
    if (result.ok) {
      approved += 1;
    } else if (result.error.message === 'this proposal has already been decided') {
      alreadyDecided += 1;
    } else {
      refusal ??= result.error;
      leftForReview += 1;
    }
  }
  if (approved === 0 && refusal) return err(refusal);
  return ok({ approved, leftForReview, alreadyDecided });
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
    // Only a still-pending reading can be set aside: a decision made meanwhile elsewhere wins.
    const updated = first(
      await tx
        .update(schema.fieldProposals)
        .set({
          status: 'REJECTED',
          decidedByAccountId: input.actorAccountId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(schema.fieldProposals.id, input.proposalId),
            eq(schema.fieldProposals.status, 'PENDING'),
          ),
        )
        .returning(),
    );
    if (!updated) return err(serviceError('invalid', 'this proposal has already been decided'));
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
    const run = first(
      await tx
        .select({ modelVersion: schema.aiExtractionRuns.modelVersion })
        .from(schema.aiExtractionRuns)
        .where(eq(schema.aiExtractionRuns.id, proposal.aiExtractionRunId))
        .limit(1),
    );
    await recordProductEvent(tx, {
      eventType: 'AI_PROPOSAL_REJECTED',
      accountId: input.actorAccountId,
      dimension: isConnectorModelVersion(run?.modelVersion) ? 'CONNECTOR' : 'EXTRACTION',
    });
    return ok(updated);
  });
}

export type EvidenceLocationRow = typeof schema.evidenceLocations.$inferSelect;

/** The AI app a suggestion came from (S21): its name as it was stored, and its web address. */
export interface ProposalApp {
  /** The app's name, or null when its connection is gone. Cleaned again before it is shown. */
  readonly name: string | null;
  readonly host: string;
}

export interface ProposalWithEvidence {
  readonly proposal: FieldProposalRow;
  readonly evidence: readonly EvidenceLocationRow[];
  /** Set when the person's own AI app made this suggestion through its connection. */
  readonly fromApp?: ProposalApp;
}

/** Pending proposals for an applicant (the review queue), newest first. */
export async function listPendingProposals(
  db: Db,
  applicantId: string,
): Promise<ProposalWithEvidence[]> {
  const rows = await db
    .select({
      proposal: schema.fieldProposals,
      modelVersion: schema.aiExtractionRuns.modelVersion,
      promptVersion: schema.aiExtractionRuns.promptVersion,
    })
    .from(schema.fieldProposals)
    .innerJoin(
      schema.aiExtractionRuns,
      eq(schema.aiExtractionRuns.id, schema.fieldProposals.aiExtractionRunId),
    )
    .where(
      and(
        eq(schema.fieldProposals.applicantId, applicantId),
        eq(schema.fieldProposals.status, 'PENDING'),
      ),
    )
    .orderBy(desc(schema.fieldProposals.createdAt));

  // The apps behind connector suggestions, by connection, read once, from this record only.
  const connectionIds = [
    ...new Set(rows.flatMap((row) => connectionIdOfRun(row) ?? [])),
  ] as string[];
  const appNames = new Map<string, string>(
    connectionIds.length
      ? (
          await db
            .select({ id: schema.aiConnections.id, name: schema.aiConnections.clientName })
            .from(schema.aiConnections)
            .where(
              and(
                inArray(schema.aiConnections.id, connectionIds),
                eq(schema.aiConnections.applicantId, applicantId),
              ),
            )
        ).map((row) => [row.id, row.name] as const)
      : [],
  );

  const result: ProposalWithEvidence[] = [];
  for (const row of rows) {
    const { proposal } = row;
    const evidence = await db
      .select()
      .from(schema.evidenceLocations)
      .where(eq(schema.evidenceLocations.fieldProposalId, proposal.id));
    const connectionId = connectionIdOfRun(row);
    result.push({
      proposal,
      evidence,
      ...(isConnectorModelVersion(row.modelVersion)
        ? {
            fromApp: {
              name: connectionId ? (appNames.get(connectionId) ?? null) : null,
              host: row.modelVersion.slice(CONNECTOR_MODEL_PREFIX.length),
            },
          }
        : {}),
    });
  }
  return result;
}

// --- AI-assisted readiness-gap explanation (Part 8 AI-01 item 5) ----------
//
// Read-only: `explainReadinessGap` writes only its own `ai_explanation_runs`
// row, never anything else -- there is no proposal/approval step, since an
// explanation is advisory TEXT with no consequential write of its own to
// decide on (directive's own "No: ... direct consequential DB writes by
// model"). Co-located here for the same shared-budget-ledger reason
// `runOcr`'s own doc comment already gives for OCR.
const EXPLAIN_TASK_VERSION = 'readiness_gap_explanation_v1';

function computeExplanationCacheKey(
  input: AiExplainInput,
  components: AiCacheKeyComponents,
): string {
  const parts = [
    EXPLAIN_TASK_VERSION,
    input.requirementKind,
    input.requirementKey,
    input.state,
    input.citation,
    String(input.optional),
    components.model,
    components.promptVersion,
    components.schemaVersion,
    components.reasoningEffort ?? '',
    ...providerKeyPart(components),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface RunExplanationInput extends AiExplainInput {
  /**
   * Who is asking. Explanation is not applicant- or document-scoped (so there is
   * no ownership or consent check keyed on this), but it still spends provider
   * budget, so the caller needs an identity to rate-limit against (Part 9 §6).
   */
  readonly actorAccountId: string;
  readonly packRequirementId: string;
  readonly budgetLimitUnits: number;
  readonly maxConcurrentCalls?: number;
  readonly cacheMaxAgeDays?: number;
  readonly killSwitchCheck?: () => Promise<boolean>;
}

export type AiExplanationRunRow = typeof schema.aiExplanationRuns.$inferSelect;

export interface RunExplanationSummary {
  readonly aiExplanationRunId: string;
  readonly explanation: string;
}

type ExplanationReservation =
  | { readonly kind: 'final'; readonly outcome: Result<RunExplanationSummary, ServiceError> }
  | {
      readonly kind: 'proceed';
      readonly runId: string;
      readonly cacheKey: string;
      readonly charge: AiFeatureCharge | null;
    };

/**
 * Phase 1 (RESERVE) -- structurally mirrors `reserveExtractionSlot`, minus
 * every per-document/per-applicant check (attempt cap, per-document budget,
 * page cap): none apply to a task that is not scoped to a document at all.
 * Still takes the SAME platform-wide budget/concurrency lock, since real
 * spend and a real provider-side concurrency limit apply regardless.
 */
async function reserveExplanationSlot(
  db: Db,
  ai: AiExplainPort,
  input: RunExplanationInput,
  gate: AiFeatureGate | null,
): Promise<ExplanationReservation> {
  return db.transaction(async (tx): Promise<ExplanationReservation> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('visastack:ai-platform-budget'))`);

    await releaseStaleInFlightCalls(tx);

    const worstCase = await maxObservedCostUnits(tx);
    const inFlightPlatform = await countInFlightCalls(tx);

    const used = (await totalAiCostUnits(tx)) + (inFlightPlatform + 1) * worstCase;
    if (used >= input.budgetLimitUnits) {
      return { kind: 'final', outcome: err(serviceError('invalid', 'AI budget exhausted')) };
    }

    const cacheKey = computeExplanationCacheKey(input, ai.explainCacheKeyComponents());
    const cacheMaxAgeDays = input.cacheMaxAgeDays ?? DEFAULT_CACHE_MAX_AGE_DAYS;
    const cacheCutoff = new Date(Date.now() - cacheMaxAgeDays * 24 * 60 * 60 * 1000);
    const cached = first(
      await tx
        .select()
        .from(schema.aiExplanationRuns)
        .where(
          and(
            eq(schema.aiExplanationRuns.cacheKey, cacheKey),
            eq(schema.aiExplanationRuns.status, 'SUCCEEDED'),
            gte(schema.aiExplanationRuns.createdAt, cacheCutoff),
          ),
        )
        .orderBy(desc(schema.aiExplanationRuns.createdAt))
        .limit(1),
    );

    if (cached) {
      const run = required(
        first(
          await tx
            .insert(schema.aiExplanationRuns)
            .values({
              packRequirementId: input.packRequirementId,
              status: 'SUCCEEDED',
              modelVersion: cached.modelVersion,
              promptVersion: cached.promptVersion,
              schemaVersion: cached.schemaVersion,
              costUnits: 0,
              provider: cached.provider,
              cacheKey,
              servedFromCacheRunId: cached.id,
              explanation: cached.explanation,
            })
            .returning(),
        ),
        'ai explanation run',
      );
      return {
        kind: 'final',
        outcome: ok({ aiExplanationRunId: run.id, explanation: run.explanation ?? '' }),
      };
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

    // The feature's use today is counted here, last, once every other check has passed and a
    // real call is certain: a cache hit, a refusal or a fallback attempt is never counted (S28).
    const charge = gate ? await chargeAiFeatureUse(tx, gate) : null;
    if (gate && !charge) {
      return { kind: 'final', outcome: err(aiDailyLimitRefusal(gate)) };
    }

    const run = required(
      first(
        await tx
          .insert(schema.aiExplanationRuns)
          .values({
            packRequirementId: input.packRequirementId,
            status: 'IN_FLIGHT',
            modelVersion: 'unknown',
            promptVersion: 'unknown',
          })
          .returning(),
      ),
      'ai explanation run',
    );

    return { kind: 'proceed', runId: run.id, cacheKey, charge };
  });
}

interface ExplanationDispatchResult {
  readonly outcome: AiExplainOutcome;
  readonly result: Result<RunExplanationSummary, ServiceError>;
}

/** Phases 2 (CALL) and 3 (RECONCILE) -- structurally mirrors `dispatchAndReconcile`. */
async function dispatchAndReconcileExplanation(
  db: Db,
  ai: AiExplainPort,
  input: RunExplanationInput,
  runId: string,
  cacheKey: string,
): Promise<ExplanationDispatchResult> {
  const killSwitchAllows = input.killSwitchCheck ? await input.killSwitchCheck() : true;

  const outcome: AiExplainOutcome = killSwitchAllows
    ? await ai.explain(input)
    : { ok: false, code: 'disabled', message: 'AI explanation is currently disabled' };

  const result = await db.transaction(async (tx) => {
    if (!outcome.ok) {
      await tx
        .update(schema.aiExplanationRuns)
        .set({
          status: 'FAILED',
          provider: outcome.provider ?? null,
          latencyMs: outcome.latencyMs ?? null,
          errorCode: outcome.code,
        })
        .where(eq(schema.aiExplanationRuns.id, runId));
      await appendAuditEvent(tx, {
        eventType: 'AI_EXPLANATION_FAILED',
        actorAccountId: null,
        method: 'SYSTEM',
        result: 'ALLOWED',
        applicantId: null,
        resourceType: 'pack_requirement',
        resourceId: input.packRequirementId,
        metadata: { errorCode: outcome.code, aiExplanationRunId: runId },
      });
      return err(
        serviceError(outcome.code === 'disabled' ? 'invalid' : 'upstream_error', outcome.message),
      );
    }

    const { explanation, usage } = outcome.result;

    await tx
      .update(schema.aiExplanationRuns)
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
        explanation,
      })
      .where(eq(schema.aiExplanationRuns.id, runId));

    await appendAuditEvent(tx, {
      eventType: 'AI_EXPLANATION_RUN',
      actorAccountId: null,
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId: null,
      resourceType: 'pack_requirement',
      resourceId: input.packRequirementId,
      metadata: {
        aiExplanationRunId: runId,
        costUnits: usage.costUnits,
        modelVersion: usage.modelVersion,
        provider: usage.provider,
        latencyMs: usage.latencyMs,
      },
    });

    return ok({ aiExplanationRunId: runId, explanation });
  });
  return { outcome, result };
}

/**
 * Explain an already-determined deterministic readiness gap (Part 8 AI-01
 * item 5) in plain language, grounded in the requirement's own citation --
 * never a new determination of readiness itself, which remains entirely
 * `computeReadiness`'s (`missions.ts`) job. No consent gate (see
 * `AiExplainInput`'s own doc comment: no applicant-specific data is ever
 * sent), and no ownership check here either -- the caller (the web action)
 * is responsible for verifying the actor may view whichever mission surfaced
 * this `packRequirementId`'s CURRENT state before ever calling this.
 */
export async function explainReadinessGap(
  db: Db,
  ai: AiExplainPort,
  input: RunExplanationInput,
): Promise<Result<RunExplanationSummary, ServiceError>> {
  // The feature first (S28): the person asking's plan and count (no record data is sent).
  const gate = await openAiFeatureGate(db, 'ai_explanations', aiOwnerContext(input.actorAccountId));
  if (!gate.ok) return err(aiFeatureRefusal(gate.error));

  const rateLimited = await aiRateLimitRefusal(db, input.actorAccountId);
  if (rateLimited) return err(rateLimited);

  const reservation = await reserveExplanationSlot(db, ai, input, gate.value);
  if (reservation.kind === 'final') return reservation.outcome;

  const dispatched = await dispatchAndReconcileExplanation(
    db,
    ai,
    input,
    reservation.runId,
    reservation.cacheKey,
  );
  await refundIfSwitchedOff(db, reservation.charge, dispatched.outcome);
  return dispatched.result;
}

/** The most recent successful explanation generated for this specific pack requirement, for display -- mirrors `getLatestOcrRun`'s identical shape. */
export async function getLatestExplanationForRequirement(
  db: Db,
  packRequirementId: string,
): Promise<AiExplanationRunRow | undefined> {
  return first(
    await db
      .select()
      .from(schema.aiExplanationRuns)
      .where(
        and(
          eq(schema.aiExplanationRuns.packRequirementId, packRequirementId),
          eq(schema.aiExplanationRuns.status, 'SUCCEEDED'),
        ),
      )
      .orderBy(desc(schema.aiExplanationRuns.createdAt))
      .limit(1),
  );
}

// --- AI-assisted inconsistency flagging (Part 8 AI-01 item 4) -------------
//
// Advisory only, exactly like extraction/classification: `runInconsistencyCheck`
// never writes a fact, never resolves a conflict, and never implies which
// side (document or profile) is actually correct -- only that a human
// should look. Co-located here for the identical shared-budget-ledger
// reason `runOcr`'s own doc comment gives.
const INCONSISTENCY_TASK_VERSION = 'inconsistency_flag_v1';

/**
 * Every CURRENTLY TRUSTED, STANDARD-sensitivity profile fact for this
 * applicant -- the context sent alongside a document's text so the model can
 * spot a possible contradiction. Deliberately excludes SENSITIVE/RESTRICTED
 * fields: `fact_versions.value` is only ever populated (non-null) for
 * STANDARD-sensitivity rows in the first place (a protected row's real value
 * lives only in `valueCiphertext`, per that column's own doc comment), so
 * filtering on a non-null `value` already excludes every protected field
 * with no separate sensitivity join needed -- this task never sends a
 * SENSITIVE/RESTRICTED value to a model, a materially larger disclosure than
 * AI_EXTRACTION consent already covers.
 */
async function currentTrustedProfileFacts(
  db: Db,
  applicantId: string,
): Promise<readonly { readonly fieldKey: string; readonly value: string }[]> {
  const rows = await db
    .select({
      fieldKey: schema.fieldDefinitions.key,
      value: schema.factVersions.value,
      status: schema.factVersions.status,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.facts.fieldDefinitionId, schema.fieldDefinitions.id),
    )
    .innerJoin(schema.factVersions, eq(schema.facts.currentVersionId, schema.factVersions.id))
    .where(eq(schema.facts.applicantId, applicantId));
  return rows
    .filter(
      (r): r is typeof r & { value: string } =>
        r.value !== null && TRUSTED_FACT_STATUSES.includes(r.status),
    )
    .map((r) => ({ fieldKey: r.fieldKey, value: r.value }));
}

/**
 * Cache key for an inconsistency check -- unlike every other task's, this
 * folds in a hash of the PROFILE FACTS snapshot alongside the document
 * content hash (see `ai_inconsistency_runs.cacheKey`'s own schema doc
 * comment for why both matter): the correct answer genuinely depends on
 * both, and a stale cache hit computed against facts the applicant has
 * since corrected would silently re-serve a flag about a contradiction that
 * no longer exists.
 */
function computeInconsistencyCacheKey(
  contentHash: string,
  profileFacts: readonly { readonly fieldKey: string; readonly value: string }[],
  cacheKeyComponents: AiCacheKeyComponents,
): string {
  const factsHash = createHash('sha256')
    .update(
      [...profileFacts]
        .map((f) => `${f.fieldKey}=${f.value}`)
        .sort()
        .join('|'),
    )
    .digest('hex');
  const parts = [
    contentHash,
    factsHash,
    INCONSISTENCY_TASK_VERSION,
    cacheKeyComponents.model,
    cacheKeyComponents.promptVersion,
    cacheKeyComponents.schemaVersion,
    cacheKeyComponents.reasoningEffort ?? '',
    ...providerKeyPart(cacheKeyComponents),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export type DocumentInconsistencyFlagRow = typeof schema.documentInconsistencyFlags.$inferSelect;

export interface RunInconsistencyCheckInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly documentVersionId: string;
  readonly text: string;
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits?: number;
  readonly maxAttemptsPerDocument?: number;
  readonly maxPagesPerDocument?: number;
  readonly maxConcurrentCalls?: number;
  readonly cacheMaxAgeDays?: number;
  readonly killSwitchCheck?: () => Promise<boolean>;
}

export interface RunInconsistencyCheckSummary {
  readonly aiInconsistencyRunId: string;
  readonly flags: readonly DocumentInconsistencyFlagRow[];
}

type InconsistencyReservation =
  | { readonly kind: 'final'; readonly outcome: Result<RunInconsistencyCheckSummary, ServiceError> }
  | {
      readonly kind: 'proceed';
      readonly runId: string;
      readonly profileFacts: readonly { readonly fieldKey: string; readonly value: string }[];
      readonly cacheKey: string;
      readonly charge: AiFeatureCharge | null;
    };

/** Phase 1 (RESERVE) -- structurally mirrors `reserveExtractionSlot`; see that function's own doc comment (on `runExtraction`) for the full reasoning behind every check and lock here. */
async function reserveInconsistencySlot(
  db: Db,
  ai: AiInconsistencyPort,
  input: RunInconsistencyCheckInput,
  gate: AiFeatureGate | null,
): Promise<InconsistencyReservation> {
  return db.transaction(async (tx): Promise<InconsistencyReservation> => {
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
    if (input.maxPagesPerDocument !== undefined) {
      const pageCount = await latestPageCount(tx, input.documentVersionId);
      if (pageCount !== null && pageCount > input.maxPagesPerDocument) {
        return {
          kind: 'final',
          outcome: err(
            serviceError(
              'invalid',
              'document exceeds the configured page limit for AI inconsistency checking',
            ),
          ),
        };
      }
    }

    const profileFacts = await currentTrustedProfileFacts(tx, input.applicantId);
    const contentHash = createHash('sha256').update(input.text).digest('hex');
    const cacheKey = computeInconsistencyCacheKey(
      contentHash,
      profileFacts,
      ai.inconsistencyCacheKeyComponents(),
    );

    const cacheMaxAgeDays = input.cacheMaxAgeDays ?? DEFAULT_CACHE_MAX_AGE_DAYS;
    const cacheCutoff = new Date(Date.now() - cacheMaxAgeDays * 24 * 60 * 60 * 1000);
    const cached = first(
      await tx
        .select()
        .from(schema.aiInconsistencyRuns)
        .where(
          and(
            eq(schema.aiInconsistencyRuns.cacheKey, cacheKey),
            // Reuse stays inside one person's records: another applicant's identical text is read afresh.
            eq(schema.aiInconsistencyRuns.applicantId, input.applicantId),
            eq(schema.aiInconsistencyRuns.status, 'SUCCEEDED'),
            gte(schema.aiInconsistencyRuns.createdAt, cacheCutoff),
          ),
        )
        .orderBy(desc(schema.aiInconsistencyRuns.createdAt))
        .limit(1),
    );

    if (cached) {
      const run = required(
        first(
          await tx
            .insert(schema.aiInconsistencyRuns)
            .values({
              documentVersionId: input.documentVersionId,
              applicantId: input.applicantId,
              status: 'SUCCEEDED',
              modelVersion: cached.modelVersion,
              promptVersion: cached.promptVersion,
              schemaVersion: cached.schemaVersion,
              costUnits: 0,
              provider: cached.provider,
              cacheKey,
              servedFromCacheRunId: cached.id,
            })
            .returning(),
        ),
        'ai inconsistency run',
      );
      const sourceFlags = await tx
        .select()
        .from(schema.documentInconsistencyFlags)
        .where(eq(schema.documentInconsistencyFlags.aiInconsistencyRunId, cached.id));
      const savedFlags: DocumentInconsistencyFlagRow[] = [];
      for (const source of sourceFlags) {
        savedFlags.push(
          required(
            first(
              await tx
                .insert(schema.documentInconsistencyFlags)
                .values({
                  aiInconsistencyRunId: run.id,
                  documentVersionId: input.documentVersionId,
                  applicantId: input.applicantId,
                  description: source.description,
                  confidence: source.confidence,
                  rationale: source.rationale,
                })
                .returning(),
            ),
            'document inconsistency flag',
          ),
        );
      }
      await appendAuditEvent(tx, {
        eventType: 'AI_INCONSISTENCY_CACHE_HIT',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { aiInconsistencyRunId: run.id, servedFromCacheRunId: cached.id, cacheKey },
      });
      return {
        kind: 'final',
        outcome: ok({ aiInconsistencyRunId: run.id, flags: savedFlags }),
      };
    }

    if (input.maxAttemptsPerDocument !== undefined) {
      const attempts = await countAiInconsistencyAttempts(tx, input.documentVersionId);
      if (attempts >= input.maxAttemptsPerDocument) {
        return {
          kind: 'final',
          outcome: err(
            serviceError(
              'invalid',
              'AI inconsistency check attempt limit reached for this document',
            ),
          ),
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

    // The feature's use today is counted here, last, once every other check has passed and a
    // real call is certain: a cache hit, a refusal or a fallback attempt is never counted (S28).
    const charge = gate ? await chargeAiFeatureUse(tx, gate) : null;
    if (gate && !charge) {
      return { kind: 'final', outcome: err(aiDailyLimitRefusal(gate)) };
    }

    const run = required(
      first(
        await tx
          .insert(schema.aiInconsistencyRuns)
          .values({
            documentVersionId: input.documentVersionId,
            applicantId: input.applicantId,
            status: 'IN_FLIGHT',
            modelVersion: 'unknown',
            promptVersion: 'unknown',
          })
          .returning(),
      ),
      'ai inconsistency run',
    );

    return { kind: 'proceed', runId: run.id, profileFacts, cacheKey, charge };
  });
}

interface InconsistencyDispatchResult {
  readonly outcome: AiInconsistencyOutcome;
  readonly result: Result<RunInconsistencyCheckSummary, ServiceError>;
}

/** Phases 2 (CALL) and 3 (RECONCILE) -- structurally mirrors `dispatchAndReconcile`. */
async function dispatchAndReconcileInconsistency(
  db: Db,
  ai: AiInconsistencyPort,
  input: RunInconsistencyCheckInput,
  runId: string,
  profileFacts: readonly { readonly fieldKey: string; readonly value: string }[],
  cacheKey: string,
): Promise<InconsistencyDispatchResult> {
  const killSwitchAllows = input.killSwitchCheck ? await input.killSwitchCheck() : true;

  const outcome: AiInconsistencyOutcome = killSwitchAllows
    ? await ai.checkConsistency({
        documentVersionId: input.documentVersionId,
        text: input.text,
        profileFacts,
      })
    : { ok: false, code: 'disabled', message: 'AI inconsistency checking is currently disabled' };

  const result = await db.transaction(async (tx) => {
    if (!outcome.ok) {
      await tx
        .update(schema.aiInconsistencyRuns)
        .set({
          status: 'FAILED',
          provider: outcome.provider ?? null,
          latencyMs: outcome.latencyMs ?? null,
          errorCode: outcome.code,
        })
        .where(eq(schema.aiInconsistencyRuns.id, runId));
      await appendAuditEvent(tx, {
        eventType: 'AI_INCONSISTENCY_FAILED',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { errorCode: outcome.code, aiInconsistencyRunId: runId },
      });
      return err(
        serviceError(outcome.code === 'disabled' ? 'invalid' : 'upstream_error', outcome.message),
      );
    }

    const { flags, usage } = outcome.result;

    await tx
      .update(schema.aiInconsistencyRuns)
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
      .where(eq(schema.aiInconsistencyRuns.id, runId));

    const savedFlags: DocumentInconsistencyFlagRow[] = [];
    for (const flag of flags) {
      savedFlags.push(
        required(
          first(
            await tx
              .insert(schema.documentInconsistencyFlags)
              .values({
                aiInconsistencyRunId: runId,
                documentVersionId: input.documentVersionId,
                applicantId: input.applicantId,
                description: flag.description,
                confidence: toPersistedConfidence(flag.confidence),
                rationale: flag.rationale ?? null,
              })
              .returning(),
          ),
          'document inconsistency flag',
        ),
      );
    }

    await appendAuditEvent(tx, {
      eventType: 'AI_INCONSISTENCY_RUN',
      actorAccountId: input.actorAccountId,
      method: 'DOCUMENT',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'document_version',
      resourceId: input.documentVersionId,
      metadata: {
        aiInconsistencyRunId: runId,
        flagsRaised: savedFlags.length,
        costUnits: usage.costUnits,
        modelVersion: usage.modelVersion,
        provider: usage.provider,
        latencyMs: usage.latencyMs,
      },
    });
    await recordProductEvent(tx, {
      eventType: 'AI_INCONSISTENCY_RUN',
      accountId: input.actorAccountId,
    });

    return ok({ aiInconsistencyRunId: runId, flags: savedFlags });
  });
  return { outcome, result };
}

/**
 * Check one document's deterministically-extracted text against the
 * applicant's own current TRUSTED, STANDARD-sensitivity profile facts for
 * possible contradictions (Part 8 AI-01 item 4) -- never a second document,
 * never a re-determination of any fact's correctness, and never a write to
 * anything but this task's own advisory flag rows. Consent-gated on
 * AI_EXTRACTION -- the same tier extraction/classification already use, not
 * a materially larger disclosure than either (document text plus the
 * applicant's own already-confirmed, non-protected field values).
 */
export async function runInconsistencyCheck(
  db: Db,
  ai: AiInconsistencyPort,
  input: RunInconsistencyCheckInput,
): Promise<Result<RunInconsistencyCheckSummary, ServiceError>> {
  const owned = await loadOwnedApplicant(db, input);
  if (!owned.ok) return err(owned.error);
  const applicant = owned.value;
  // The feature first (S28), then consent, then the spend and attempt limits.
  const gate = await openAiFeatureGate(
    db,
    'ai_consistency_checks',
    aiOwnerContext(applicant.ownerAccountId),
  );
  if (!gate.ok) return err(aiFeatureRefusal(gate.error));
  if (!(await hasConsent(db, applicant.ownerAccountId, 'AI_EXTRACTION'))) {
    return err(serviceError('consent_required', 'AI extraction consent is required'));
  }

  const rateLimited = await aiRateLimitRefusal(db, input.actorAccountId);
  if (rateLimited) return err(rateLimited);

  const reservation = await reserveInconsistencySlot(db, ai, input, gate.value);
  if (reservation.kind === 'final') return reservation.outcome;

  const dispatched = await dispatchAndReconcileInconsistency(
    db,
    ai,
    input,
    reservation.runId,
    reservation.profileFacts,
    reservation.cacheKey,
  );
  await refundIfSwitchedOff(db, reservation.charge, dispatched.outcome);
  return dispatched.result;
}

export interface DecideInconsistencyFlagInput {
  readonly actorAccountId: string;
  readonly flagId: string;
  readonly reason?: string;
}

/** Mark a PENDING flag ACKNOWLEDGED (the reviewer has seen it and will act, if at all, outside this system) -- never a fact write, matching this task's own purely-advisory framing. */
export async function acknowledgeInconsistencyFlag(
  db: Db,
  input: DecideInconsistencyFlagInput,
): Promise<Result<DocumentInconsistencyFlagRow, ServiceError>> {
  return decideInconsistencyFlag(db, input, 'ACKNOWLEDGED', 'AI_INCONSISTENCY_FLAG_ACKNOWLEDGED');
}

/** Mark a PENDING flag DISMISSED (a false positive, e.g. a legitimate name-spelling variation). */
export async function dismissInconsistencyFlag(
  db: Db,
  input: DecideInconsistencyFlagInput,
): Promise<Result<DocumentInconsistencyFlagRow, ServiceError>> {
  return decideInconsistencyFlag(db, input, 'DISMISSED', 'AI_INCONSISTENCY_FLAG_DISMISSED');
}

async function decideInconsistencyFlag(
  db: Db,
  input: DecideInconsistencyFlagInput,
  status: 'ACKNOWLEDGED' | 'DISMISSED',
  auditEventType: string,
): Promise<Result<DocumentInconsistencyFlagRow, ServiceError>> {
  const flag = first(
    await db
      .select()
      .from(schema.documentInconsistencyFlags)
      .where(eq(schema.documentInconsistencyFlags.id, input.flagId))
      .limit(1),
  );
  if (!flag) return err(serviceError('not_found', 'flag not found'));
  if (flag.status !== 'PENDING') {
    return err(serviceError('invalid', 'this flag has already been decided'));
  }

  const applicant = await getApplicant(db, flag.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to decide this flag'));
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.documentInconsistencyFlags)
          .set({ status, decidedByAccountId: input.actorAccountId, decidedAt: new Date() })
          .where(eq(schema.documentInconsistencyFlags.id, input.flagId))
          .returning(),
      ),
      'document inconsistency flag',
    );
    await appendAuditEvent(tx, {
      eventType: auditEventType,
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: flag.applicantId,
      resourceType: 'document_inconsistency_flag',
      resourceId: flag.id,
      metadata: { description: flag.description, reason: input.reason },
    });
    // An acknowledged flag was a real finding (the AI's output was accepted);
    // a dismissed one was a false positive (it was rejected).
    await recordProductEvent(tx, {
      eventType: status === 'ACKNOWLEDGED' ? 'AI_PROPOSAL_ACCEPTED' : 'AI_PROPOSAL_REJECTED',
      accountId: input.actorAccountId,
      dimension: 'INCONSISTENCY',
    });
    return ok(updated);
  });
}

/** Pending inconsistency flags for an applicant (the review queue), newest first -- mirrors `listPendingProposals`'s identical shape/contract. */
export async function listPendingInconsistencyFlags(
  db: Db,
  applicantId: string,
): Promise<DocumentInconsistencyFlagRow[]> {
  return db
    .select()
    .from(schema.documentInconsistencyFlags)
    .where(
      and(
        eq(schema.documentInconsistencyFlags.applicantId, applicantId),
        eq(schema.documentInconsistencyFlags.status, 'PENDING'),
      ),
    )
    .orderBy(desc(schema.documentInconsistencyFlags.createdAt));
}
