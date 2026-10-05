import {
  hasConsent,
  listAccessForApplicant,
  listApplicantProfile,
  listDocumentsDetailed,
  listEvidenceRequestsForApplicant,
  listMissions,
  listPendingProposals,
} from '@visastack/services';
import Link from 'next/link';
import { PROFILE_FIELDS } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

const TERMINAL_MISSION_STATES = new Set(['CLOSED', 'CANCELLED']);
const UNIVERSAL_CORE_FIELDS = PROFILE_FIELDS.filter((f) => f.pack === 'universal' && !f.group);

/**
 * Applicant Overview (master directive §7 "PR 7"): synthesizes what used to
 * require visiting five separate pages into one summary — identity,
 * completeness, document health, missions, outstanding requests, current
 * sharing, and a single next action.
 */
export default async function ApplicantOverviewPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const [profile, documents, coreGranted, pendingProposals, missions, evidenceRequests, access] =
      await Promise.all([
        listApplicantProfile(db, id),
        listDocumentsDetailed(db, accountId, id),
        hasConsent(db, accountId, 'CORE_PROCESSING'),
        listPendingProposals(db, id),
        listMissions(db, accountId, id),
        listEvidenceRequestsForApplicant(db, accountId, id),
        listAccessForApplicant(db, accountId, id),
      ]);
    return {
      profile,
      documents: documents.ok ? documents.value : [],
      coreGranted,
      pendingProposals,
      missions: missions.ok ? missions.value : [],
      evidenceRequests: evidenceRequests.ok ? evidenceRequests.value : [],
      activeGrants: access.ok ? access.value.filter((g) => g.status === 'ACTIVE').length : 0,
    };
  });

  const filledUniversalKeys = new Set(
    data.profile
      .filter((entry) => entry.repeatingRecordKey === null && entry.value !== null)
      .map((entry) => entry.fieldKey),
  );
  const completedCore = UNIVERSAL_CORE_FIELDS.filter((f) => filledUniversalKeys.has(f.key)).length;
  const completenessPct =
    UNIVERSAL_CORE_FIELDS.length > 0
      ? Math.round((completedCore / UNIVERSAL_CORE_FIELDS.length) * 100)
      : 0;

  const activeMissions = data.missions.filter((m) => !TERMINAL_MISSION_STATES.has(m.state));
  const openEvidenceRequests = data.evidenceRequests.filter((r) => r.status === 'OPEN');
  const documentsNeedingAttention = data.documents.filter(
    (d) => d.safetyStatus === 'QUARANTINED' || d.classification?.reviewRequired,
  );

  const nextAction = !data.coreGranted
    ? { href: '/app', label: 'Grant consent from Home to get started' }
    : openEvidenceRequests.length > 0
      ? { href: `/app/applicant/${id}/evidence`, label: 'Respond to an evidence request' }
      : data.pendingProposals.length > 0
        ? { href: `/app/applicant/${id}/documents`, label: 'Review AI proposals' }
        : documentsNeedingAttention.length > 0
          ? { href: `/app/applicant/${id}/documents`, label: 'Review a flagged document' }
          : completenessPct < 100
            ? { href: `/app/applicant/${id}/profile`, label: 'Continue the Master Profile' }
            : { href: `/app/applicant/${id}/missions`, label: 'Start or review a case' };

  return (
    <>
      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Next step</p>
        <h2 className="card-title">{nextAction.label}</h2>
        <Link href={nextAction.href} className="btn btn-primary" style={{ marginTop: '0.75rem' }}>
          Go there
        </Link>
      </article>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Master Profile</p>
          <h2 className="card-title">Completeness</h2>
          <div style={{ marginBottom: '1rem' }}>
            <div className="meter-label">
              <span>Core identity fields</span>
              <span>{completenessPct}%</span>
            </div>
            <div className="meter">
              <div
                className={`meter-fill ${completenessPct >= 100 ? 'meter-full' : ''}`.trim()}
                style={{ width: `${completenessPct}%`, background: 'var(--accent)' }}
              />
            </div>
          </div>
          <Link href={`/app/applicant/${id}/profile`} className="muted">
            Open Profile →
          </Link>
        </article>

        <article className="card">
          <p className="card-kicker">Documents</p>
          <h2 className="card-title">Document health</h2>
          <div className="rows" style={{ marginBottom: '0.75rem' }}>
            <div className="row">
              <span className="row-key">Total uploaded</span>
              <span className="row-val">{data.documents.length}</span>
            </div>
            <div className="row">
              <span className="row-key">Needing attention</span>
              <span
                className={`badge ${documentsNeedingAttention.length > 0 ? 'badge-warning' : 'badge-neutral'}`}
              >
                {documentsNeedingAttention.length}
              </span>
            </div>
            <div className="row">
              <span className="row-key">AI proposals to review</span>
              <span
                className={`badge ${data.pendingProposals.length > 0 ? 'badge-warning' : 'badge-neutral'}`}
              >
                {data.pendingProposals.length}
              </span>
            </div>
          </div>
          <Link href={`/app/applicant/${id}/documents`} className="muted">
            Open Documents →
          </Link>
        </article>

        <article className="card">
          <p className="card-kicker">Cases</p>
          <h2 className="card-title">Active cases</h2>
          {activeMissions.length === 0 ? (
            <p className="card-body" style={{ marginBottom: '0.75rem' }}>
              No active case yet.
            </p>
          ) : (
            <div className="rows" style={{ marginBottom: '0.75rem' }}>
              {activeMissions.slice(0, 4).map((m) => (
                <div className="row" key={m.id}>
                  <span className="row-key">{m.title}</span>
                  <span className="badge badge-neutral">{m.state}</span>
                </div>
              ))}
            </div>
          )}
          <Link href={`/app/applicant/${id}/missions`} className="muted">
            Open Cases →
          </Link>
        </article>

        <article className="card">
          <p className="card-kicker">Sharing &amp; requests</p>
          <h2 className="card-title">Outstanding items</h2>
          <div className="rows" style={{ marginBottom: '0.75rem' }}>
            <div className="row">
              <span className="row-key">Currently shared with</span>
              <span className="row-val">{data.activeGrants}</span>
            </div>
            <div className="row">
              <span className="row-key">Open evidence requests</span>
              <span
                className={`badge ${openEvidenceRequests.length > 0 ? 'badge-warning' : 'badge-neutral'}`}
              >
                {openEvidenceRequests.length}
              </span>
            </div>
          </div>
          <Link href={`/app/applicant/${id}/sharing`} className="muted">
            Open Sharing →
          </Link>
        </article>
      </div>
    </>
  );
}
