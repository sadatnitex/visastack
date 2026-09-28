import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type MessageKey, createTranslator } from '@visastack/i18n';
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
import { getLocale } from '../../lib/locale';
import { withSession } from '../../lib/session';
import { ConsentButton } from './consent-button';

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
  readonly label: string;
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
        label: 'AI proposal(s) awaiting your review',
        count: row.pendingProposals,
      });
    }
    if (row.openRequests > 0) {
      attention.push({
        applicantId: row.applicant.id,
        applicantName: row.applicant.displayName,
        label: 'Evidence request(s) awaiting a response',
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
      label: 'Sharing invitation(s) awaiting your acceptance',
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
  const locale = await getLocale();
  const t = createTranslator(locale);
  const data = await withSession(({ db, accountId, email }) => loadDashboard(db, accountId, email));
  const coreGranted = Boolean(data.consents.CORE_PROCESSING);

  // One primary action (directive §7 "PR 7"): the single most useful next
  // step, resolved in priority order — never more than one at a time.
  const primaryAction = !coreGranted
    ? null // consent gate below is itself the primary action when missing
    : data.applicants.length === 0
      ? { href: '/app/applicants', label: 'Add your first applicant' }
      : data.attention.length > 0 && data.attention[0]?.applicantId
        ? {
            href: `/app/applicant/${data.attention[0].applicantId}`,
            label: `Review ${data.attention[0].applicantName}`,
          }
        : { href: '/app/applicants', label: 'View applicants' };

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Home</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Welcome back
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
          <p className="card-kicker">Get started</p>
          <h2 className="card-title">Grant core processing consent</h2>
          <p className="card-body">
            VisaStack can't create applicant or profile records until you grant this below. You can
            revoke it again at any time.
          </p>
        </article>
      ) : (
        <>
          <div className="grid" style={{ marginBottom: '1.5rem' }}>
            <article className="card">
              <p className="card-kicker">Status</p>
              <h2 className="card-title">At a glance</h2>
              <div className="rows">
                <div className="row">
                  <span className="row-key">Applicants</span>
                  <span className="row-val">{data.applicants.length}</span>
                </div>
                <div className="row">
                  <span className="row-key">Documents uploaded</span>
                  <span className="row-val">{data.documentTotal}</span>
                </div>
                <div className="row">
                  <span className="row-key">Active missions</span>
                  <span className="row-val">{data.activeMissionsTotal}</span>
                </div>
                <div className="row">
                  <span className="row-key">Sharing invitations awaiting you</span>
                  {data.pendingGrants > 0 ? (
                    <Link href="/app/shared" className="badge badge-warning">
                      {data.pendingGrants} pending
                    </Link>
                  ) : (
                    <span className="badge badge-neutral">None</span>
                  )}
                </div>
              </div>
            </article>

            <article className="card">
              <p className="card-kicker">Attention</p>
              <h2 className="card-title">Needs your attention</h2>
              {data.attention.length === 0 ? (
                <p className="card-body">Nothing needs your attention right now.</p>
              ) : (
                <div className="rows">
                  {data.attention.map((item, i) => (
                    <Link
                      className="row row-link"
                      key={`${item.label}-${item.applicantId}-${i}`}
                      href={item.applicantId ? `/app/applicant/${item.applicantId}` : '/app/shared'}
                    >
                      <span className="row-key">
                        {item.applicantName ? `${item.applicantName} — ` : ''}
                        {item.label}
                      </span>
                      <span className="badge badge-warning">{item.count}</span>
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
      <article className="card">
        <p className="card-kicker">Consent</p>
        <h2 className="card-title">Permissions you control</h2>
        <p className="card-body" style={{ marginBottom: '1rem' }}>
          Each purpose is granted and revoked independently, at any time — revoking one never
          requires regranting another. Core processing is required before any applicant or profile
          records can be created; the others remain optional.
        </p>
        <div className="rows">
          {CONSENT_TYPES.map((type) => (
            <div className="row" key={type}>
              <span className="row-key">{t(CONSENT_MESSAGE_KEYS[type])}</span>
              <ConsentButton type={type} granted={Boolean(data.consents[type])} locale={locale} />
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
