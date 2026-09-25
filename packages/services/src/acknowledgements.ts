import { type Result, err, ok } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { getMissionForOwner } from './missions';

/**
 * TRU-02 (master directive Part 7 §3): the applicant's own acknowledgement
 * of a prepared file.
 *
 * `decideAcknowledgement` is the single entry point for all three actions
 * the directive names (acknowledge; reject; request correction), matching
 * `decideEvidenceResponse`/`decideTask`'s own established "one function, an
 * outcome parameter" shape rather than three near-duplicate exports.
 *
 * Authorization is deliberately `getMissionForOwner` -- the SAME strict,
 * grant-blind, owner-only check every other applicant-side mission action
 * already uses -- never a grant/membership lookup. This is not incidental:
 * it is exactly what makes "a reviewer cannot acknowledge for applicant
 * merely because they manage the case" true. An org member's MANAGE grant
 * can read/write plenty about a case; it was never able to pass
 * `getMissionForOwner`, and still can't.
 *
 * "auth/assurance context" and the step-up gate itself follow
 * `commercial-override.ts`'s own established boundary: this package has no
 * access to a live WorkOS session (that only exists in `apps/web`), so the
 * caller (a server action, via `apps/web/src/lib/step-up.ts`'s
 * `establishStepUp`) performs the real reauthentication check and passes
 * down a plain `stepUpSatisfied: boolean` -- never a token this layer would
 * have to re-verify with secrets it doesn't hold. `authAssuranceContext`
 * itself is then built server-side from that fact, not accepted as caller
 * input, so it can only ever say what genuinely happened.
 */

export type Acknowledgement = typeof schema.acknowledgements.$inferSelect;

/**
 * Which version of the applicant-facing acknowledgement copy (§2's
 * "Applicant-acknowledged prepared file" disclaimer, manifest, and known-
 * limitations text) a decision was taken against. No content-management
 * system exists for this text and building one is out of TRU-02's own
 * scope -- bump this constant by hand whenever that copy changes in a way
 * that could matter to what an applicant is understood to have agreed to
 * (wording/legal-meaning changes, not styling). A historical row's own
 * `textVersion` never changes regardless of later bumps here.
 */
export const ACKNOWLEDGEMENT_TEXT_VERSION = 1;

export interface DecideAcknowledgementInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly snapshotId: string;
  /**
   * The checksum the caller believes it is acting on -- read at the moment
   * the applicant loaded the review page. Directive §4: "Acknowledgement
   * must... check snapshot hash." Compared against the snapshot row's own
   * current checksum, not against itself, so this actually verifies the
   * caller's view is the one being decided on, not a stale page.
   */
  readonly expectedSnapshotChecksum: string;
  readonly decision: 'ACKNOWLEDGED' | 'REJECTED' | 'CORRECTION_REQUESTED';
  /** Required for REJECTED/CORRECTION_REQUESTED; ignored for ACKNOWLEDGED. */
  readonly reason?: string;
  readonly stepUpSatisfied: boolean;
}

/**
 * Record the applicant's decision on a prepared file. Idempotent: repeating
 * the exact same decision on the exact same still-current snapshot returns
 * the original row rather than inserting a duplicate (a double-click/retry
 * concern, the same reasoning `selectEvidence`'s own idempotent-reselection
 * already handles) -- but a DIFFERENT decision on the same snapshot (reject,
 * then later acknowledge once nothing material changed) is a genuine new
 * historical event, not collapsed into the earlier one.
 */
export async function decideAcknowledgement(
  db: Db,
  input: DecideAcknowledgementInput,
): Promise<Result<Acknowledgement, ServiceError>> {
  const owned = await getMissionForOwner(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'acknowledging a prepared file requires reauthentication'),
    );
  }

  const reason = input.reason?.trim() ?? '';
  if (input.decision !== 'ACKNOWLEDGED' && reason.length === 0) {
    return err(serviceError('invalid', 'a reason is required to reject or request a correction'));
  }

  const applicant = required(await getApplicant(db, owned.value.applicantId), 'applicant');

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

    const snapshot = first(
      await tx
        .select()
        .from(schema.missionSnapshots)
        .where(
          and(
            eq(schema.missionSnapshots.id, input.snapshotId),
            eq(schema.missionSnapshots.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!snapshot) return err(serviceError('not_found', 'snapshot not found for this mission'));

    if (snapshot.checksum !== input.expectedSnapshotChecksum) {
      return err(serviceError('stale', 'the prepared file has changed since it was last reviewed'));
    }
    if (mission.materialRevision !== snapshot.materialRevisionAtCapture) {
      return err(
        serviceError(
          'stale',
          'the case has changed since this snapshot was taken; a new snapshot is needed',
        ),
      );
    }

    const existing = first(
      await tx
        .select()
        .from(schema.acknowledgements)
        .where(
          and(
            eq(schema.acknowledgements.snapshotId, input.snapshotId),
            eq(schema.acknowledgements.decision, input.decision),
          ),
        )
        .limit(1),
    );
    if (existing) return ok(existing);

    const record = required(
      first(
        await tx
          .insert(schema.acknowledgements)
          .values({
            missionId: mission.id,
            subjectApplicantId: applicant.id,
            snapshotId: snapshot.id,
            snapshotChecksum: snapshot.checksum,
            caseMaterialRevision: mission.materialRevision,
            decision: input.decision,
            reason: input.decision === 'ACKNOWLEDGED' ? null : reason,
            actorAccountId: input.actorAccountId,
            actorAuthority: applicant.relationship,
            textVersion: ACKNOWLEDGEMENT_TEXT_VERSION,
            authAssuranceContext: { method: 'step_up', verifiedAt: new Date().toISOString() },
          })
          .returning(),
      ),
      'acknowledgement',
    );

    await appendAuditEvent(tx, {
      eventType: 'MISSION_ACKNOWLEDGEMENT_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      applicantId: applicant.id,
      resourceType: 'acknowledgement',
      resourceId: record.id,
      metadata: { decision: input.decision, snapshotId: snapshot.id },
    });

    return ok(record);
  });
}

/** Every acknowledgement decision for a mission, newest first (owner-scoped). */
export async function listAcknowledgementsForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<Acknowledgement[], ServiceError>> {
  const owned = await getMissionForOwner(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.acknowledgements)
    .where(eq(schema.acknowledgements.missionId, missionId));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

/**
 * The mission's current live acknowledgement, if any -- defined in
 * `material-revision.ts`, not here, specifically so `missions.ts` can call
 * it too (CAS-07's own SUBMISSION_READY gate) without creating a circular
 * import: this file already imports `getMissionForOwner` from
 * `missions.ts`, so `missions.ts` importing anything back from THIS file
 * would be a cycle. Re-exported here so every other caller keeps reading it
 * as this module's own acknowledgement-status API.
 */
export { getLiveAcknowledgement } from './material-revision';
