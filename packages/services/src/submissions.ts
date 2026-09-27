import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNotNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { getLiveAcknowledgement } from './material-revision';
import { getMissionForOwner } from './missions';

/**
 * TRU-04 (master directive Part 7 §7): the external submission report.
 *
 * "Export/download does NOT mean submitted" -- nothing in this codebase
 * (a download, a snapshot, an acknowledgement) ever silently flips a case to
 * SUBMITTED. `recordSubmission` is the ONLY path there: it is deliberately
 * absent from `missions.ts`'s own `TRANSITIONS` map (see that map's own
 * comment on the `SUBMITTED` entry), so a generic `transitionMission` call
 * can never reach it either. Recording the report and moving the case are
 * one atomic action, not two steps a caller could get out of order --
 * exactly what the directive's own "Only then case can become SUBMITTED"
 * means.
 *
 * Authorization is `getMissionForOwner`, the same strict, grant-blind,
 * owner-only check `decideAcknowledgement` already uses -- an org holding a
 * MANAGE grant cannot report a submission on an applicant's behalf any more
 * than it can acknowledge one.
 *
 * The submitted packet is never caller-chosen: it is always whichever
 * snapshot the case's own current live acknowledgement already points at,
 * read inside the same row lock as the state check, so a concurrent material
 * edit invalidating that acknowledgement cannot race between the check and
 * the transition. This is directive §4's "final packet issuance must
 * recheck: current acknowledgement validity," applied to the one issuance
 * event that matters most.
 *
 * Also directly rechecks §4's "expiry" bullet here, synchronously, rather
 * than relying only on the periodic sweep (`notification-sweep.ts`'s
 * `sweepExpiryReminders`) that marks a case dirty once evidence expires:
 * that sweep runs on its own cadence, so a document expiring minutes before
 * a submission attempt could otherwise slip through before the next run.
 * This is the actual, always-current gate; the sweep exists so the case
 * shows as needing attention even before anyone attempts to submit.
 */

export type MissionSubmission = typeof schema.missionSubmissions.$inferSelect;

export interface RecordSubmissionInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly channel:
    | 'EMBASSY_PORTAL'
    | 'EMAIL'
    | 'IN_PERSON'
    | 'COURIER'
    | 'VISA_APPLICATION_CENTER'
    | 'OTHER';
  readonly externalReportDescription: string;
  readonly externalReference?: string;
  /** When the actor reports submission actually happened; defaults to now. */
  readonly submittedAt?: Date;
  readonly stepUpSatisfied: boolean;
}

export async function recordSubmission(
  db: Db,
  input: RecordSubmissionInput,
): Promise<Result<MissionSubmission, ServiceError>> {
  const owned = await getMissionForOwner(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'recording a submission requires reauthentication'),
    );
  }

  const description = input.externalReportDescription.trim();
  if (description.length === 0) {
    return err(
      serviceError('invalid', 'a description of the external submission report is required'),
    );
  }

  const submittedAt = input.submittedAt ?? new Date();
  if (submittedAt.getTime() > Date.now()) {
    return err(serviceError('invalid', 'submission date/time cannot be in the future'));
  }

  const externalReference = input.externalReference?.trim();

  return db.transaction(async (tx) => {
    const mission = required(
      first(
        await tx
          .select()
          .from(schema.missions)
          .where(eq(schema.missions.id, input.missionId))
          .for('update'),
      ),
      'mission',
    );

    if (mission.state !== 'SUBMISSION_READY') {
      return err(
        serviceError(
          'invalid',
          'a case must be submission-ready before a submission can be recorded',
        ),
      );
    }

    const live = await getLiveAcknowledgement(tx, input.missionId);
    if (!live) {
      return err(serviceError('stale', 'this case has no current live acknowledgement to submit'));
    }

    const selectedDocumentExpiries = await tx
      .select({ expiresAt: schema.documents.expiresAt })
      .from(schema.selectedEvidence)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.selectedEvidence.documentId))
      .where(
        and(
          eq(schema.selectedEvidence.missionId, input.missionId),
          isNotNull(schema.documents.expiresAt),
        ),
      );
    const now = Date.now();
    if (selectedDocumentExpiries.some((row) => row.expiresAt && row.expiresAt.getTime() <= now)) {
      return err(
        serviceError(
          'stale',
          'selected evidence has expired and must be replaced before this case can be submitted',
        ),
      );
    }

    const record = required(
      first(
        await tx
          .insert(schema.missionSubmissions)
          .values({
            missionId: mission.id,
            snapshotId: live.snapshotId,
            actorAccountId: input.actorAccountId,
            channel: input.channel,
            externalReportDescription: description,
            externalReference:
              externalReference && externalReference.length > 0 ? externalReference : null,
            submittedAt,
            authAssuranceContext: { method: 'step_up', verifiedAt: new Date().toISOString() },
          })
          .returning(),
      ),
      'submission',
    );

    await tx
      .update(schema.missions)
      .set({ state: 'SUBMITTED', updatedAt: new Date() })
      .where(eq(schema.missions.id, mission.id));

    await appendAuditEvent(tx, {
      eventType: 'MISSION_STATE_CHANGE',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'mission',
      resourceId: mission.id,
      metadata: { from: 'SUBMISSION_READY', to: 'SUBMITTED' },
    });
    await appendAuditEvent(tx, {
      eventType: 'MISSION_SUBMISSION_RECORDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'mission_submission',
      resourceId: record.id,
      metadata: { channel: input.channel, snapshotId: live.snapshotId },
    });

    return ok(record);
  });
}

/** Every submission report for a mission, newest first (owner-scoped). */
export async function listSubmissionsForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<MissionSubmission[], ServiceError>> {
  const owned = await getMissionForOwner(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.missionSubmissions)
    .where(eq(schema.missionSubmissions.missionId, missionId));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}
