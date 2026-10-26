import { type Result, err, ok } from '@visastack/core';
import { desc } from 'drizzle-orm';
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

/** Every applicant, platform-wide. For the privacy administrator's pickers and lookups only. */
export async function listAllApplicants(
  db: Db,
  staff: StaffScope<'APPLICANT_DIRECTORY_VIEW'>,
): Promise<Result<Applicant[], ServiceError>> {
  const problem = staffScopeProblem(staff, 'APPLICANT_DIRECTORY_VIEW');
  if (problem) return err(problem);
  return ok(await db.select().from(schema.applicants));
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
