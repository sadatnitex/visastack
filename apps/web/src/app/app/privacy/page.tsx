import type { ConsentType } from '@visastack/core';
import type { MessageKey } from '@visastack/i18n';
import {
  getDeletionImpactSummary,
  getPendingDeletion,
  listAccountExportJobsForAccount,
  listActiveLegalHoldsForAccount,
  listConsentHistory,
} from '@visastack/services';
import { TranslationNotice } from '../../../components/translation-notice';
import { pickMessages } from '../../../lib/client-messages';
import { getI18n } from '../../../lib/locale';
import { withSession } from '../../../lib/session';
import { DeletionPanel } from './deletion-panel';
import { DELETION_PANEL_KEYS } from './deletion-panel.messages';
import { LargeExportPanel } from './large-export-panel';
import { LARGE_EXPORT_KEYS } from './large-export-panel.messages';

export const dynamic = 'force-dynamic';

const CONSENT_LABELS: Record<ConsentType, MessageKey> = {
  CORE_PROCESSING: 'privacy.consent.core',
  AI_EXTRACTION: 'privacy.consent.ai',
  AI_OCR: 'privacy.consent.ocr',
  SHARING: 'privacy.consent.sharing',
  MARKETING: 'privacy.consent.marketing',
  ISSUER_CONTACT: 'privacy.consent.issuerContact',
};

export default async function PrivacyPage() {
  const { locale, t, date, dateTime } = await getI18n();
  const data = await withSession(async ({ db, accountId }) => {
    const [history, pending, impact, holds, exportJobs] = await Promise.all([
      listConsentHistory(db, accountId),
      getPendingDeletion(db, accountId),
      getDeletionImpactSummary(db, accountId),
      listActiveLegalHoldsForAccount(db, accountId),
      listAccountExportJobsForAccount(db, accountId),
    ]);
    return {
      history: history.map((row) => ({
        type: row.type as ConsentType,
        granted: row.grantedAt !== null && row.revokedAt === null,
        at: (row.grantedAt ?? row.revokedAt ?? row.createdAt).toISOString(),
      })),
      scheduledLabel: pending ? date(pending.scheduledFor, 'long') : null,
      impact,
      holds: holds.map(({ placedAt, reviewAt, ...h }) => ({
        ...h,
        placedLabel: date(placedAt, 'long'),
        reviewLabel: reviewAt ? date(reviewAt, 'long') : null,
      })),
      exportJobs: exportJobs.map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        readyAt: job.readyAt ? job.readyAt.toISOString() : null,
        expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
        expiresLabel: job.expiresAt ? dateTime(job.expiresAt) : null,
        lastError: job.lastError,
      })),
    };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">{t('privacy.eyebrow')}</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {t('privacy.title')}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {t('privacy.subtitle')}
          </p>
        </div>
      </div>

      <TranslationNotice catalog="privacy" locale={locale} t={t} />

      <div className="grid">
        <article className="card">
          <p className="card-kicker">{t('privacy.export.kicker')}</p>
          <h2 className="card-title">{t('privacy.export.title')}</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            {t('privacy.export.body')}
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <a href="/app/privacy/export" className="btn btn-primary" download>
              {t('privacy.export.json')}
            </a>
            <a href="/app/privacy/export?format=csv" className="btn btn-secondary" download>
              {t('privacy.export.csv')}
            </a>
          </div>
          <LargeExportPanel
            jobs={data.exportJobs}
            messages={pickMessages(locale, LARGE_EXPORT_KEYS)}
            locale={locale}
          />
        </article>

        <article className="card">
          <p className="card-kicker">{t('privacy.erase.kicker')}</p>
          <h2 className="card-title">{t('privacy.erase.title')}</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            {t('privacy.erase.body')}
          </p>
          <DeletionPanel
            scheduledLabel={data.scheduledLabel}
            impact={data.impact}
            holds={data.holds}
            messages={pickMessages(locale, DELETION_PANEL_KEYS)}
            locale={locale}
          />
        </article>
      </div>

      <article className="card" style={{ marginTop: '1.5rem' }}>
        <p className="card-kicker">{t('privacy.history.kicker')}</p>
        <h2 className="card-title">{t('privacy.history.title')}</h2>
        {data.history.length === 0 ? (
          <p className="card-body">{t('privacy.history.empty')}</p>
        ) : (
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {data.history.map((entry, i) => (
              <div className="row" key={`${entry.type}-${entry.at}-${i}`}>
                <span className="row-key">
                  {CONSENT_LABELS[entry.type] ? t(CONSENT_LABELS[entry.type]) : entry.type}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className={`badge ${entry.granted ? 'badge-success' : 'badge-neutral'}`}>
                    {entry.granted ? t('privacy.history.granted') : t('privacy.history.revoked')}
                  </span>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {dateTime(entry.at)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
