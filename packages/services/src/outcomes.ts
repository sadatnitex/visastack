import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { getMissionForOwner } from './missions';
import { recordProductEvent } from './product-events';

/**
 * TRU-04 (master directive Part 7 §8): the real-world outcome of a case.
 *
 * Deliberately distinct from `missions.state`: state is a workflow position
 * this product controls (DRAFT, SUBMITTED, ...), while an outcome is a fact
 * about the world (what the embassy/authority actually decided) that
 * VisaStack only ever RECORDS, never determines. Nothing here computes or
 * exposes an approval probability -- the directive's own explicit
 * prohibition -- because nothing here predicts anything at all; every field
 * is either caller-supplied or a plain attribution/timestamp.
 *
 * `officialWording` and `agencyInterpretation` are structurally separate
 * columns specifically so they can never be blended (directive's own
 * explicit warning) -- a reader always knows which one they are looking at,
 * and neither is ever derived from the other.
 *
 * Authorization is `getMissionForOwner`, the same grant-blind, owner-only
 * check `decideAcknowledgement`/`recordSubmission` already use.
 */

export type MissionOutcome = typeof schema.missionOutcomes.$inferSelect;

export interface RecordOutcomeInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly decision: 'APPROVED' | 'REFUSED' | 'WITHDRAWN' | 'CANCELLED' | 'OTHER';
  readonly decisionDate: Date;
  /** Exact original wording, where supplied -- never edited or summarized. */
  readonly officialWording?: string;
  /** The agency's own reading of the decision -- kept separate, never blended. */
  readonly agencyInterpretation?: string;
  /** An existing evidence document for this same case (e.g. a scanned decision letter). */
  readonly evidenceDocumentId?: string;
  readonly stepUpSatisfied: boolean;
}

export async function recordOutcome(
  db: Db,
  input: RecordOutcomeInput,
): Promise<Result<MissionOutcome, ServiceError>> {
  const owned = await getMissionForOwner(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const mission = owned.value;

  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'recording a case outcome requires reauthentication'),
    );
  }

  if (input.decisionDate.getTime() > Date.now()) {
    return err(serviceError('invalid', 'decision date cannot be in the future'));
  }

  if (input.evidenceDocumentId) {
    const evidenceDoc = first(
      await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, input.evidenceDocumentId))
        .limit(1),
    );
    if (!evidenceDoc || evidenceDoc.applicantId !== mission.applicantId) {
      return err(serviceError('not_found', 'evidence document not found for this case'));
    }
  }

  const officialWording = input.officialWording?.trim();
  const agencyInterpretation = input.agencyInterpretation?.trim();

  return db.transaction(async (tx) => {
    const record = required(
      first(
        await tx
          .insert(schema.missionOutcomes)
          .values({
            missionId: mission.id,
            decision: input.decision,
            decisionDate: input.decisionDate,
            officialWording: officialWording && officialWording.length > 0 ? officialWording : null,
            agencyInterpretation:
              agencyInterpretation && agencyInterpretation.length > 0 ? agencyInterpretation : null,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
            actorAccountId: input.actorAccountId,
            authAssuranceContext: { method: 'step_up', verifiedAt: new Date().toISOString() },
          })
          .returning(),
      ),
      'outcome',
    );

    await appendAuditEvent(tx, {
      eventType: 'MISSION_OUTCOME_RECORDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'mission_outcome',
      resourceId: record.id,
      metadata: { decision: input.decision },
    });

    // OPS-04 outcome: which decision, and nothing of its wording. The decision
    // is one of five fixed values; `officialWording` and `agencyInterpretation`
    // (which can carry refusal reasons) never leave this table.
    await recordProductEvent(tx, {
      eventType: 'OUTCOME_RECORDED',
      accountId: input.actorAccountId,
      organizationId: mission.ownerOrganizationId,
      dimension: input.decision,
    });

    return ok(record);
  });
}

/** Every recorded outcome for a mission, newest first (owner-scoped). */
export async function listOutcomesForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<MissionOutcome[], ServiceError>> {
  const owned = await getMissionForOwner(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.missionOutcomes)
    .where(eq(schema.missionOutcomes.missionId, missionId));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}
