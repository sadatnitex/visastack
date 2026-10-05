import { getConsents, listApplicants } from '@visastack/services';
import Link from 'next/link';
import { Rich } from '../../../components/rich';
import { TranslationNotice } from '../../../components/translation-notice';
import { pickMessages } from '../../../lib/client-messages';
import { getI18n } from '../../../lib/locale';
import { relationshipLabel } from '../../../lib/relationship-labels';
import { withSession } from '../../../lib/session';
import { AddApplicantForm } from '../add-applicant-form';
import { ADD_APPLICANT_KEYS } from '../add-applicant-form.messages';

export const dynamic = 'force-dynamic';

export default async function ApplicantsPage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const data = await withSession(async ({ db, accountId }) => {
    const [applicants, consents] = await Promise.all([
      listApplicants(db, accountId),
      getConsents(db, accountId),
    ]);
    return { applicants, coreGranted: Boolean(consents.CORE_PROCESSING) };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">{t('account.applicants.eyebrow')}</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {t('account.applicants.title')}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {t('account.applicants.subtitle')}
          </p>
        </div>
      </div>

      {/* The form's statement about authority over someone else's record is consent wording. */}
      {data.coreGranted ? <TranslationNotice catalog="consent" locale={locale} t={t} /> : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">{t('account.applicants.listKicker')}</p>
          <h2 className="card-title">
            {i18n.tn('account.applicants.count', data.applicants.length)}
          </h2>
          {data.applicants.length === 0 ? (
            <p className="card-body">{t('account.applicants.empty')}</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.applicants.map((a) => (
                <Link className="row row-link" key={a.id} href={`/app/applicant/${a.id}`}>
                  <span className="row-key">{a.displayName}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="badge badge-neutral">
                      {relationshipLabel(a.relationship, t)}
                    </span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">{t('account.applicants.newKicker')}</p>
          <h2 className="card-title">{t('account.applicants.addTitle')}</h2>
          {data.coreGranted ? (
            <AddApplicantForm messages={pickMessages(locale, ADD_APPLICANT_KEYS)} />
          ) : (
            <p className="card-body">
              <Rich
                template={t('account.applicants.needConsent')}
                locale={locale}
                link={(text) => <Link href="/app">{text}</Link>}
              />
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
