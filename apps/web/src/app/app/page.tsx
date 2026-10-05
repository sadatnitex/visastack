import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import type { MessageKey } from '@visastack/i18n';
import {
  type Db,
  getConsents,
  listApplicants,
  listDocuments,
  listEvidenceRequestsForApplicant,
  listGrantsForRecipientAccount,
  listMissions,
  listPendingProposals,
} from '@visastack/services';
import Link from 'next/link';
import { TranslationNotice } from '../../components/translation-notice';
import { pickMessages } from '../../lib/client-messages';
import { getI18n } from '../../lib/locale';
import { withSession } from '../../lib/session';
import { ConsentButton } from './consent-button';
import { CONSENT_BUTTON_KEYS } from './consent-button.messages';

export const dynamic = 'force-dynamic';

const CONSENT_MESSAGE_KEYS: Record<ConsentType, MessageKey> = {
  CORE_PROCESSING: 'consent.core.title',
  AI_EXTRACTION: 'consent.ai.title',
  AI_OCR: 'consent.ocr.title',
  SHARING: 'consent.sharing.title',
  MARKETING: 'consent.marketing.title',
  ISSUER_CONTACT: 'consent.issuerContact.title',
};

/** Terminal mission states never count toward "active". */
const TERMINAL_MISSION_STATES = new Set(['CLOSED', 'CANCELLED']);

interface AttentionItem {
  readonly applicantId: string;
  readonly applicantName: string;
  readonly label: MessageKey;
  readonly count: number;
}

async function loadDashboard(db: Db, accountId: string, email: string) {
  const [consents, incomingGrants, applicants] = await Promise.all([
    getConsents(db, accountId),
    listGrantsForRecipientAccount(db, accountId),
    listApplicants(db, accountId),
  ]);

  const perApplicant = await Promise.all(
    applicants.map(async (applicant) => {
      const [docs, proposals, missions, evidenceRequests] = await Promise.all([
        listDocuments(db, accountId, applicant.id),
        listPendingProposals(db, applicant.id),
        listMissions(db, accountId, applicant.id),
        listEvidenceRequestsForApplicant(db, accountId, applicant.id),
      ]);
      const activeMissions = missions.ok
        ? missions.value.filter((m) => !TERMINAL_MISSION_STATES.has(m.state)).length
        : 0;
      const openRequests = evidenceRequests.ok
        ? evidenceRequests.value.filter((r) => r.status === 'OPEN').length
        : 0;
      return {
        applicant,
        documentCount: docs.ok ? docs.value.length : 0,
        pendingProposals: proposals.length,
        activeMissions,
        openRequests,
      };
    }),
  );

  const attention: AttentionItem[] = [];
  for (const row of perApplicant) {
    if (row.pendingProposals > 0) {
      attention.push({
        applicantId: row.applicant.id,
        applicantName: row.applicant.displayName,
        label: 'account.attention.proposals',
        count: row.pendingProposals,
      });
    }
    if (row.openRequests > 0) {
      attention.push({
        applicantId: row.applicant.id,
        applicantName: row.applicant.displayName,
        label: 'account.attention.requests',
        count: row.openRequests,
      });
    }
  }
  const pendingGrants = incomingGrants.filter(
    (g) => g.grant.status === 'PENDING_ACCEPTANCE',
  ).length;
  if (pendingGrants > 0) {
    attention.push({
      applicantId: '',
      applicantName: '',
      label: 'account.attention.invitations',
      count: pendingGrants,
    });
  }

  const activeMissionsTotal = perApplicant.reduce((sum, r) => sum + r.activeMissions, 0);
  const documentTotal = perApplicant.reduce((sum, r) => sum + r.documentCount, 0);

  return {
    email,
    consents,
    applicants,
    perApplicant,
    attention,
    pendingGrants,
    activeMissionsTotal,
    documentTotal,
  };
}

