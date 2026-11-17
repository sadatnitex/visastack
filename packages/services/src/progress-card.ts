import { type Result, err, ok } from '@visastack/core';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type ServiceError, keyedError } from './errors';
import { computeReadiness } from './missions';
import { isInactiveCaseState } from './umpe-package-tables';

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

/** The audit event a card leaves behind: which case, by whom, and nothing it showed. */
export const PROGRESS_CARD_MADE = 'PROGRESS_CARD_MADE';

/**
 * Counts for one case's progress card, for the owner of the record only. The proof must be a
 * genuine view proof for exactly one case, issued to the record's owner: an agency member, a
 * person the record is shared with, a contributor or support each get the same answer as an
 * unknown case. A case with no checklist has nothing to count and answers the same way.
 *
 * One count-only audit event is written for each card made (no counts, no text).
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
  if (!readiness.ok) return missing();

  await access.tx.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: PROGRESS_CARD_MADE,
      actorAccountId: access.applicant.ownerAccountId,
      action: 'VIEW_METADATA',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: access.applicant.id,
      missionId: mission.id,
      resourceType: 'mission',
      resourceId: mission.id,
    });
  });

  return ok({
    missionId: mission.id,
    satisfiedRequired: readiness.value.satisfiedRequired,
    requiredCount: readiness.value.requiredCount,
    destination: mission.destination,
    finished: isInactiveCaseState(mission.state),
  });
}
