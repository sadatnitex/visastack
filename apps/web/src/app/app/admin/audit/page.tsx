import { type AuditEventRow, listRecentAuditEvents } from '@visastack/services';
import type { Metadata } from 'next';
import { ActivityLog } from '../../../../components/activity-log';
import { EmptyState } from '../../../../components/ui';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, isPlatformAdmin, staffPrincipal } from '../../../../lib/admin';
import { formatTimestamp } from '../../../../lib/format-date';
import { eventTypeLabel } from '../../../../lib/labels';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { AdminNotForRole, AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const metadata: Metadata = { title: 'Audit' };

export const dynamic = 'force-dynamic';

/** How many of the newest audit entries the page reads; they scroll and filter in one box. */
const AUDIT_LOG_LIMIT = 300;

/** The newest entries of the audit trail, every sensitive action across every tenant. */
export default async function AdminAuditPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    // The whole trail spans every traveller, so it is a security-administrator view.
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'AUDIT_TRAIL_VIEW',
    );
    if (!staff.ok) return { admin: true as const, allowed: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    const auditEvents = await t(
      'audit events',
      async () => {
        const listed = await listRecentAuditEvents(db, staff.value, AUDIT_LOG_LIMIT);
        if (!listed.ok) throw new Error(listed.error.message);
        return listed.value;
      },
      [],
    );
    return { admin: true as const, allowed: true as const, auditEvents, failedSections };
  });

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Audit"
        description="The platform's append-only, hash-chained audit trail."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : !data.allowed ? (
        <AdminNotForRole />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <article className="card u-mt-150" id="admin-audit">
            <p className="card-kicker">Transparency</p>
            <h2 className="card-title">Recent Audit Events</h2>
            <p className="card-body u-mb-100">
              The last {data.auditEvents.length} entries of the platform's append-only, hash-chained
              audit trail - every sensitive action across every tenant, newest first.
            </p>
            {data.auditEvents.length === 0 ? (
              <EmptyState title="No Audit Events Yet" icon="activity">
                Sensitive actions across the platform are recorded here as they happen.
              </EmptyState>
            ) : (
              <ActivityLog
                label="Audit Events"
                entries={data.auditEvents.map((event: AuditEventRow) => ({
                  id: String(event.seq),
                  what: eventTypeLabel(event.eventType),
                  detail: [
                    `Code ${event.eventType}`,
                    event.resourceType ? `Resource ${event.resourceType}` : null,
                    event.reason ? `Reason: ${event.reason}` : null,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' \u00b7 '),
                  result: event.result,
                  at: event.occurredAt.toISOString(),
                  when: formatTimestamp(event.occurredAt),
                }))}
              />
            )}
          </article>
        </>
      )}
    </section>
  );
}