export default async function AppPage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const data = await withSession(({ db, accountId, email }) => loadDashboard(db, accountId, email));
  const coreGranted = Boolean(data.consents.CORE_PROCESSING);
  const consentButtonMessages = pickMessages(locale, CONSENT_BUTTON_KEYS);

  // One primary action (directive §7 "PR 7"): the single most useful next
  // step, resolved in priority order — never more than one at a time.
  const primaryAction = !coreGranted
    ? null // consent gate below is itself the primary action when missing
    : data.applicants.length === 0
      ? { href: '/app/applicants', label: t('account.action.addFirst') }
      : data.attention.length > 0 && data.attention[0]?.applicantId
        ? {
            href: `/app/applicant/${data.attention[0].applicantId}`,
            label: t('account.action.review', { name: data.attention[0].applicantName }),
          }
        : { href: '/app/applicants', label: t('account.action.view') };

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">{t('account.overview.eyebrow')}</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {t('account.overview.title')}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {data.email}
          </p>
        </div>
        {primaryAction ? (
          <Link href={primaryAction.href} className="btn btn-primary">
            {primaryAction.label}
          </Link>
        ) : null}
      </div>

      {!coreGranted ? (
        <article className="card" style={{ marginBottom: '1.5rem' }}>
          <p className="card-kicker">{t('consent.gate.kicker')}</p>
          <h2 className="card-title">{t('consent.gate.title')}</h2>
          <p className="card-body">{t('consent.gate.body')}</p>
        </article>
      ) : (
        <>
          <div className="grid" style={{ marginBottom: '1.5rem' }}>
            <article className="card">
              <p className="card-kicker">{t('account.glance.kicker')}</p>
              <h2 className="card-title">{t('account.glance.title')}</h2>
              <div className="rows">
                <div className="row">
                  <span className="row-key">{t('account.glance.applicants')}</span>
                  <span className="row-val">{i18n.number(data.applicants.length)}</span>
                </div>
                <div className="row">
                  <span className="row-key">{t('account.glance.documents')}</span>
                  <span className="row-val">{i18n.number(data.documentTotal)}</span>
                </div>
                <div className="row">
                  <span className="row-key">{t('account.glance.cases')}</span>
                  <span className="row-val">{i18n.number(data.activeMissionsTotal)}</span>
                </div>
                <div className="row">
                  <span className="row-key">{t('account.glance.invitations')}</span>
                  {data.pendingGrants > 0 ? (
                    <Link href="/app/shared" className="badge badge-warning">
                      {t('account.glance.pending', { count: data.pendingGrants })}
                    </Link>
                  ) : (
                    <span className="badge badge-neutral">{t('account.glance.none')}</span>
                  )}
                </div>
              </div>
            </article>

            <article className="card">
              <p className="card-kicker">{t('account.attention.kicker')}</p>
              <h2 className="card-title">{t('account.attention.title')}</h2>
              {data.attention.length === 0 ? (
                <p className="card-body">{t('account.attention.empty')}</p>
              ) : (
                <div className="rows">
                  {data.attention.map((item, i) => (
                    <Link
                      className="row row-link"
                      key={`${item.label}-${item.applicantId}-${i}`}
                      href={item.applicantId ? `/app/applicant/${item.applicantId}` : '/app/shared'}
                    >
                      <span className="row-key">
                        {item.applicantName ? `${item.applicantName} - ` : ''}
                        {t(item.label)}
                      </span>
                      <span className="badge badge-warning">{i18n.number(item.count)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </article>
          </div>
        </>
      )}

      {/*
       * Always rendered, independent of `coreGranted` — the sole place any
       * consent type (including CORE_PROCESSING) is granted or revoked, so
       * AI/sharing/marketing consent stay independently controllable even
       * while core processing is absent or revoked
       * (docs/audits/post-programme-defect-register.md finding #22).
       */}
      <TranslationNotice catalog="consent" locale={locale} t={t} />
      <article className="card">
        <p className="card-kicker">{t('consent.overview.kicker')}</p>
        <h2 className="card-title">{t('consent.overview.title')}</h2>
        <p className="card-body" style={{ marginBottom: '1rem' }}>
          {t('consent.overview.body')}
        </p>
        <div className="rows">
          {CONSENT_TYPES.map((type) => (
            <div className="row" key={type}>
              <span className="row-key">{t(CONSENT_MESSAGE_KEYS[type])}</span>
              <ConsentButton
                type={type}
                granted={Boolean(data.consents[type])}
                messages={consentButtonMessages}
              />
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
