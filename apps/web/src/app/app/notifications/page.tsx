import { listNotificationsForAccount } from '@visastack/services';
import Link from 'next/link';
import { TranslationNotice } from '../../../components/translation-notice';
import { alertText } from '../../../lib/alert-text';
import { getI18n } from '../../../lib/locale';
import { withSession } from '../../../lib/session';
import { markNotificationReadAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * NTF-02's in-app channel: every notification actually sent to this account,
 * newest first. The product calls this page "Alerts" (directive Part 9 UX-01);
 * the route and the stored records keep the older name. Each alert is shown in
 * the reader's language by looking up the messages it was written from.
 */
export default async function NotificationsPage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const notifications = await withSession(({ db, accountId }) =>
    listNotificationsForAccount(db, accountId),
  );

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">{t('alerts.eyebrow')}</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {t('alerts.title')}
          </h1>
        </div>
      </div>

      {/* Retention and deletion notices say what will happen to a person's data. */}
      <TranslationNotice catalog="alerts" locale={locale} t={t} />

      <article className="card">
        {notifications.length === 0 ? (
          <p className="card-body">{t('alerts.empty')}</p>
        ) : (
          <div className="rows">
            {notifications.map((n) => {
              const text = alertText(i18n, n);
              return (
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
                      {text.subject}
                      {!n.read ? (
                        <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>
                          {t('alerts.new')}
                        </span>
                      ) : null}
                    </span>
                    <span className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      {i18n.date(n.createdAt)}
                    </span>
                  </div>
                  <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                    {text.summary}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Link
                      href={n.deepLinkPath}
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
                    >
                      {t('alerts.open')}
                    </Link>
                    {!n.read ? (
                      <form action={markNotificationReadAction}>
                        <input type="hidden" name="notificationId" value={n.id} />
                        <button
                          type="submit"
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
                        >
                          {t('alerts.markRead')}
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
    </section>
  );
}
