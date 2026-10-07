import { type AuditEventRow, listRecentAuditEvents } from '@visastack/services';
import type { Metadata } from 'next';
import { EmptyState, StatusBadge } from '../../../../components/ui';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin } from '../../../../lib/admin';
import { formatTimestamp } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const metadata: Metadata = { title: 'Audit' };

export const dynamic = 'force-dynamic';

/** The newest entries of the audit trail, every sensitive action across every tenant. */
export default async function AdminAuditPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    const auditEvents = await t('audit events', () => listRecentAuditEvents(db, 50), []);
    return { admin: true as const, auditEvents, failedSections };
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
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <article className="card" style={{ marginTop: '1.5rem' }} id="admin-audit">
            <p className="card-kicker">Transparency</p>
            <h2 className="card-title">Recent audit events</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              The last {data.auditEvents.length} entries of the platform's append-only, hash-chained
              audit trail - every sensitive action across every tenant, newest first.
            </p>
            {data.auditEvents.length === 0 ? (
              <EmptyState title="No audit events yet" icon="activity">
                Sensitive actions across the platform are recorded here as they happen.
              </EmptyState>
            ) : (
              <table className="data-table">
                <caption className="sr-only">Recent audit events, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Event</th>
                    <th scope="col">Result</th>
                    <th scope="col">Resource</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditEvents.map((event: AuditEventRow) => (
                    <tr key={event.seq}>
                      <td data-label="When">{formatTimestamp(event.occurredAt)}</td>
                      <th scope="row" className="mono">
                        {event.eventType}
                      </th>
                      <td data-label="Result">
                        {event.result ? (
                          <StatusBadge tone={event.result === 'DENIED' ? 'danger' : 'neutral'}>
                            {event.result}
                          </StatusBadge>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td data-label="Resource">{event.resourceType ?? '-'}</td>
                      <td data-label="Reason">{event.reason ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </>
      )}
    </section>
  );
}
