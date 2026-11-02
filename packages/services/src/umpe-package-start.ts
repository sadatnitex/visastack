/**
 * UMPE P4 (R13): the intention-first start. "Where are you going? Why? Who's travelling?" gives
 * each traveller their own ordinary case (the existing `createMission`), never a shared trip
 * object and never a merged record. When the traveller already has an active case for the same
 * destination and purpose, that case is opened instead of starting a duplicate.
 */
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, isNull, notInArray } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { createMission } from './missions';
import { INACTIVE_CASE_STATES } from './umpe-package-tables';

const NAME_MAX = 120;
const TITLE_MAX = 200;

export interface TripIntention {
  /** The destination's plain name, as the case stores it (for example "Japan"). */
  readonly destination: string;
  /** The purpose's plain label, as the case stores it (for example "Tourism"). */
  readonly purpose: string;
  /** Optional case name; by default "<destination> - <purpose>". */
  readonly title?: string;
}

export interface TripCaseOutcome {
  readonly missionId: string;
  /** True when an existing active case was opened rather than a new one started. */
  readonly existing: boolean;
}

async function activeCaseFor(
  tx: Db,
  applicantId: string,
  destination: string,
  purpose: string,
): Promise<string | null> {
  const row = first(
    await tx
      .select({ id: schema.missions.id })
      .from(schema.missions)
      .where(
        and(
          eq(schema.missions.applicantId, applicantId),
          eq(schema.missions.destination, destination),
          eq(schema.missions.purpose, purpose),
          notInArray(schema.missions.state, [...INACTIVE_CASE_STATES]),
          isNull(schema.missions.purgedAt),
        ),
      )
      .orderBy(desc(schema.missions.createdAt))
      .limit(1),
  );
  return row?.id ?? null;
}

/**
 * Open the traveller's active case for this destination and purpose, or start one. The proof is
 * the case owner's for this one traveller; a group trip calls this once per traveller, each with
 * their own proof. Ownership, consent and the case name are still checked by `createMission`.
 */
export async function openOrStartTripCase(
  proof: AuthorizedApplicant<'MANAGE'>,
  intention: TripIntention,
): Promise<Result<TripCaseOutcome, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'MANAGE') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'applicant'
  ) {
    return err(serviceError('forbidden', 'Only the owner of this traveller can start a case.'));
  }
  const destination = intention.destination.trim();
  const purpose = intention.purpose.trim();
  if (destination.length === 0 || destination.length > NAME_MAX) {
    return err(serviceError('invalid', 'Choose where you are going.'));
  }
  if (purpose.length === 0 || purpose.length > NAME_MAX) {
    return err(serviceError('invalid', 'Choose why you are travelling.'));
  }
  const title = (intention.title?.trim() || `${destination} - ${purpose}`).slice(0, TITLE_MAX);
  const existing = await activeCaseFor(proof.tx, proof.applicant.id, destination, purpose);
  if (existing) return ok({ missionId: existing, existing: true });
  const created = await createMission(proof.tx, {
    actorAccountId: proof.applicant.ownerAccountId,
    applicantId: proof.applicant.id,
    title,
    destination,
    purpose,
  });
  if (!created.ok) return created;
  return ok({ missionId: created.value.id, existing: false });
}
