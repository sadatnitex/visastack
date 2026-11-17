import { type Result, err, ok } from '@visastack/core';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type ServiceError, keyedError } from './errors';
import { computeReadiness } from './missions';

/**
 * The few facts a shareable progress card may show (WP-PIC15, owner decision D5 of 17 Nov 2026:
 * counts only). Nothing here names the traveller, a document, the case title or a reference code.
 * `destination` is the place as it was saved on the case; the web layer turns it into a country
 * code and the country's own name, and never draws the saved text itself.
 */
export interface CaseProgressCounts {
  readonly missionId: string;
  readonly satisfiedRequired: number;
  readonly requiredCount: number;
  readonly destination: string | null;
  readonly finished: boolean;
}

/**
 * Closed and cancelled cases are finished. A submitted case is still being worked on (it waits
 * for a decision), as the Cases page and the traveller's insights both treat it.
 */
const FINISHED_STATES: ReadonlySet<string> = new Set(['CLOSED', 'CANCELLED']);

/** The audit event a card leaves behind: which case, by whom, and nothing it showed. */
export const PROGRESS_CARD_MADE = 'PROGRESS_CARD_MADE';

/**
 * Counts for one case's progress card, for the owner of the record only. The proof must be a
 * genuine view proof for exactly one case, issued to the record's owner: an agency member, a
 * person the record is shared with, a contributor or support each get the same answer as an
 * unknown case. A case with no checklist, or a checklist with nothing required, has nothing to
 * count and answers the same way.
 *
 * One count-only audit event is written for each card made (no counts, no text). No card is
 * given without it: when the audit row cannot be written the answer is the same not-found.
 */
export async function readCaseProgressCounts(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<CaseProgressCounts, ServiceError>> {
  const missing = () => err(keyedError('not_found', 'missions.case_not_found'));
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.resource.kind !== 'mission' ||
    access.actor.kind !== 'applicant_owner'
  ) {
    return missing();
  }
  const mission = access.resource.mission;
  if (!mission.packVersionId || mission.applicantId !== access.applicant.id) return missing();
  const readiness = await computeReadiness(access.tx, mission.id);
  if (!readiness.ok || readiness.value.requiredCount <= 0) return missing();

  try {
    await access.tx.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: PROGRESS_CARD_MADE,
        actorAccountId: access.applicant.ownerAccountId,
        actorRole: 'applicant_owner',
        action: 'VIEW_METADATA',
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: access.applicant.id,
        missionId: mission.id,
        resourceType: 'mission',
        resourceId: mission.id,
      });
    });
  } catch (error) {
    // Message only: a driver error can carry query parameters.
    console.error(
      `[progress-card] audit row not written: ${error instanceof Error ? error.message : String(error)}`,
    );
    return missing();
  }

  return ok({
    missionId: mission.id,
    satisfiedRequired: readiness.value.satisfiedRequired,
    requiredCount: readiness.value.requiredCount,
    destination: mission.destination,
    finished: FINISHED_STATES.has(mission.state),
  });
}
