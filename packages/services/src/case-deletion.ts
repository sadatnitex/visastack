import { type Result, err, ok } from '@visastack/core';
import { and, eq, inArray } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { missionBlockedByLegalHold } from './legal-hold';

/**
 * The owner deletes one of their own CANCELLED cases (Owner, 5 Nov 2026: "user should be able to
 * delete cancelled cases").
 *
 * What it does: removes the case row, and with it every table that points at the case with
 * `onDelete: cascade` (notes, tasks, appointments, snapshots, evidence requests and what was sent
 * for them, ended grants, outputs, notifications, package choices and the rest), in ONE
 * transaction, then writes the audit event as the last write of that transaction, so the audit
 * record and the deletion commit or roll back together. Documents, the profile and the rest of
 * the traveller's records are never touched: nothing there points to a case.
 *
 * Every check runs INSIDE the transaction, after the person's row and then the case's row are
 * locked (the order `deletion.ts` documents, so a hold placed at the same moment waits for this
 * to finish or is seen by it). Nothing is written before the checks are done, and the audit
 * event is appended last so the global audit lock is not held while the cascade runs.
 *
 * What it refuses, in plain words, and why:
 * - Not the owner: the caller must hold a MANAGE proof on this case, made by `requireAccess`, and
 *   the proof must be the owner's own (an agency's MANAGE grant is not enough).
 * - Any state but CANCELLED: a case that is still alive, or finished normally, is not removed here.
 * - A legal hold on the person or this case, or any hold record that names this case (a released
 *   hold is still a compliance record, and the hold rows would go with the case).
 * - A complaint, an outcome, a submission report or case feedback: the retention design keeps
 *   these as historical facts with their own accountability value (case-retention.ts), and the
 *   schema would delete them with the case, so the case stays and says so.
 * - Sharing still in force: a grant that is not revoked or expired, a pending invitation, or a
 *   request that is still open. A share is ended by revoking it (which writes its own audit
 *   event), never by deleting its row (resource-lifecycle-contract.md), so the person stops
 *   sharing first and the agency's open requests close first.
 *
 * One reference does not cascade: an agency invitation remembers which case it created
 * (`accepted_mission_id`). That pointer is cleared; the invitation itself is kept.
 *
 * The audit event keeps the case's title, state and dates, the same facts the retention purge
 * records, so the erasure itself stays accountable. A restore from backup replays it
 * (backup-reconciliation.ts), so a deleted case cannot come back.
 */
export interface DeletedMission {
  readonly missionId: string;
  readonly applicantId: string;
}

/** Why a case is kept, in words a person can read. Each one is a distinct reason, never a catch-all. */
export const CASE_KEPT_REASONS = {
  gone: 'This case has already been removed.',
  state: 'Only a cancelled case can be deleted.',
  hold: 'This case is under a legal hold, so it cannot be deleted for now.',
  record:
    'This case has a filed record (a decision, a submission report, a complaint or feedback) that is kept, so it cannot be deleted.',
  shared:
    'This case is still shared or has open requests. Stop sharing it and let its requests close first, then delete it.',
} as const;

/** Requests that are still waiting on someone. The finished ones (accepted, fulfilled, declined, cancelled) are not. */
const OPEN_EVIDENCE_REQUEST_STATUSES = [
  'OPEN',
  'RECEIVED',
  'UNDER_REVIEW',
  'NEEDS_REPLACEMENT',
] as const;
const LIVE_GRANT_STATUSES = ['PENDING_ACCEPTANCE', 'ACTIVE', 'PAUSED'] as const;

/** Thrown inside the transaction to stop and roll back with a plain refusal. */
class Refusal extends Error {
  constructor(readonly reason: ServiceError) {
    super(reason.message);
  }
}

function refuse(code: 'not_found' | 'invalid', message: string): never {
  throw new Refusal(serviceError(code, message));
}

async function present(query: PromiseLike<readonly unknown[]>): Promise<boolean> {
  return first(await query) !== undefined;
}

