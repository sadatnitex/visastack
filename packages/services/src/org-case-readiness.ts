import { and, eq, getTableColumns, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { withCaseExclusions } from './access/grant-scope';
import { isActiveMember, listAssignedMissionIds } from './agency';
import { type Db, schema } from './db';
import { presentApplicantCondition } from './lifecycle/foundation/conditions';
import { isUuid } from './lifecycle/foundation/ids';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { type MissingRequirement, type Mission, computeReadinessMany } from './missions';
import { isOrgAdmin } from './organizations';

/** The most cases one call reads: one page of the Cases list is far below this. */
export const CASE_READINESS_MAX = 100;

/**
 * One case's readiness as the agency's Cases list draws it: counts and what is missing, by kind
 * and reason only. No key, label or value from the traveller's records leaves this function.
 * Completeness only, never an approval.
 */
export interface OrgCaseReadiness {
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
  readonly missing: readonly {
    readonly kind: MissingRequirement['kind'];
    readonly optional: boolean;
    readonly reason: MissingRequirement['reason'];
    readonly alternatives?: readonly { readonly kind: MissingRequirement['kind'] }[];
  }[];
}

/**
 * WP-PIC18: the readiness of each case on one page of the agency's Cases list, worked out exactly
 * as the case page works it out (`computeReadinessMany`, the same queries and evaluator as
 * `computeReadiness`), in a fixed number of queries whatever the number of cases.
 *
 * Who may read what is the same rule as `listAccessEndsForOrg` (access-ends.ts), line for line: an
 * active owner or admin reads every case asked about, another active member only the ones assigned
 * to them, and only through a live grant to this organization that covers the case (the same
 * live-grant test and per-case sharing exceptions as the organization's reachable cases). Anyone
 * else, a made-up organization and a made-up case get no entry. A case in manual mode or with no
 * checklist gets no entry either (the case page shows it no readiness).
 */
export async function listCaseReadinessForOrg(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  /** The cases the signed-in member can already see on the page; no other case is read or returned. */
  requestedMissionIds: readonly string[],
): Promise<ReadonlyMap<string, OrgCaseReadiness>> {
  if (!isUuid(actorAccountId) || !isUuid(organizationId)) return new Map();
  if (!(await isActiveMember(db, actorAccountId, organizationId))) return new Map();
  const requested = [...new Set(requestedMissionIds)].filter(isUuid).slice(0, CASE_READINESS_MAX);
  const missionIds = (await isOrgAdmin(db, actorAccountId, organizationId))
    ? requested
    : await (async () => {
        const assigned = await listAssignedMissionIds(db, organizationId, actorAccountId);
        return requested.filter((id) => assigned.has(id));
      })();
  if (missionIds.length === 0) return new Map();
  const now = new Date();
  const lifecycle = await lifecycleTablesPresent(db);
  const rows = await withCaseExclusions(db, (covers) =>
    db
      .select(getTableColumns(schema.missions))
      .from(schema.grants)
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
      .innerJoin(schema.missions, eq(schema.missions.applicantId, schema.applicants.id))
      .where(
        and(
          eq(schema.grants.recipientOrganizationId, organizationId),
          eq(schema.grants.status, 'ACTIVE'),
          isNotNull(schema.grants.acceptedAt),
          lte(schema.grants.startAt, now),
          or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
          inArray(schema.missions.id, [...missionIds]),
          covers(schema.missions.id),
          lifecycle ? presentApplicantCondition() : undefined,
        ),
      ),
  );
  // Several live grants can reach one case: each case is read once. The same rule as the case
  // page: manual mode and no checklist show no readiness.
  const reachable = new Map<string, Mission>();
  for (const mission of rows) {
    if (mission.manualMode || !mission.packVersionId) continue;
    reachable.set(mission.id, mission);
  }
  if (reachable.size === 0) return new Map();
  const readings = await computeReadinessMany(db, [...reachable.values()], now);
  const result = new Map<string, OrgCaseReadiness>();
  for (const missionId of reachable.keys()) {
    const reading = readings.get(missionId);
    if (!reading?.ok) continue;
    const { requiredCount, satisfiedRequired, missing } = reading.value;
    result.set(missionId, {
      requiredCount,
      satisfiedRequired,
      missing: missing.map((m) => ({
        kind: m.kind,
        optional: m.optional,
        reason: m.reason,
        ...(m.alternatives ? { alternatives: m.alternatives.map((a) => ({ kind: a.kind })) } : {}),
      })),
    });
  }
  return result;
}
