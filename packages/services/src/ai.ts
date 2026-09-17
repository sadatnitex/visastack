import { createHash } from 'node:crypto';
import type { FactStatus, ProposalType } from '@visastack/core';
import { type Result, err, isOk, ok } from '@visastack/core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import type { KeyManagementPort } from './ports';
import { recordProductEvent } from './product-events';
import { type EditFactResult, editFact, getCurrentFactVersion } from './profile';

/**
 * AI Gateway (Build Spec §8; master directive §8/§26 item 4): extraction
 * produces field PROPOSALS — never silent writes. Extraction requires
 * AI_EXTRACTION consent and respects a durable, platform-wide cost budget
 * (the sum of every recorded `ai_extraction_runs` row — not an in-memory
 * counter that resets every request). A proposal only enters the Master
 * Profile through an explicit, atomic approval that reuses the manual-edit
 * machinery (immutable version, full provenance, unknown fields rejected).
 * The concrete model provider (OpenAI Responses API, `gpt-5.6-terra`) sits
 * behind `AiExtractionPort`.
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
  readonly costUnits: number;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
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

export type AiExtractionErrorCode = 'upstream_error' | 'invalid_response' | 'rate_limited';

export type AiExtractionOutcome =
  | { readonly ok: true; readonly result: AiExtractionResult }
  | { readonly ok: false; readonly code: AiExtractionErrorCode; readonly message: string };

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

/** The durable, platform-wide AI spend so far — the cost ledger IS this sum. */
export async function totalAiCostUnits(db: Db): Promise<number> {
  const row = first(
    await db
      .select({ total: sql<string>`coalesce(sum(${schema.aiExtractionRuns.costUnits}), 0)` })
      .from(schema.aiExtractionRuns),
  );
  return Number(row?.total ?? 0);
}

/** The durable AI spend so far for one specific document (per-document cap). */
export async function documentAiCostUnits(db: Db, documentVersionId: string): Promise<number> {
  const row = first(
    await db
      .select({ total: sql<string>`coalesce(sum(${schema.aiExtractionRuns.costUnits}), 0)` })
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, documentVersionId)),
  );
  return Number(row?.total ?? 0);
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
 * SUCCEEDED run instead of paying for the model call again — this is also
 * the duplicate-prevention mechanism the directive asks for separately:
 * re-running extraction on the very same document version under the same
 * config is, by definition, the same cache key.
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
}

export type FieldProposalRow = typeof schema.fieldProposals.$inferSelect;

export interface RunExtractionSummary {
  readonly aiExtractionRunId: string;
  readonly proposals: readonly FieldProposalRow[];
}

