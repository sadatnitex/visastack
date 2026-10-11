import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, gt, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';

export interface WorkspaceSearchResult {
  readonly category: 'Profile' | 'Case' | 'Document' | 'Client';
  readonly id: string;
  readonly label: string;
  readonly href: string;
}
export type WorkspaceSearchScope =
  | { readonly kind: 'personal'; readonly applicantId?: string }
  | { readonly kind: 'agency'; readonly organizationId: string };

/** Metadata-only, literal substring search. No facts, document text or storage keys are read. */
export async function searchWorkspaceRecords(
  db: Db,
  actorAccountId: string,
  scope: WorkspaceSearchScope,
  query: string,
): Promise<Result<readonly WorkspaceSearchResult[], ServiceError>> {
  const subjectId = scope.kind === 'agency' ? scope.organizationId : scope.applicantId;
  if (
    subjectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)
  )
    return err(serviceError('invalid', 'Choose an available workspace.'));
  const value = query.trim();
  if (value.length < 2 || value.length > 80)
    return err(serviceError('invalid', 'Use between 2 and 80 characters.'));
  const pattern = `%${value.replace(/[\\%_]/g, '\\$&')}%`;
  if (scope.kind === 'agency') {
    const membership = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.memberships.organizationId),
      )
      .where(
        and(
          eq(schema.memberships.accountId, actorAccountId),
          eq(schema.memberships.organizationId, scope.organizationId),
          eq(schema.memberships.active, true),
          eq(schema.organizations.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!membership.length)
      return err(serviceError('forbidden', 'This agency workspace is unavailable.'));
    const now = new Date();
    // Same current grant and assignment boundaries as the existing visible-case list.
    const cases = await db
      .selectDistinct({
        id: schema.missions.id,
        title: schema.missions.title,
        applicantId: schema.applicants.id,
        name: schema.applicants.displayName,
      })
      .from(schema.grants)
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
      .innerJoin(schema.missions, eq(schema.missions.applicantId, schema.applicants.id))
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.grants.recipientOrganizationId),
      )
      .where(
        and(
          eq(schema.grants.recipientOrganizationId, scope.organizationId),
          eq(schema.grants.status, 'ACTIVE'),
          isNotNull(schema.grants.acceptedAt),
          lte(schema.grants.startAt, now),
          or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
          or(isNull(schema.grants.missionId), eq(schema.grants.missionId, schema.missions.id)),
          eq(schema.organizations.status, 'ACTIVE'),
          sql`exists (select 1 from ${schema.memberships} where ${schema.memberships.organizationId} = ${scope.organizationId} and ${schema.memberships.accountId} = ${actorAccountId} and ${schema.memberships.active} = true and (${schema.memberships.role} in ('OWNER', 'ADMIN') or exists (select 1 from ${schema.assignments} where ${schema.assignments.organizationId} = ${scope.organizationId} and ${schema.assignments.memberAccountId} = ${actorAccountId} and ${schema.assignments.missionId} = ${schema.missions.id})))`,
          or(ilike(schema.missions.title, pattern), ilike(schema.applicants.displayName, pattern)),
        ),
      )
      .orderBy(asc(schema.missions.id))
      .limit(12);
    const results: WorkspaceSearchResult[] = cases.map((row) => ({
      category: 'Case',
      id: row.id,
      label: row.title,
      href: `/app/agency/${scope.organizationId}/cases#mission-${row.id}`,
    }));
    // Client matches navigate to that client's accessible case, never an owner-only profile.
    const clients = new Map<string, WorkspaceSearchResult>();
    for (const row of cases)
      if (row.name.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
        clients.set(row.applicantId, {
          category: 'Client',
          id: row.applicantId,
          label: row.name,
          href: `/app/agency/${scope.organizationId}/cases#mission-${row.id}`,
        });
    return ok([...results.slice(0, 6), ...[...clients.values()].slice(0, 6)]);
  }
  const owned = and(
    eq(schema.applicants.ownerAccountId, actorAccountId),
    scope.applicantId ? eq(schema.applicants.id, scope.applicantId) : undefined,
  );
  if (scope.applicantId) {
    const subject = await db
      .select({ id: schema.applicants.id })
      .from(schema.applicants)
      .where(owned)
      .limit(1);
    if (!subject.length)
      return err(serviceError('forbidden', 'This traveller workspace is unavailable.'));
  }
  const [people, cases, documents] = await Promise.all([
    db
      .select({ id: schema.applicants.id, name: schema.applicants.displayName })
      .from(schema.applicants)
      .where(and(owned, ilike(schema.applicants.displayName, pattern)))
      .orderBy(asc(schema.applicants.id))
      .limit(6),
    db
      .select({ id: schema.missions.id, title: schema.missions.title })
      .from(schema.missions)
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
      .where(and(owned, ilike(schema.missions.title, pattern)))
      .orderBy(asc(schema.missions.id))
      .limit(6),
    db
      .select({
        id: schema.documents.id,
        applicantId: schema.applicants.id,
        originalName: schema.documents.originalName,
        approvedName: schema.documents.approvedName,
      })
      .from(schema.documents)
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
      .where(
        and(
          owned,
          eq(schema.documents.walletVisible, true),
          or(
            ilike(schema.documents.originalName, pattern),
            ilike(schema.documents.approvedName, pattern),
          ),
        ),
      )
      .orderBy(asc(schema.documents.id))
      .limit(6),
  ]);
  return ok([
    ...people.map(
      (row): WorkspaceSearchResult => ({
        category: 'Profile',
        id: row.id,
        label: row.name,
        href: `/app/applicant/${row.id}/profile`,
      }),
    ),
    ...cases.map(
      (row): WorkspaceSearchResult => ({
        category: 'Case',
        id: row.id,
        label: row.title,
        href: `/app/mission/${row.id}`,
      }),
    ),
    ...documents.map(
      (row): WorkspaceSearchResult => ({
        category: 'Document',
        id: row.id,
        label: row.approvedName ?? row.originalName,
        href: `/app/applicant/${row.applicantId}/documents#document-${row.id}`,
      }),
    ),
  ]);
}
