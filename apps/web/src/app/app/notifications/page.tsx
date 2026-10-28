import { listNotificationsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DepthScope, atLevel } from '../../../components/depth';
import { DepthSwitch } from '../../../components/depth-switch';
import { EmptyState, PageHeader } from '../../../components/ui';
import { depthCopyFor } from '../../../lib/ccd/depth-copy';
import { readDepth } from '../../../lib/ccd/depth.server';
import { formatTimestampDate } from '../../../lib/format-date';
import { withSession } from '../../../lib/session';
import { markNotificationReadAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };

/** Read notifications shown at Browse; older read ones wait at Everything. */
const RECENT_READ_SHOWN = 10;

export const dynamic = 'force-dynamic';

/**
 * NTF-02's in-app channel: every notification actually sent to this account,
 * newest first. The product calls this page "Notifications" (decision D3, which retired
 * "Alerts"); the route and the stored records keep the same name.
 */
export default async function NotificationsPage() {
  const notifications = await withSession(({ db, accountId }) =>
    listNotificationsForAccount(db, accountId),
  );
  const depth = await readDepth('notifications');
  // Unread ones are the Glance; the most recent read ones are Browse; the rest are Everything.
  const recentRead = new Set(
    notifications
      .filter((n) => n.read)
      .slice(0, RECENT_READ_SHOWN)
      .map((n) => n.id),
  );
  const levelOf = (n: { readonly id: string; readonly read: boolean }) =>
    !n.read ? null : recentRead.has(n.id) ? 'browse' : 'everything';
  const allRead = notifications.length > 0 && notifications.every((n) => n.read);

  return (
    <section className="section container">
      <PageHeader eyebrow="Account" title="Notifications" />

      <DepthScope family="notifications" depth={depth}>
        <DepthSwitch family="notifications" initial={depth} copy={depthCopyFor('notifications')} />
        {allRead ? (
          <p className="muted" data-only="glance">
            Nothing unread in your latest notifications.
          </p>
        ) : null}

        {/* With nothing unread, the list itself starts at Browse: no empty card at Glance. */}
        <article className="card" {...(allRead ? atLevel('browse') : {})}>
          {notifications.length === 0 ? (
            <EmptyState
              icon="bell"
              title="No Notifications Yet"
              why="You never have to open every case to find out what changed."
              action={{ href: '/app', label: 'Go to Home' }}
            >
              This is where VisaStack tells you what needs you: a request from an agency, a document
              close to expiring, a case that moved. Nothing needs you right now.
            </EmptyState>
          ) : (
            <div className="rows">
              {notifications.map((n) => {
                const level = levelOf(n);
                return (
                  <div
                    key={n.id}
                    {...(level ? atLevel(level) : {})}
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
                );
              })}
            </div>
          )}
        </article>
      </DepthScope>
    </section>
  );
}
