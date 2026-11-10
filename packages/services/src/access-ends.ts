import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { withCaseExclusions } from './access/grant-scope';
import { type Db, schema } from './db';
import { presentApplicantCondition } from './lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';

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
  organizationId: string,
): Promise<ReadonlyMap<string, Date | null>> {
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
