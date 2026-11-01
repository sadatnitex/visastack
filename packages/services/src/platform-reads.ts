import { type Result, err, ok } from '@visastack/core';
import { asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import type { Applicant } from './applicants';
import type { AuditEventRow } from './audit';
import { type Db, schema } from './db';
import type { ServiceError } from './errors';

/**
 * Platform-wide reads that span every traveller. Each one takes the staff scope for exactly its
 * platform action, so the role is checked inside the service and a page cannot forget to ask
 * (S2, M13). A caller without the role is refused the same way for every role: nothing about
 * what exists is revealed.
 */

/** Hard ceiling for the audit read: a page asking for more still gets this many. */
const AUDIT_READ_MAX = 500;

/** The most matches one applicant search returns (WP-SB7: the privacy picker searches as you type). */
export const APPLICANT_SEARCH_MAX = 20;
/** The fewest characters a name search needs; shorter text matches nothing. */
export const APPLICANT_SEARCH_MIN_CHARS = 2;
/** The most applicants one name lookup resolves (the rows on one screen of the privacy page). */
export const APPLICANT_LOOKUP_MAX = 500;

const APPLICANT_SEARCH_MAX_CHARS = 100;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only what the privacy page shows of an applicant: the id and the name. */
export interface ApplicantDirectoryEntry {
  readonly id: string;
  readonly displayName: string;
}

/** A narrow read of the applicant directory: a name search, or names for ids already on screen. */
export type ApplicantDirectoryQuery =
  | {
      /** Part of a name (any case), or a whole applicant id. At most 20 matches, by name. */
      readonly search: string;
    }
  | {
      /** Ids whose names the page needs; anything that is not an id is ignored. At most 500. */
      readonly ids: readonly string[];
    };

/**
 * Every applicant, platform-wide. For the privacy administrator's pickers and lookups only.
 * With a query, only the id and name of at most 20 search matches, or of the ids asked for: the
 * same role check either way, and nothing about an applicant beyond what the page shows.
 */
export async function listAllApplicants(
  db: Db,
  staff: StaffScope<'APPLICANT_DIRECTORY_VIEW'>,
): Promise<Result<Applicant[], ServiceError>>;
export async function listAllApplicants(
  db: Db,
  staff: StaffScope<'APPLICANT_DIRECTORY_VIEW'>,
  query: ApplicantDirectoryQuery,
): Promise<Result<ApplicantDirectoryEntry[], ServiceError>>;
export async function listAllApplicants(
  db: Db,
  staff: StaffScope<'APPLICANT_DIRECTORY_VIEW'>,
  query?: ApplicantDirectoryQuery,
): Promise<Result<Applicant[] | ApplicantDirectoryEntry[], ServiceError>> {
  const problem = staffScopeProblem(staff, 'APPLICANT_DIRECTORY_VIEW');
  if (problem) return err(problem);
  if (!query) return ok(await db.select().from(schema.applicants));
  const table = schema.applicants;
  const columns = { id: table.id, displayName: table.displayName };
  if ('ids' in query) {
    const ids = [...new Set(query.ids.filter((id) => UUID_SHAPE.test(id)))].slice(
      0,
      APPLICANT_LOOKUP_MAX,
    );
    if (ids.length === 0) return ok([]);
    return ok(await db.select(columns).from(table).where(inArray(table.id, ids)));
  }
  const text = query.search.trim().slice(0, APPLICANT_SEARCH_MAX_CHARS);
  if (text.length < APPLICANT_SEARCH_MIN_CHARS) return ok([]);
  const byName = ilike(table.displayName, `%${text.replace(/[\\%_]/g, '\\$&')}%`);
  return ok(
    await db
      .select(columns)
      .from(table)
      .where(UUID_SHAPE.test(text) ? or(eq(table.id, text.toLowerCase()), byName) : byName)
      .orderBy(asc(table.displayName), asc(table.id))
      .limit(APPLICANT_SEARCH_MAX),
  );
}

/** The newest audit events across every tenant, newest first. For the security administrator only. */
export async function listRecentAuditEvents(
  db: Db,
  staff: StaffScope<'AUDIT_TRAIL_VIEW'>,
  limit = 100,
): Promise<Result<AuditEventRow[], ServiceError>> {
  const problem = staffScopeProblem(staff, 'AUDIT_TRAIL_VIEW');
  if (problem) return err(problem);
  const bounded = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), AUDIT_READ_MAX))
    : 100;
  return ok(
    await db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.seq)).limit(bounded),
  );
}
