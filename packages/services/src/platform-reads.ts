import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { getAccountByEmail } from './accounts';
import type { Applicant } from './applicants';
import type { AuditEventRow } from './audit';
import { type Db, schema } from './db';
import type { ServiceError } from './errors';
import {
  type Page,
  type PageRequest,
  belowSeq,
  clampLimit,
  decodeSeqCursor,
  encodeSeqCursor,
  toPage,
} from './paging';

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

/** One audit entry as the paged trail returns it: the row plus the actor's sign-in email, if any. */
export interface AuditTrailEntry extends AuditEventRow {
  /** The acting account's current email; null for a job, a removed account or no actor. */
  readonly actorEmail: string | null;
}

/** WP-SB6: one page of the audit trail, optionally only what one person did. */
export interface AuditTrailRequest extends PageRequest {
  /**
   * Only entries whose acting account has this email (compared without case). Anything that is
   * not a plausible email is ignored, so a hand-edited address shows the whole trail.
   */
  readonly who?: string;
}

/** One page of the trail. `whoMatched` says whether the Who filter named a current account. */
export interface AuditTrailPage extends Page<AuditTrailEntry> {
  /** Null without a Who filter; false when no current account signs in with that email. */
  readonly whoMatched: boolean | null;
}

/** The longest email the Who filter accepts (the address standard's own limit). */
const WHO_MAX_LENGTH = 254;

/** A plausible email for the Who filter, lower case, or null. */
export function auditTrailWho(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > WHO_MAX_LENGTH) return null;
  return /^[^\s@]+@[^\s@]+$/.test(trimmed) ? trimmed : null;
}

/** The newest audit events across every tenant, newest first. For the security administrator only. */
export async function listRecentAuditEvents(
  db: Db,
  staff: StaffScope<'AUDIT_TRAIL_VIEW'>,
  limit?: number,
): Promise<Result<AuditEventRow[], ServiceError>>;
/**
 * WP-SB6: one page of the same trail for the Audit page's Show Older Entries, ordered by the
 * audit sequence number (never by time, which two entries can share). `before` is the previous
 * page's `nextCursor`; it is bound to the platform audit view and to the Who filter, so a cursor
 * from another view or another filter, or anything malformed, gives the first page. The role
 * check is the same as above. Read only: no audit row is ever changed by paging.
 */
export async function listRecentAuditEvents(
  db: Db,
  staff: StaffScope<'AUDIT_TRAIL_VIEW'>,
  options: AuditTrailRequest,
): Promise<Result<AuditTrailPage, ServiceError>>;
export async function listRecentAuditEvents(
  db: Db,
  staff: StaffScope<'AUDIT_TRAIL_VIEW'>,
  limitOrOptions: number | AuditTrailRequest = 100,
): Promise<Result<AuditEventRow[] | AuditTrailPage, ServiceError>> {
  const problem = staffScopeProblem(staff, 'AUDIT_TRAIL_VIEW');
  if (problem) return err(problem);
  if (typeof limitOrOptions === 'object') return ok(await auditTrailPage(db, limitOrOptions));
  const limit = limitOrOptions;
  const bounded = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), AUDIT_READ_MAX))
    : 100;
  return ok(
    await db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.seq)).limit(bounded),
  );
}

async function auditTrailPage(db: Db, request: AuditTrailRequest): Promise<AuditTrailPage> {
  const who = auditTrailWho(request.who);
  const scope = who ? `platform:audit:who:${who}` : 'platform:audit';
  const limit = clampLimit(request.limit);
  const before = decodeSeqCursor(request.before, scope);
  const a = schema.auditEvents;
  // The Who filter names an account by email; the trail itself stores only the account id, so
  // the id is found first (through the accounts email index) and the trail is filtered on it. No
  // current account has that email: nothing to show, and the page says why.
  let actorId: string | null = null;
  if (who) {
    const account = await getAccountByEmail(db, who);
    if (!account) return { items: [], nextCursor: null, whoMatched: false };
    actorId = account.id;
  }
  const conditions = [
    before ? belowSeq(a.seq, before) : undefined,
    actorId ? eq(a.actorAccountId, actorId) : undefined,
  ].filter((condition) => condition !== undefined);
  const rows = await db
    .select({ event: a, actorEmail: schema.accounts.email })
    .from(a)
    .leftJoin(schema.accounts, eq(schema.accounts.id, a.actorAccountId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(a.seq))
    .limit(limit + 1);
  const entries = rows.map(({ event, actorEmail }) => ({
    ...event,
    actorEmail: actorEmail ?? null,
  }));
  const page = toPage(entries, limit, (last) => encodeSeqCursor(last.seq, scope));
  return { ...page, whoMatched: who ? true : null };
}