export async function deleteCancelledMission(
  proof: AuthorizedApplicant<'MANAGE'>,
): Promise<Result<DeletedMission, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'MANAGE') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'mission'
  ) {
    return err(serviceError('forbidden', 'Only the owner of this case can delete it.'));
  }
  const missionId = proof.resource.mission.id;
  const applicantId = proof.applicant.id;
  const actorAccountId = proof.applicant.ownerAccountId;

  try {
    return await proof.tx.transaction(async (tx: Db) => {
      // The person first, then the case: the order a hold placement and an account deletion use.
      await tx
        .select({ id: schema.applicants.id })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, applicantId))
        .for('update');
      const mission = first(
        await tx
          .select()
          .from(schema.missions)
          .where(eq(schema.missions.id, missionId))
          .limit(1)
          .for('update'),
      );
      if (!mission || mission.purgedAt !== null) refuse('not_found', CASE_KEPT_REASONS.gone);
      if (mission.state !== 'CANCELLED') refuse('invalid', CASE_KEPT_REASONS.state);

      const heldByTheCase = await present(
        tx
          .select({ id: schema.legalHolds.id })
          .from(schema.legalHolds)
          .where(eq(schema.legalHolds.missionId, mission.id))
          .limit(1),
      );
      if (heldByTheCase || (await missionBlockedByLegalHold(tx, { applicantId, missionId }))) {
        refuse('invalid', CASE_KEPT_REASONS.hold);
      }

      const keptRecords = await Promise.all([
        present(
          tx
            .select({ id: schema.caseComplaints.id })
            .from(schema.caseComplaints)
            .where(eq(schema.caseComplaints.missionId, mission.id))
            .limit(1),
        ),
        present(
          tx
            .select({ id: schema.missionOutcomes.id })
            .from(schema.missionOutcomes)
            .where(eq(schema.missionOutcomes.missionId, mission.id))
            .limit(1),
        ),
        present(
          tx
            .select({ id: schema.missionSubmissions.id })
            .from(schema.missionSubmissions)
            .where(eq(schema.missionSubmissions.missionId, mission.id))
            .limit(1),
        ),
        present(
          tx
            .select({ id: schema.caseFeedback.id })
            .from(schema.caseFeedback)
            .where(eq(schema.caseFeedback.missionId, mission.id))
            .limit(1),
        ),
      ]);
      if (keptRecords.some(Boolean)) refuse('invalid', CASE_KEPT_REASONS.record);

      const stillShared = await Promise.all([
        present(
          tx
            .select({ id: schema.grants.id })
            .from(schema.grants)
            .where(
              and(
                eq(schema.grants.missionId, mission.id),
                inArray(schema.grants.status, LIVE_GRANT_STATUSES),
              ),
            )
            .limit(1),
        ),
        present(
          tx
            .select({ id: schema.sharingInvitations.id })
            .from(schema.sharingInvitations)
            .where(
              and(
                eq(schema.sharingInvitations.missionId, mission.id),
                eq(schema.sharingInvitations.status, 'PENDING'),
              ),
            )
            .limit(1),
        ),
        present(
          tx
            .select({ id: schema.evidenceRequests.id })
            .from(schema.evidenceRequests)
            .where(
              and(
                eq(schema.evidenceRequests.missionId, mission.id),
                inArray(schema.evidenceRequests.status, OPEN_EVIDENCE_REQUEST_STATUSES),
              ),
            )
            .limit(1),
        ),
        present(
          tx
            .select({ id: schema.contributorRequests.id })
            .from(schema.contributorRequests)
            .where(
              and(
                eq(schema.contributorRequests.missionId, mission.id),
                eq(schema.contributorRequests.status, 'PENDING'),
              ),
            )
            .limit(1),
        ),
      ]);
      if (stillShared.some(Boolean)) refuse('invalid', CASE_KEPT_REASONS.shared);

      // The one reference that does not cascade: the invitation stays, only its pointer goes.
      await tx
        .update(schema.clientInvitations)
        .set({ acceptedMissionId: null })
        .where(eq(schema.clientInvitations.acceptedMissionId, mission.id));
      await tx.delete(schema.missions).where(eq(schema.missions.id, mission.id));

      // Last, so the audit chain's lock is not held while the cascade above runs.
      await appendAuditEvent(tx, {
        eventType: 'MISSION_DELETED_BY_OWNER',
        actorAccountId,
        action: 'MANAGE',
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        missionId: mission.id,
        resourceType: 'mission',
        resourceId: mission.id,
        reason: 'The owner deleted this cancelled case.',
        metadata: {
          title: mission.title,
          state: mission.state,
          destination: mission.destination,
          closedAt: mission.closedAt?.toISOString() ?? null,
        },
      });
      return ok({ missionId: mission.id, applicantId });
    });
  } catch (error) {
    // A refusal rolls everything back; anything else is a real fault and is left to be reported.
    if (error instanceof Refusal) return err(error.reason);
    throw error;
  }
}
