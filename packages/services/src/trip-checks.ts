import { type TripCheck, evaluateTripChecks, tripChecksApply } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq, inArray } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { isFactStatusEligible } from './missions';

/**
 * The trip date checks for one case (see core `evaluateTripChecks`): the case's own dates against
 * the passport expiry and any travel insurance record on the traveller's profile. Read only.
 * It takes the access proof for the case (so it can only run for someone the gate has cleared) and
 * answers for the case's owner alone, because a passport date is profile detail, not case metadata.
 * It reads only the three profile fields it needs.
 */

const PASSPORT_EXPIRY_KEY = 'passport_expiry';
const INSURANCE_FROM_KEY = 'travel_insurance_valid_from';
const INSURANCE_UNTIL_KEY = 'travel_insurance_valid_until';
const KEYS = [PASSPORT_EXPIRY_KEY, INSURANCE_FROM_KEY, INSURANCE_UNTIL_KEY];

/**
 * A saved date is stored as YYYY-MM-DD (a full timestamp is read by its date). Anything else, or a
 * day that does not exist such as 31 February, counts as not recorded and is never guessed.
 */
function parseSavedDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day
    ? null
    : parsed;
}

export async function computeTripChecks(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  now: Date = new Date(),
): Promise<readonly TripCheck[]> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'mission'
  ) {
    return [];
  }
  const mission = proof.resource.mission;
  const db = proof.tx;
  // Nothing to compare without a trip date, and nothing to act on once the case is handed in.
  if (!tripChecksApply(mission.state)) return [];
  if (!mission.travelStartDate && !mission.travelEndDate) return [];

  const rows = await db
    .select({
      key: schema.fieldDefinitions.key,
      value: schema.factVersions.value,
      status: schema.factVersions.status,
      record: schema.facts.repeatingRecordKey,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(
      and(
        eq(schema.facts.applicantId, mission.applicantId),
        inArray(schema.fieldDefinitions.key, KEYS),
      ),
    );
  const usable = rows.filter((row) => isFactStatusEligible(row.status));

  // The latest expiry on the profile is the passport in use (a renewal replaces the old one).
  const expiries = usable
    .filter((row) => row.key === PASSPORT_EXPIRY_KEY)
    .map((row) => parseSavedDate(row.value))
    .filter((date): date is Date => date !== null);
  const passportExpiry =
    expiries.length > 0 ? new Date(Math.max(...expiries.map((date) => date.getTime()))) : null;

  // A policy is one record on the profile: its two dates share a record key. A field without a
  // record key holds one value, so those two dates belong to one policy as well.
  const policies = new Map<string, { validFrom: Date | null; validUntil: Date | null }>();
  for (const row of usable) {
    if (row.key !== INSURANCE_FROM_KEY && row.key !== INSURANCE_UNTIL_KEY) continue;
    const policy = policies.get(row.record ?? '') ?? { validFrom: null, validUntil: null };
    policy[row.key === INSURANCE_FROM_KEY ? 'validFrom' : 'validUntil'] = parseSavedDate(row.value);
    policies.set(row.record ?? '', policy);
  }

  return evaluateTripChecks({
    now,
    travelStart: mission.travelStartDate,
    travelEnd: mission.travelEndDate,
    targetDeadline: mission.targetDeadline,
    passportExpiry,
    insurancePolicies: [...policies.values()],
  });
}
