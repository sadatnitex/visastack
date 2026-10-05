import { listMembershipsForAccount } from '@visastack/services';
import { signOut } from '@workos-inc/authkit-nextjs';
import Link from 'next/link';
import { isPlatformAdmin } from '../../../lib/admin';
import { getI18n } from '../../../lib/locale';
import { withSession } from '../../../lib/session';
import { setLocaleAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const { locale, t } = await getI18n();
  const otherLocale = locale === 'en' ? 'bn' : 'en';
  const data = await withSession(async ({ db, accountId, email }) => {
    const [isAdmin, memberships] = await Promise.all([
      isPlatformAdmin(db, { accountId, email }),
      listMembershipsForAccount(db, accountId),
    ]);
    return { email, isAdmin, hasAgencyAccess: memberships.length > 0 };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">{t('account.page.eyebrow')}</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.email}
          </h1>
        </div>
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">{t('account.language.kicker')}</p>
          <h2 className="card-title">{t('account.language.title')}</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            {t('account.language.body')}
          </p>
          <form action={setLocaleAction}>
            <input type="hidden" name="locale" value={otherLocale} />
            <button type="submit" className="btn btn-secondary">
              {t('account.language.switch', { language: otherLocale === 'bn' ? 'বাংলা' : 'English' })}
            </button>
          </form>
        </article>

        <article className="card">
          <p className="card-kicker">{t('account.privacy.kicker')}</p>
          <h2 className="card-title">{t('account.privacy.title')}</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            {t('account.privacy.body')}
          </p>
          <Link href="/app/privacy" className="btn btn-secondary">
            {t('account.privacy.open')}
          </Link>
        </article>

        {data.hasAgencyAccess || data.isAdmin ? (
          <article className="card">
            <p className="card-kicker">{t('account.roles.kicker')}</p>
            <h2 className="card-title">{t('account.roles.title')}</h2>
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.hasAgencyAccess ? (
                <Link className="row row-link" href="/app/agency">
                  <span className="row-key">{t('account.roles.agency')}</span>
                  <span className="muted" aria-hidden="true">
                    →
                  </span>
                </Link>
              ) : null}
              {data.isAdmin ? (
                <Link className="row row-link" href="/app/admin">
                  <span className="row-key">{t('account.roles.admin')}</span>
                  <span className="muted" aria-hidden="true">
                    →
                  </span>
                </Link>
              ) : null}
            </div>
          </article>
        ) : null}

        <article className="card">
          <p className="card-kicker">{t('account.session.kicker')}</p>
          <h2 className="card-title">{t('account.session.title')}</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            {t('account.session.body')}
          </p>
          <form
            action={async () => {
              'use server';
              await signOut();
            }}
          >
            <button type="submit" className="btn btn-secondary">
              {t('shell.app.signOut')}
            </button>
          </form>
        </article>
      </div>
    </section>
  );
}
