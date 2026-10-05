import { type AuditEventRow, listRecentAuditEvents } from '@visastack/services';
import { isPlatformAdmin } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

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
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Platform</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Audit
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            The platform's append-only, hash-chained audit trail.
          </p>
        </div>
      </div>

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
              <p className="card-body">No audit events recorded yet.</p>
            ) : (
              <div className="rows">
                {data.auditEvents.map((event: AuditEventRow) => (
                  <div
                    className="row"
                    key={event.seq}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
                  >
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}
                    >
                      <span className="row-key mono" style={{ fontSize: '0.85rem' }}>
                        {event.eventType}
                      </span>
                      {event.result ? (
                        <span
                          className={`badge ${event.result === 'DENIED' ? 'badge-danger' : 'badge-neutral'}`}
                        >
                          {event.result}
                        </span>
                      ) : null}
                    </div>
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      {event.occurredAt.toLocaleString()}
                      {event.resourceType ? ` · ${event.resourceType}` : ''}
                      {event.reason ? ` · ${event.reason}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
