import type { ProposalType } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type EditFactResult, editFact } from './profile';

/**
 * AI Gateway (Build Spec §8): extraction produces field PROPOSALS — never
 * silent writes. Extraction requires AI_EXTRACTION consent and respects a cost
 * budget. A proposal only enters the Master Profile through an explicit,
 * atomic approval that reuses the manual-edit machinery (immutable version,
 * full provenance, unknown fields rejected). The concrete model provider
 * (OpenAI GPT-5.6 Terra) sits behind `AiExtractionPort`.
 */

export interface FieldProposal {
  readonly type: ProposalType;
  /** Canonical field key the model mapped to (absent for UNMAPPED). */
  readonly fieldKey?: string;
  readonly value?: string;
  /** 0..1 model confidence. */
  readonly confidence: number;
  readonly rationale?: string;
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

export interface AiExtractionPort {
  extract(input: AiExtractionInput): Promise<AiExtractionResult>;
}

/** A simple monotonic cost budget (Build Spec §8 — cost controls). */
export interface AiBudget {
  readonly limitUnits: number;
  used: number;
}

export interface RunExtractionInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly documentVersionId: string;
  readonly text: string;
  readonly budget: AiBudget;
}

/**
 * Run AI extraction over a document, returning proposals WITHOUT mutating the
 * profile. Consent-gated (AI_EXTRACTION) and budget-guarded; usage is audited.
 */
export async function runExtraction(
  db: Db,
  ai: AiExtractionPort,
  input: RunExtractionInput,
): Promise<Result<AiExtractionResult, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to run extraction for this applicant'));
  }
  if (!(await hasConsent(db, applicant.ownerAccountId, 'AI_EXTRACTION'))) {
    return err(serviceError('consent_required', 'AI_EXTRACTION consent is required'));
  }
  if (input.budget.used >= input.budget.limitUnits) {
    return err(serviceError('invalid', 'AI budget exhausted'));
  }

  const allowedFieldKeys = (
    await db.select({ key: schema.fieldDefinitions.key }).from(schema.fieldDefinitions)
  ).map((r) => r.key);

  const result = await ai.extract({
    documentVersionId: input.documentVersionId,
    text: input.text,
    allowedFieldKeys,
  });
  input.budget.used += result.usage.costUnits;

  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'AI_EXTRACTION_RUN',
      actorAccountId: input.actorAccountId,
      method: 'DOCUMENT',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'document_version',
      resourceId: input.documentVersionId,
      metadata: {
        proposals: result.proposals.length,
        costUnits: result.usage.costUnits,
        modelVersion: result.usage.modelVersion,
      },
    });
  });
  return ok(result);
}

export interface ApproveProposalInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly documentVersionId: string;
  readonly proposal: FieldProposal;
  readonly usage: Pick<AiUsage, 'modelVersion' | 'promptVersion'>;
  readonly repeatingRecordKey?: string;
}

/**
 * Apply an approved proposal to the Master Profile — the ONLY path from a
 * proposal to a fact. Reuses `editFact` for the atomic approval, tagging the
 * immutable version with DOCUMENT provenance. UNMAPPED/unknown proposals are
 * rejected (no invented fields).
 */
export async function approveProposal(
  db: Db,
  input: ApproveProposalInput,
): Promise<Result<EditFactResult, ServiceError>> {
  const { proposal } = input;
  if (proposal.type === 'UNMAPPED' || !proposal.fieldKey) {
    return err(serviceError('unknown_field', 'proposal has no canonical field to approve'));
  }
  if (proposal.value === undefined) {
    return err(serviceError('invalid', 'proposal has no value to approve'));
  }
  return editFact(db, {
    actorAccountId: input.actorAccountId,
    applicantId: input.applicantId,
    fieldKey: proposal.fieldKey,
    value: proposal.value,
    status: 'DOCUMENT_SUPPORTED',
    method: 'DOCUMENT',
    sourceDocumentVersionId: input.documentVersionId,
    modelVersion: input.usage.modelVersion,
    promptVersion: input.usage.promptVersion,
    reason: 'ai_proposal_approved',
    ...(input.repeatingRecordKey ? { repeatingRecordKey: input.repeatingRecordKey } : {}),
  });
}

/** Convenience: the current unreviewed document versions for an applicant. */
export async function awaitingReview(db: Db, applicantId: string) {
  return db
    .select({ version: schema.documentVersions })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(eq(schema.documents.applicantId, applicantId))
    .then((rows) =>
      rows.map((r) => r.version).filter((v) => v.processingStatus === 'AWAITING_REVIEW'),
    );
}
