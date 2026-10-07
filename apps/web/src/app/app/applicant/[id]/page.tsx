import {
  hasConsent,
  listAccessForApplicant,
  listApplicantProfile,
  listDocumentsDetailed,
  listEvidenceRequestsForApplicant,
  listMissions,
  listPendingProposals,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, NextStepCard, StatusBadge } from '../../../../components/ui';
import { PROFILE_FIELDS } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';
import { STAGE_LABELS } from '../../agency/[orgId]/case-search-form';

export const metadata: Metadata = { title: 'Applicant overview' };

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
    ? {
        href: '/app',
        label: 'Turn on core processing from Home',
        why: 'Profiles and documents cannot be saved until you allow this. You can turn it off again at any time.',
        action: 'Go to Home',
      }
    : openEvidenceRequests.length > 0
      ? {
          href: `/app/applicant/${id}/evidence`,
          label: 'Reply to an evidence request',
          why: 'An agency is waiting for a document before it can continue this case.',
          action: 'Open requests',
        }
      : data.pendingProposals.length > 0
        ? {
            href: `/app/applicant/${id}/documents`,
            label: 'Decide on suggested details',
            why: 'Details were read from a document. Nothing is added to the profile until you approve it.',
            action: 'Review suggestions',
          }
        : documentsNeedingAttention.length > 0
          ? {
              href: `/app/applicant/${id}/documents`,
              label: 'Check a flagged document',
              why: 'A document needs a second look before it can be relied on.',
              action: 'Open documents',
            }
          : completenessPct < 100
            ? {
                href: `/app/applicant/${id}/profile`,
                label: 'Finish the Master Profile',
                why: `${completedCore} of ${UNIVERSAL_CORE_FIELDS.length} core identity fields are filled. Cases reuse this profile, so you only enter it once.`,
                action: 'Continue profile',
              }
            : {
                href: `/app/applicant/${id}/missions`,
                label: 'Start or review a case',
                why: 'The core profile is complete.',
                action: 'Open cases',
              };

  return (
    <>
      <div className="split">
        <div className="split-main">
          <NextStepCard
            title={nextAction.label}
            why={nextAction.why}
            href={nextAction.href}
            action={nextAction.action}
            {...(nextAction.href.endsWith('/profile') || nextAction.href.endsWith('/missions')
              ? {}
              : { tone: 'warning' as const })}
          />
          <article className="card">
            <p className="card-kicker">Cases</p>
            <h2 className="card-title">Active cases</h2>
            {activeMissions.length === 0 ? (
              <div style={{ marginBottom: '0.75rem' }}>
                <EmptyState title="No active case yet">
                  A case checks this person's documents against the requirements of one visa route.
                </EmptyState>
              </div>
            ) : (
              <div className="rows" style={{ marginBottom: '0.75rem' }}>
                {activeMissions.slice(0, 4).map((m) => (
                  <Link className="row row-link" key={m.id} href={`/app/mission/${m.id}`}>
                    <span className="row-key">{m.title}</span>
                    <StatusBadge tone="neutral">
                      {STAGE_LABELS[m.state] ?? 'In progress'}
                    </StatusBadge>
                  </Link>
                ))}
              </div>
            )}
            <Link href={`/app/applicant/${id}/missions`} className="muted">
              Open Cases →
            </Link>
          </article>
        </div>
        <aside className="split-rail" aria-label="Profile, documents and sharing">
          <article className="card">
            <p className="card-kicker">Master Profile</p>
            <h2 className="card-title">Completeness</h2>
            <div style={{ marginBottom: '1rem' }}>
              <div className="meter-label">
                <span>
                  Core identity fields: {completedCore} of {UNIVERSAL_CORE_FIELDS.length}
                </span>
                <span>{completenessPct}%</span>
              </div>
              <div className="meter" aria-hidden="true">
                <div className="meter-fill" style={{ width: `${completenessPct}%` }} />
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
                <StatusBadge tone={documentsNeedingAttention.length > 0 ? 'warning' : 'neutral'}>
                  {documentsNeedingAttention.length}
                </StatusBadge>
              </div>
              <div className="row">
                <span className="row-key">AI proposals to review</span>
                <StatusBadge tone={data.pendingProposals.length > 0 ? 'warning' : 'neutral'}>
                  {data.pendingProposals.length}
                </StatusBadge>
              </div>
            </div>
            <Link href={`/app/applicant/${id}/documents`} className="muted">
              Open Documents →
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
                <StatusBadge tone={openEvidenceRequests.length > 0 ? 'warning' : 'neutral'}>
                  {openEvidenceRequests.length}
                </StatusBadge>
              </div>
            </div>
            <Link href={`/app/applicant/${id}/sharing`} className="muted">
              Open Sharing →
            </Link>
          </article>
        </aside>
      </div>
    </>
  );
}
