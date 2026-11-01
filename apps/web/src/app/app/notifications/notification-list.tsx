import Link from 'next/link';
import { atLevel } from '../../../components/depth';
import { ShowMore } from '../../../components/show-more';
import type { DepthLevel } from '../../../lib/ccd/depth';
import { formatTimestampDate } from '../../../lib/format-date';
import type { SearchParamsRecord } from '../../../lib/paging';

export interface NotificationRow {
  readonly id: string;
  readonly subject: string;
  readonly summary: string;
  readonly deepLinkPath: string;
  readonly read: boolean;
  readonly createdAt: Date;
  /** The depth a row first shows at; none means every depth (unread rows). */
  readonly level: DepthLevel | null;
}

type FormAction = (formData: FormData) => void | Promise<void>;

/** The id of the n-th notification on the page (from 1), so Show More lands on the first new one. */
const rowAnchor = (position: number) => `notification-${position}`;

/**
 * The notification list (WP-SB1): Mark All Read above a panel of fixed height that scrolls inside,
 * then how many show and Show More, which asks the server for ten more.
 */
export function NotificationList({
  notifications,
  next,
  searchParams,
  markReadAction,
  markAllReadAction,
}: {
  readonly notifications: readonly NotificationRow[];
  /** The `show` value for the next load; null when nothing more exists. */
  readonly next: number | null;
  readonly searchParams: SearchParamsRecord;
  readonly markReadAction: FormAction;
  readonly markAllReadAction: FormAction;
}) {
  const anyUnread = notifications.some((n) => !n.read);
  return (
    <>
      {anyUnread ? (
        <form className="notifications-mark-all" action={markAllReadAction}>
          <button type="submit" className="btn btn-secondary u-btn-sm">
            Mark All Read
          </button>
        </form>
      ) : null}
      <section
        className="activity-log-scroll notifications-scroll"
        aria-label="Notification List"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
        tabIndex={0}
      >
        <div className="rows">
          {notifications.map((n, index) => (
            <div
              key={n.id}
              id={rowAnchor(index + 1)}
              {...(n.level ? atLevel(n.level) : {})}
              className="row notification-row"
            >
              <div className="notification-head">
                <span className="row-key">
                  {n.subject}
                  {!n.read ? (
                    <span className="badge badge-warning notification-new">New</span>
                  ) : null}
                </span>
                <span className="muted u-fs-075">{formatTimestampDate(n.createdAt)}</span>
              </div>
              <p className="muted notification-summary">{n.summary}</p>
              <div className="notification-actions">
                <Link href={n.deepLinkPath} className="btn btn-secondary u-btn-sm">
                  Open
                </Link>
                {!n.read ? (
                  <form action={markReadAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button type="submit" className="btn btn-secondary u-btn-sm">
                      Mark Read
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
      <ShowMore
        id="notifications-more"
        landOn={rowAnchor(notifications.length + 1)}
        pathname="/app/notifications"
        searchParams={searchParams}
        next={next === null ? null : { show: next }}
        shown={notifications.length}
        noun={{ one: 'notification', other: 'notifications' }}
      />
    </>
  );
}
