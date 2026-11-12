import Link from 'next/link';
import { atLevel } from '../../../components/depth';
import { Icon } from '../../../components/icons';
import { StatusBadge } from '../../../components/ui';
import { appHomeCatalog } from '../../../i18n/app-home';
import { getServerT } from '../../../lib/i18n-server';
import type { RecentActivityEntry } from '../../../lib/recent-activity';

/**
 * The last few things that happened to the person's record, as a short dated list like a bKash
 * statement: what happened, when, and who did it, with See All leading to the full Access Log. It
 * shows what Home was given and reads nothing itself. With nothing yet, one plain line says so.
 */
export function RecentActivity({
  entries,
  seeAllHref,
}: {
  readonly entries: readonly RecentActivityEntry[];
  readonly seeAllHref: string;
}) {
  const t = getServerT(appHomeCatalog);
  return (
    <section
      className="home-block u-mb-150"
      aria-labelledby="home-activity-heading"
      data-pattern="recent-activity"
      {...atLevel('browse')}
    >
      <h2 className="home-block-title" id="home-activity-heading">
        {t('appHome.appRecentActivity.recentActivity')}
      </h2>
      {entries.length === 0 ? (
        <p className="muted home-activity-empty">
          {t('appHome.appRecentActivity.nothingYetEachTimeYourRecord')}
        </p>
      ) : (
        <>
          <ol className="home-activity">
            {entries.map((entry) => (
              <li className="home-activity-row" key={entry.id}>
                <span className="home-activity-mark" aria-hidden="true">
                  <Icon name={entry.blocked ? 'alert' : 'activity'} size={16} />
                </span>
                <span className="home-activity-body">
                  <span className="home-activity-what">{entry.what}</span>
                  <time className="home-activity-when" dateTime={entry.at}>
                    {entry.when}
                  </time>
                </span>
                {entry.blocked ? (
                  <StatusBadge tone="danger">{t('appHome.appRecentActivity.blocked')}</StatusBadge>
                ) : (
                  <span className="home-activity-who">{entry.who}</span>
                )}
              </li>
            ))}
          </ol>
          <Link className="btn btn-secondary home-activity-all" href={seeAllHref}>
            {t('appHome.appRecentActivity.seeAll')}
          </Link>
        </>
      )}
    </section>
  );
}
