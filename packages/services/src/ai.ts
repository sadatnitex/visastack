import type { FactStatus, ProposalType } from '@visastack/core';
import { type Result, err, isOk, ok } from '@visastack/core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
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

export interface AiExtractionPort {
  extract(input: AiExtractionInput): Promise<AiExtractionOutcome>;
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

/** How many times AI extraction has already been invoked for one document (any outcome). */
export async function countAiExtractionAttempts(
  db: Db,
  documentVersionId: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.aiExtractionRuns.id })
    .from(schema.aiExtractionRuns)
    .where(eq(schema.aiExtractionRuns.documentVersionId, documentVersionId));
  return rows.length;
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

  const used = await totalAiCostUnits(db);
  if (used >= input.budgetLimitUnits) {
    return err(serviceError('invalid', 'AI budget exhausted'));
  }
  if (input.maxAttemptsPerDocument !== undefined) {
    const attempts = await countAiExtractionAttempts(db, input.documentVersionId);
    if (attempts >= input.maxAttemptsPerDocument) {
      return err(serviceError('invalid', 'AI extraction attempt limit reached for this document'));
    }
  }
  if (input.perDocumentBudgetLimitUnits !== undefined) {
    const documentUsed = await documentAiCostUnits(db, input.documentVersionId);
    if (documentUsed >= input.perDocumentBudgetLimitUnits) {
      return err(serviceError('invalid', 'AI budget exhausted for this document'));
    }
  }
  if (input.maxPagesPerDocument !== undefined) {
    const pageCount = await latestPageCount(db, input.documentVersionId);
    if (pageCount !== null && pageCount > input.maxPagesPerDocument) {
      return err(
        serviceError('invalid', 'document exceeds the configured page limit for AI extraction'),
      );
    }
  }

  const allowedFieldKeys = (
    await db.select({ key: schema.fieldDefinitions.key }).from(schema.fieldDefinitions)
  ).map((r) => r.key);

  const outcome = await ai.extract({
    documentVersionId: input.documentVersionId,
    text: input.text,
    allowedFieldKeys,
  });

  if (!outcome.ok) {
    await db.transaction(async (tx) => {
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
    });
    return err(serviceError('upstream_error', outcome.message));
  }

  const { proposals, usage } = outcome.result;

  const summary = await db.transaction(async (tx) => {
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
            costUnits: usage.costUnits,
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

    return { aiExtractionRunId: run.id, proposals: savedProposals };
  });

  return ok(summary);
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
    proposal.fieldKey,
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

  const editResult = await editFact(db, {
    actorAccountId: input.actorAccountId,
    applicantId: proposal.applicantId,
    fieldKey: proposal.fieldKey,
    value: finalValue,
    status: conflict ? 'CONFLICTED' : 'DOCUMENT_SUPPORTED',
    method: 'DOCUMENT',
    sourceDocumentVersionId: proposal.documentVersionId,
    modelVersion: run.modelVersion,
    promptVersion: run.promptVersion,
    reason: 'ai_proposal_approved',
    ...(repeatingRecordKey ? { repeatingRecordKey } : {}),
  });
  if (!isOk(editResult)) return editResult;

  const { version } = editResult.value;
  await db.transaction(async (tx) => {
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
  });

  return editResult;
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
