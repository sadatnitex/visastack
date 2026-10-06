import { listNotificationsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
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
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Alerts</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Updates on your cases
          </h1>
        </div>
      </div>

      <article className="card">
        {notifications.length === 0 ? (
          <p className="card-body">
            No alerts yet. Updates about your cases, requests for evidence and documents nearing
            expiry will appear here.
          </p>
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
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {n.createdAt.toLocaleDateString()}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                  {n.summary}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Link
                    href={n.deepLinkPath}
                    className="btn btn-secondary"
                    style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
                  >
                    Open
                  </Link>
                  {!n.read ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <button
                        type="submit"
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
                      >
                        Mark read
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
