import { type Locale, formatDate } from '@visastack/i18n';
import Link from 'next/link';
import { atLevel } from '../../../components/depth';
import { ShowMore } from '../../../components/show-more';
import { appNotificationsCatalog } from '../../../i18n/app-notifications';
import type { DepthLevel } from '../../../lib/ccd/depth';
import { formatTimestampDate } from '../../../lib/format-date';
import { getServerT } from '../../../lib/i18n-server';
import type { SearchParamsRecord } from '../../../lib/paging';
import { AreaPicture, TravellerRow, TravellerRows } from '../u7-rows';

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
  total,
  searchParams,
  markReadAction,
  markAllReadAction,
  locale = 'en',
}: {
  readonly notifications: readonly NotificationRow[];
  /** The `show` value for the next load; null when nothing more exists. */
  readonly next: number | null;
  /** Every notification there is, when known (up to 100). */
  readonly total?: number;
  readonly searchParams: SearchParamsRecord;
  readonly markReadAction: FormAction;
  readonly markAllReadAction: FormAction;
  /** Bengali readers get Bengali digits and month names; English output is unchanged. */
  readonly locale?: Locale;
}) {
  const t = getServerT(appNotificationsCatalog);
  const anyUnread = notifications.some((n) => !n.read);
  return (
    <>
      {anyUnread ? (
        <form className="notifications-mark-all" action={markAllReadAction}>
          <button type="submit" className="btn btn-secondary u-btn-sm">
            {t.node('appNotifications.appNotificationsNotificationList.markAllRead')}
          </button>
        </form>
      ) : null}
      <section
        className="activity-log-scroll notifications-scroll"
        aria-label={t('appNotifications.appNotificationsNotificationList.notificationList')}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
        tabIndex={0}
      >
        <TravellerRows>
          {notifications.map((n, index) => (
            <div key={n.id} id={rowAnchor(index + 1)} {...(n.level ? atLevel(n.level) : {})}>
              <TravellerRow
                title={n.subject}
                headingLevel={2}
                picture={
                  <AreaPicture mark={{ icon: 'bell', tone: n.read ? 'neutral' : 'amber' }} />
                }
                {...(n.read
                  ? {}
                  : {
                      chip: {
                        label: t.node('appNotifications.appNotificationsNotificationList.new'),
                        tone: 'warning' as const,
                      },
                    })}
                meta={
                  locale === 'bn'
                    ? formatDate(n.createdAt, 'bn', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : formatTimestampDate(n.createdAt)
                }
              >
                <p className="u7-body-text notification-summary">{n.summary}</p>
                <div className="u7-body-actions notification-actions">
                  <Link href={n.deepLinkPath} className="btn btn-secondary u-btn-sm">
                    {t.node('appNotifications.appNotificationsNotificationList.open')}
                  </Link>
                  {!n.read ? (
                    <form action={markReadAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <button type="submit" className="btn btn-secondary u-btn-sm">
                        {t.node('appNotifications.appNotificationsNotificationList.markRead')}
                      </button>
                    </form>
                  ) : null}
                </div>
              </TravellerRow>
            </div>
          ))}
        </TravellerRows>
      </section>
      <ShowMore
        id="notifications-more"
        landOn={rowAnchor(notifications.length + 1)}
        pathname="/app/notifications"
        searchParams={searchParams}
        next={next === null ? null : { show: next }}
        shown={notifications.length}
        {...(total === undefined ? {} : { total })}
        noun={{ one: 'notification', other: 'notifications' }}
      />
    </>
  );
}