/**
 * Run AI extraction over a document, persisting the proposals it returns
 * WITHOUT mutating the profile. Consent-gated (AI_EXTRACTION) and
 * budget-guarded against the durable ledger; every invocation — success or
 * failure — is recorded and audited.
 *
 * Processing idempotency (master directive §7 "PR 6"): the whole call runs
 * inside one transaction holding a Postgres advisory lock keyed on
 * `documentVersionId`. Without it, two near-simultaneous requests for the
 * same document (a double-click, a network retry) could both read the same
 * attempts/budget counts, both pass, and both invoke the paid AI adapter —
 * exceeding `maxAttemptsPerDocument`/the budget caps by more than the
 * intended one-at-a-time margin. The lock serializes them: the second
 * caller's checks only run after the first has fully recorded its run, so
 * they see the true, up-to-date counts. This does not limit *deliberate*
 * bounded retries (up to `maxAttemptsPerDocument`) — only concurrent ones.
 *
 * That per-document lock is deliberately scoped to `documentVersionId` (its
 * own docstring said so), so it does nothing for the PLATFORM-wide budget
 * check specifically: two concurrent requests for two DIFFERENT documents
 * never contend for the same per-document key, so both could read the same
 * `totalAiCostUnits`, both pass, and both invoke the paid adapter — enough
 * concurrent different-document requests near the platform cap could
 * collectively overshoot it (finding #20, post-programme defect register).
 * A second, fixed (not document-derived) advisory lock closes this: every
 * call also takes `pg_advisory_xact_lock(hashtext('visastack:ai-platform-
 * budget'))` before reading `totalAiCostUnits`, serializing ALL extraction
 * calls platform-wide — not just same-document ones — against each other's
 * eventual cost commit, not merely against each other's check. Mirrors
 * `uploads.ts`'s `reserveUpload`, the same fixed-key-lock-for-the-whole-
 * transaction pattern already proven there for an identical
 * platform-wide-hard-cap-under-concurrency guarantee.
 *
 * Neither of these two guarantees is exercised by a `Promise.all` race test
 * the way other concurrency fixes in this codebase are: PGlite (the test
 * driver) fully serializes `db.transaction()` calls — a second one's
 * callback never starts until the first has committed — so two overlapping
 * `runExtraction` calls can never actually interleave in-process, whether or
 * not either lock exists. Both locks' correctness instead rests on
 * Postgres's own documented `pg_advisory_xact_lock` semantics (held until
 * the current transaction ends; a concurrent session requesting the same
 * key blocks until then), which is standard, well-established behavior, not
 * something this codebase is inventing. See `ai.test.ts`'s note above the
 * (deliberately absent) race test for how this was confirmed rather than
 * assumed.
 */
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

  return db.transaction(async (tx) => {
    // Fixed key, acquired first (and held for the whole transaction, same as
    // the per-document lock below): serializes the platform-wide budget
    // check against every OTHER concurrent extraction call too, not only
    // same-document ones (finding #20, post-programme defect register).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('visastack:ai-platform-budget'))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.documentVersionId}))`);

    const used = await totalAiCostUnits(tx);
    if (used >= input.budgetLimitUnits) {
      return err(serviceError('invalid', 'AI budget exhausted'));
    }
    if (input.perDocumentBudgetLimitUnits !== undefined) {
      const documentUsed = await documentAiCostUnits(tx, input.documentVersionId);
      if (documentUsed >= input.perDocumentBudgetLimitUnits) {
        return err(serviceError('invalid', 'AI budget exhausted for this document'));
      }
    }
    if (input.maxPagesPerDocument !== undefined) {
      const pageCount = await latestPageCount(tx, input.documentVersionId);
      if (pageCount !== null && pageCount > input.maxPagesPerDocument) {
        return err(
          serviceError('invalid', 'document exceeds the configured page limit for AI extraction'),
        );
      }
    }

    const allowedFieldKeys = (
      await tx.select({ key: schema.fieldDefinitions.key }).from(schema.fieldDefinitions)
    ).map((r) => r.key);

    const contentHash = createHash('sha256').update(input.text).digest('hex');
    const parserVersion = (await latestParserVersion(tx, input.documentVersionId)) ?? 'unknown';
    const cacheKey = computeCacheKey(contentHash, parserVersion, ai.cacheKeyComponents());

    const cached = first(
      await tx
        .select()
        .from(schema.aiExtractionRuns)
        .where(
          and(
            eq(schema.aiExtractionRuns.cacheKey, cacheKey),
            eq(schema.aiExtractionRuns.status, 'SUCCEEDED'),
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
      return ok({ aiExtractionRunId: run.id, proposals: savedProposals });
    }

    // Only reached on a genuine cache MISS — from here on, proceeding
    // actually costs a real invocation. The attempt-limit gate belongs HERE,
    // not earlier alongside the budget checks (finding #28, post-programme
    // defect register): `countAiExtractionAttempts` already excludes cache
    // rows from its count, but that alone isn't sufficient once the count
    // reaches the limit exactly — a gate evaluated before the cache lookup
    // would still refuse a cache-hit-eligible request purely because it
    // hadn't yet been given the chance to discover it would cost nothing.
    // Moving the gate here means it is only ever consulted for a request
    // that is actually about to consume a genuine attempt, matching "only
    // genuine paid invocations count against it" exactly. The budget checks
    // above deliberately keep their original position, before the cache
    // lookup — an exhausted budget is a hard stop regardless of whether this
    // specific request would have been free (see the platform-budget test
    // "a cache hit still fails closed once the platform-wide budget is
    // exhausted"); attempts and budget are different knobs with different
    // intended semantics. `maxPagesPerDocument` is deliberately left in its
    // original position too — out of finding #28's scope, which names only
    // the attempt count.
    if (input.maxAttemptsPerDocument !== undefined) {
      const attempts = await countAiExtractionAttempts(tx, input.documentVersionId);
      if (attempts >= input.maxAttemptsPerDocument) {
        return err(
          serviceError('invalid', 'AI extraction attempt limit reached for this document'),
        );
      }
    }

    const outcome = await ai.extract({
      documentVersionId: input.documentVersionId,
      text: input.text,
      allowedFieldKeys,
    });

    if (!outcome.ok) {
      const run = required(
        first(
          await tx
            .insert(schema.aiExtractionRuns)
            .values({
              documentVersionId: input.documentVersionId,
              applicantId: input.applicantId,
              status: 'FAILED',
              modelVersion: 'unknown',
              promptVersion: 'unknown',
              costUnits: 0,
              errorCode: outcome.code,
            })
            .returning(),
        ),
        'ai extraction run',
      );
      await appendAuditEvent(tx, {
        eventType: 'AI_EXTRACTION_FAILED',
        actorAccountId: input.actorAccountId,
        method: 'DOCUMENT',
        result: 'ALLOWED',
        applicantId: input.applicantId,
        resourceType: 'document_version',
        resourceId: input.documentVersionId,
        metadata: { errorCode: outcome.code, aiExtractionRunId: run.id },
      });
      return err(serviceError('upstream_error', outcome.message));
    }

    const { proposals, usage } = outcome.result;

    const run = required(
      first(
        await tx
          .insert(schema.aiExtractionRuns)
          .values({
            documentVersionId: input.documentVersionId,
            applicantId: input.applicantId,
            status: 'SUCCEEDED',
            modelVersion: usage.modelVersion,
            promptVersion: usage.promptVersion,
            schemaVersion: usage.schemaVersion,
            costUnits: usage.costUnits,
            cacheKey,
          })
          .returning(),
      ),
      'ai extraction run',
    );

    const savedProposals: FieldProposalRow[] = [];
    for (const proposal of proposals) {
      const saved = required(
        first(
          await tx
            .insert(schema.fieldProposals)
            .values({
              aiExtractionRunId: run.id,
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
        await tx.insert(schema.evidenceLocations).values({
          fieldProposalId: saved.id,
          snippet: proposal.evidenceSnippet,
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
        aiExtractionRunId: run.id,
        proposals: savedProposals.length,
        costUnits: usage.costUnits,
        modelVersion: usage.modelVersion,
      },
    });
    await recordProductEvent(tx, {
      eventType: 'AI_EXTRACTION_RUN',
      accountId: input.actorAccountId,
    });

    return ok({ aiExtractionRunId: run.id, proposals: savedProposals });
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
