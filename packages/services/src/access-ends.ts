import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { withCaseExclusions } from './access/grant-scope';
import { isActiveMember, listAssignedMissionIds } from './agency';
import { type Db, schema } from './db';
import { presentApplicantCondition } from './lifecycle/foundation/conditions';
import { isUuid } from './lifecycle/foundation/ids';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { isOrgAdmin } from './organizations';

/**
 * When an agency's access to each case it can see ends: the latest end date among the live grants
 * that reach the case, or `null` when one of them has no end date. Read-only, for the line
 * "Access ends on {date}" on the agency's Cases page. The same live-grant test and case-scope rule
 * as `listMissionsForOrganization` (agency.ts), so a case appears here exactly when it appears
 * there, and a per-case sharing exception removes it from both. The caller shows an entry only
 * for cases the signed-in member can already see; this adds no case and no detail to what they see.
 */
export async function listAccessEndsForOrg(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  /** The cases the signed-in member can already see on the page; no other case is read or returned. */
  requestedMissionIds: readonly string[],
): Promise<ReadonlyMap<string, Date | null>> {
  // Only the cases this person may read for this organization, the same rule as `mayReadOrgCase`
  // read in one pass for the whole page: an active owner or admin reads every case asked about,
  // another active member only the ones assigned to them. Anyone else, and a made-up organization,
  // get the same empty answer.
  if (!isUuid(actorAccountId) || !isUuid(organizationId)) return new Map();
  if (!(await isActiveMember(db, actorAccountId, organizationId))) return new Map();
  const requested = [...new Set(requestedMissionIds)].filter(isUuid);
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
      .select({ missionId: schema.missions.id, expiryAt: schema.grants.expiryAt })
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
  const ends = new Map<string, Date | null>();
  for (const { missionId, expiryAt } of rows) {
    if (!ends.has(missionId)) {
      ends.set(missionId, expiryAt);
      continue;
    }
    const known = ends.get(missionId) ?? null;
    // No end date on any live grant means no end to show.
    if (known === null || expiryAt === null) ends.set(missionId, null);
    else if (expiryAt.getTime() > known.getTime()) ends.set(missionId, expiryAt);
  }
  return ends;
}
