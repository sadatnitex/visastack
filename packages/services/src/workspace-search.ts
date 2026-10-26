import {
  type ReferenceKind,
  type Result,
  err,
  formatReferenceCode,
  ok,
  parseReferenceCode,
} from '@visastack/core';
import {
  type SQL,
  and,
  asc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { withCaseExclusions } from './access/grant-scope';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { findReferenceEntity } from './reference-codes';

export interface WorkspaceSearchResult {
  readonly category: 'Profile' | 'Case' | 'Document' | 'Client' | 'Request';
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
    const visibleCases = (match: SQL, limit: number) =>
      withCaseExclusions(db, (covers) =>
        db
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
              // The same case-scope rule as the case list, per-case exceptions included (ADR 0017).
              covers(schema.missions.id),
              eq(schema.organizations.status, 'ACTIVE'),
              sql`exists (select 1 from ${schema.memberships} where ${schema.memberships.organizationId} = ${scope.organizationId} and ${schema.memberships.accountId} = ${actorAccountId} and ${schema.memberships.active} = true and (${schema.memberships.role} in ('OWNER', 'ADMIN') or exists (select 1 from ${schema.assignments} where ${schema.assignments.organizationId} = ${scope.organizationId} and ${schema.assignments.memberAccountId} = ${actorAccountId} and ${schema.assignments.missionId} = ${schema.missions.id})))`,
              match,
            ),
          )
          .orderBy(asc(schema.missions.id))
          .limit(limit),
      );
    const code = parseReferenceCode(value);
    if (code.ok) {
      return ok(
        await agencyCodeResults(db, scope.organizationId, actorAccountId, code, visibleCases),
      );
    }
    const cases = await visibleCases(
      or(
        ilike(schema.missions.title, pattern),
        ilike(schema.applicants.displayName, pattern),
      ) as SQL,
      12,
    );
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
  const code = parseReferenceCode(value);
  if (code.ok) return ok(await personalCodeResults(db, owned, code));
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

// --- Visible reference codes (ADR 0018) --------------------------------------
//
// A query that reads as a reference code (`C-7K2Q9M`) is answered only with the
// one record it names, and only when the same search would let this person see
// it: the owner's own records, or the agency's visible cases and its own
// requests. A code that is unknown, for a deleted record or for a record this
// person may not see gives the same empty answer.

type ParsedCode = { readonly kind: ReferenceKind; readonly code: string };

async function personalCodeResults(
  db: Db,
  owned: SQL | undefined,
  parsed: ParsedCode,
): Promise<WorkspaceSearchResult[]> {
  const entityId = await findReferenceEntity(db, parsed.kind, parsed.code);
  if (!entityId) return [];
  const reference = formatReferenceCode(parsed.kind, parsed.code);
  switch (parsed.kind) {
    case 'P': {
      const [row] = await db
        .select({ id: schema.applicants.id, name: schema.applicants.displayName })
        .from(schema.applicants)
        .where(and(owned, eq(schema.applicants.id, entityId)))
        .limit(1);
      return row
        ? [
            {
              category: 'Profile',
              id: row.id,
              label: `${reference} ${row.name}`,
              href: `/app/applicant/${row.id}/profile`,
            },
          ]
        : [];
    }
    case 'C': {
      const [row] = await db
        .select({ id: schema.missions.id, title: schema.missions.title })
        .from(schema.missions)
        .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
        .where(and(owned, eq(schema.missions.id, entityId)))
        .limit(1);
      return row
        ? [
            {
              category: 'Case',
              id: row.id,
              label: `${reference} ${row.title}`,
              href: `/app/mission/${row.id}`,
            },
          ]
        : [];
    }
    case 'D': {
      const [row] = await db
        .select({
          id: schema.documents.id,
          applicantId: schema.applicants.id,
          originalName: schema.documents.originalName,
          approvedName: schema.documents.approvedName,
        })
        .from(schema.documents)
        .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
        .where(
          and(owned, eq(schema.documents.walletVisible, true), eq(schema.documents.id, entityId)),
        )
        .limit(1);
      return row
        ? [
            {
              category: 'Document',
              id: row.id,
              label: `${reference} ${row.approvedName ?? row.originalName}`,
              href: `/app/applicant/${row.applicantId}/documents#document-${row.id}`,
            },
          ]
        : [];
    }
    case 'R': {
      const [row] = await db
        .select({ id: schema.evidenceRequests.id, applicantId: schema.applicants.id })
        .from(schema.evidenceRequests)
        .innerJoin(schema.applicants, eq(schema.applicants.id, schema.evidenceRequests.applicantId))
        .where(and(owned, eq(schema.evidenceRequests.id, entityId)))
        .limit(1);
      return row
        ? [
            {
              category: 'Request',
              id: row.id,
              label: `${reference} Evidence Request`,
              href: `/app/applicant/${row.applicantId}/evidence#request-${row.id}`,
            },
          ]
        : [];
    }
  }
}

async function agencyCodeResults(
  db: Db,
  organizationId: string,
  actorAccountId: string,
  parsed: ParsedCode,
  visibleCases: (
    match: SQL,
    limit: number,
  ) => Promise<readonly { id: string; title: string; applicantId: string; name: string }[]>,
): Promise<WorkspaceSearchResult[]> {
  const entityId = await findReferenceEntity(db, parsed.kind, parsed.code);
  if (!entityId) return [];
  const reference = formatReferenceCode(parsed.kind, parsed.code);
  const caseHref = (missionId: string) =>
    `/app/agency/${organizationId}/cases#mission-${missionId}`;
  switch (parsed.kind) {
    case 'C': {
      const [row] = await visibleCases(eq(schema.missions.id, entityId), 1);
      return row
        ? [
            {
              category: 'Case',
              id: row.id,
              label: `${reference} ${row.title}`,
              href: caseHref(row.id),
            },
          ]
        : [];
    }
    case 'P': {
      // A client opens at a case the agency may see, never at an owner-only profile.
      const [row] = await visibleCases(eq(schema.applicants.id, entityId), 1);
      return row
        ? [
            {
              category: 'Client',
              id: row.applicantId,
              label: `${reference} ${row.name}`,
              href: caseHref(row.id),
            },
          ]
        : [];
    }
    case 'R': {
      // The agency's own request, for its administrators (who manage requests), on
      // a case it still sees, or for a traveller it still sees a case of.
      const [admin] = await db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.organizationId, organizationId),
            eq(schema.memberships.accountId, actorAccountId),
            eq(schema.memberships.active, true),
            inArray(schema.memberships.role, ['OWNER', 'ADMIN']),
          ),
        )
        .limit(1);
      if (!admin) return [];
      const [request] = await db
        .select({
          id: schema.evidenceRequests.id,
          applicantId: schema.evidenceRequests.applicantId,
          missionId: schema.evidenceRequests.missionId,
        })
        .from(schema.evidenceRequests)
        .where(
          and(
            eq(schema.evidenceRequests.id, entityId),
            eq(schema.evidenceRequests.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!request) return [];
      const [seen] = await visibleCases(
        request.missionId
          ? eq(schema.missions.id, request.missionId)
          : eq(schema.applicants.id, request.applicantId),
        1,
      );
      return seen
        ? [
            {
              category: 'Request',
              id: request.id,
              label: `${reference} Evidence Request`,
              href: `/app/agency/${organizationId}/clients#request-${request.id}`,
            },
          ]
        : [];
    }
    case 'D':
      // Agencies reach documents through cases and requests, not by code.
      return [];
  }
}
