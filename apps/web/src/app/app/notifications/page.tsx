import { listNotificationsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '../../../components/ui';
import { formatTimestampDate } from '../../../lib/format-date';
import { withSession } from '../../../lib/session';
import { markNotificationReadAction } from './actions';

export const metadata: Metadata = { title: 'Alerts' };

export const dynamic = 'force-dynamic';

/**
 * NTF-02's in-app channel: every notification actually sent to this account,
 * newest first. The product calls this page "Alerts" (directive Part 9 UX-01);
 * the route and the stored records keep the older name.
 */
export default async function NotificationsPage() {
  const notifications = await withSession(({ db, accountId }) =>
    listNotificationsForAccount(db, accountId),
  );

  return (
    <section className="section container">
      <PageHeader eyebrow="Alerts" title="Updates on Your Cases" />

      <article className="card">
        {notifications.length === 0 ? (
          <EmptyState icon="bell" title="No Alerts Yet">
            Updates about your cases, requests for evidence and documents nearing expiry will appear
            here, each with a button that takes you to what needs doing.
          </EmptyState>
        ) : (
          <div className="rows">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="row"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <span className="row-key">
                    {n.subject}
                    {!n.read ? (
                      <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>
                        New
                      </span>
                    ) : null}
                  </span>
                  <span className="muted u-fs-075">{formatTimestampDate(n.createdAt)}</span>
                </div>
                <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
                  {n.summary}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Link
                    href={n.deepLinkPath}
                    className="btn btn-secondary"
                    style={{ padding: '0.3rem 0.9rem', fontSize: 'var(--text-small)' }}
                  >
                    Open
                  </Link>
                  {!n.read ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <button
                        type="submit"
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.9rem', fontSize: 'var(--text-small)' }}
                      >
                        Mark Read
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
