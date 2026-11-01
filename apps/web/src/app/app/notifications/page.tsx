import { listNotificationsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import { DepthScope, atLevel } from '../../../components/depth';
import { DepthSwitch } from '../../../components/depth-switch';
import { EmptyState, PageHeader } from '../../../components/ui';
import type { DepthLevel } from '../../../lib/ccd/depth';
import { depthCopyFor } from '../../../lib/ccd/depth-copy';
import { readDepth } from '../../../lib/ccd/depth.server';
import {
  type SearchParamsRecord,
  TRAVELLER_LIST_STEP,
  nextShow,
  parseShow,
} from '../../../lib/paging';
import { withSession } from '../../../lib/session';
import { markAllNotificationsReadAction, markNotificationReadAction } from './actions';
import { NotificationList } from './notification-list';

export const metadata: Metadata = { title: 'Notifications' };

/** Read notifications shown at Browse; older read ones wait at Everything. */
const RECENT_READ_SHOWN = 10;

export const dynamic = 'force-dynamic';

/**
 * NTF-02's in-app channel: every notification actually sent to this account. The product calls
 * this page "Notifications" (decision D3, which retired "Alerts"); the route and the stored records
 * keep the same name.
 *
 * WP-SB1: unread ones come first, then read ones, each newest first. Ten load at a time inside a
 * panel of fixed height; Show More asks the server for ten more, and Mark All Read clears them.
 */
/** The address parameters this page reads. */
interface NotificationsPageProps {
  readonly searchParams?: Promise<SearchParamsRecord & { readonly show?: string | string[] }>;
}

// Next.js reads the props type from the last signature; the bare call serves older tests.
export default async function NotificationsPage(): Promise<React.JSX.Element>;
export default async function NotificationsPage(
  props: NotificationsPageProps,
): Promise<React.JSX.Element>;
export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps = {}): Promise<React.JSX.Element> {
  const query = (await searchParams) ?? {};
  const shown = parseShow(query.show, { step: TRAVELLER_LIST_STEP });
  // One more than shown proves whether another step exists.
  const read = await withSession(({ db, accountId }) =>
    listNotificationsForAccount(db, accountId, { unreadFirst: true, limit: shown + 1 }),
  );
  const notifications = read.slice(0, shown);
  const next =
    read.length > notifications.length
      ? nextShow(notifications.length, { step: TRAVELLER_LIST_STEP })
      : null;
  const depth = await readDepth('notifications');
  // Unread ones are the Glance; the most recent read ones are Browse; the rest are Everything.
  const recentRead = new Set(
    notifications
      .filter((n) => n.read)
      .slice(0, RECENT_READ_SHOWN)
      .map((n) => n.id),
  );
  const levelOf = (n: { readonly id: string; readonly read: boolean }): DepthLevel | null =>
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
            <NotificationList
              notifications={notifications.map((n) => ({ ...n, level: levelOf(n) }))}
              next={next}
              searchParams={query}
              markReadAction={markNotificationReadAction}
              markAllReadAction={markAllNotificationsReadAction}
            />
          )}
        </article>
      </DepthScope>
    </section>
  );
}
