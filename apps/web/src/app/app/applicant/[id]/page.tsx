import {
  computeReadiness,
  getApplicant,
  getProfileSectionState,
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
import { notFound } from 'next/navigation';
import { EmptyState, NextStepCard, PageHeader, StatusBadge } from '../../../../components/ui';
import { formatTimestampDate } from '../../../../lib/format-date';
import { completionOf, fieldLabel } from '../../../../lib/master-profile';
import { agree, plural } from '../../../../lib/plural';
import { withSession } from '../../../../lib/session';
import { STAGE_LABELS } from '../../agency/[orgId]/case-search-form';

export const metadata: Metadata = { title: 'Traveller Overview' };
export const dynamic = 'force-dynamic';
const TERMINAL_MISSION_STATES = new Set(['CLOSED', 'CANCELLED']);

export default async function ApplicantOverviewPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await withSession(async ({ db, accountId }) => {
    // The page is independently guarded: parent layouts may render concurrently.
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [profile, documents, coreGranted, proposals, missions, requests, access, sectionChoices] =
      await Promise.all([
        listApplicantProfile(db, id),
        listDocumentsDetailed(db, accountId, id),
        hasConsent(db, accountId, 'CORE_PROCESSING'),
        listPendingProposals(db, id),
        listMissions(db, accountId, id),
        listEvidenceRequestsForApplicant(db, accountId, id),
        listAccessForApplicant(db, accountId, id),
        getProfileSectionState(db, id),
      ]);
    const active = missions.ok
      ? missions.value
          .filter((m) => !TERMINAL_MISSION_STATES.has(m.state))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      : [];
    const featured = active[0];
    const readiness = featured?.packVersionId ? await computeReadiness(db, featured.id) : null;
    return {
      applicant,
      profile,
      documents,
      coreGranted,
      proposals,
      missions,
      requests,
      access,
      active,
      featured,
      readiness,
      sectionChoices,
    };
  });
  if (!data) notFound();
  const documents = data.documents.ok ? data.documents.value : [];
  const requests = data.requests.ok ? data.requests.value.filter((r) => r.status === 'OPEN') : [];
  const flagged = documents.filter(
    (d) => d.safetyStatus === 'QUARANTINED' || d.classification?.reviewRequired,
  );
  const completion = completionOf(data.profile, data.sectionChoices);
  const completed = completion.answered;
  const completeness = completion.percent;
  const attention = requests.length + data.proposals.length + flagged.length;
  const next = !data.coreGranted
    ? {
        href: '/app#permissions',
        title: 'Allow Core Processing',
        why: 'Choose whether your profile and documents may be saved. You can withdraw this permission.',
        action: 'Review Permissions',
      }
    : requests.length
      ? {
          href: `/app/applicant/${id}/evidence`,
          title: 'Reply to an Evidence Request',
          why: 'An agency is waiting for evidence before it can continue.',
          action: 'Open Requests',
        }
      : data.proposals.length
        ? {
            href: `/app/applicant/${id}/documents`,
            title: 'Review Suggested Details',
            why: 'Nothing is added to your profile until you approve it.',
            action: 'Review Suggestions',
          }
        : flagged.length
          ? {
              href: `/app/applicant/${id}/documents`,
              title: 'Check a Flagged Document',
              why: 'A document needs review before it can be relied on.',
              action: 'Open Documents',
            }
          : completeness < 100
            ? {
                href: `/app/applicant/${id}/profile`,
                title: 'Continue Your Profile',
                why: `${completed} of ${completion.total} details in your open sections have values. This is completeness, not verification.`,
                action: 'Open Profile',
              }
            : {
                href: `/app/applicant/${id}/missions`,
                title: 'Start or Review a Case',
                why: 'Reuse your existing profile for the next visa route.',
                action: 'Open Cases',
              };
  const agenda = data.active
    .flatMap((m) => [
      ...(m.targetDeadline
        ? [
            {
              key: `${m.id}:deadline`,
              label: `${m.title}: target deadline`,
              date: m.targetDeadline,
              href: `/app/mission/${m.id}`,
            },
          ]
        : []),
      ...(m.travelStartDate
        ? [
            {
              key: `${m.id}:travel`,
              label: `${m.title}: travel starts`,
              date: m.travelStartDate,
              href: `/app/mission/${m.id}`,
            },
          ]
        : []),
    ])
    .filter((row) => row.date.getTime() >= new Date().setUTCHours(0, 0, 0, 0))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 5);
  const activity = [
    ...documents.map((d) => ({
      key: `document:${d.id}`,
      label: 'Document Uploaded',
      detail: d.approvedName ?? d.originalName,
      date: d.createdAt,
      href: `/app/applicant/${id}/documents#document-${d.id}`,
    })),
    ...data.profile
      .filter((p) => p.updatedAt)
      .map((p) => ({
        key: `fact:${p.factId}`,
        label: 'Profile Fact Updated',
        detail: fieldLabel(p.fieldKey) ?? 'Profile Detail',
        date: p.updatedAt as string,
        href: `/app/applicant/${id}/history`,
      })),
    ...data.active.map((m) => ({
      key: `case:${m.id}`,
      label: 'Case Updated',
      detail: m.title,
      date: m.updatedAt.toISOString(),
      href: `/app/mission/${m.id}`,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
  const partial = !data.documents.ok || !data.missions.ok || !data.requests.ok || !data.access.ok;

  return (
    <div className="traveller-overview">
      <PageHeader
        as="h2"
        eyebrow="Your Space"
        title={`Welcome, ${data.applicant.displayName}`}
        description={
          partial
            ? 'Some records could not be loaded. Try refreshing before relying on these totals.'
            : attention
              ? `${plural(attention, 'item')} ${agree(attention, 'needs', 'need')} a decision or a closer look.`
              : 'Your next steps, documents and cases in one place.'
        }
        actions={
          <Link className="btn btn-primary" href={`/app/applicant/${id}/missions`}>
            New Visa Case
          </Link>
        }
      />
      {partial ? (
        <output className="notice notice-warn">
          Some sections are unavailable. Unavailable totals are not reported as zero.
        </output>
      ) : null}
      <div className="traveller-metrics">
        <Link className="card traveller-metric" href={`/app/applicant/${id}/missions`}>
          <span>Active Visa Cases</span>
          <strong>{data.missions.ok ? data.active.length : 'Unavailable'}</strong>
          <span className="muted">Closed and cancelled cases are excluded.</span>
        </Link>
        <Link className="card traveller-metric" href={`/app/applicant/${id}/documents`}>
          <span>Documents in Your Wallet</span>
          <strong>{data.documents.ok ? documents.length : 'Unavailable'}</strong>
          <span className="muted">Open documents to review processing and safety.</span>
        </Link>
        <Link className="card traveller-metric" href={`/app/applicant/${id}/evidence`}>
          <span>Items Needing Attention</span>
          <strong>{data.documents.ok && data.requests.ok ? attention : 'Unavailable'}</strong>
          <span className="muted">Requests, suggested details and flagged documents.</span>
        </Link>
      </div>
      <div className="split traveller-working-area">
        <div className="split-main">
          <div className="traveller-section-heading">
            <h3>Continue Where You Left Off</h3>
            <Link href={`/app/applicant/${id}/missions`}>All Cases →</Link>
          </div>
          <article className="card traveller-featured-case">
            {!data.missions.ok ? (
              <EmptyState icon="alert" title="Cases are unavailable">
                Refresh to try again.
              </EmptyState>
            ) : data.featured ? (
              <>
                <div className="traveller-section-heading">
                  <h4>{data.featured.title}</h4>
                  <StatusBadge tone="neutral">
                    {STAGE_LABELS[data.featured.state] ?? 'In Progress'}
                  </StatusBadge>
                </div>
                <p className="muted">
                  {data.featured.jurisdiction ?? 'Visa Case'} ·{' '}
                  {data.featured.serviceCategory ?? 'Personal application'}
                </p>
                <div className="traveller-checklist">
                  <div className="meter-label">
                    <strong>Checklist Progress</strong>
                    <span>
                      {data.readiness?.ok
                        ? `${data.readiness.value.satisfiedRequired} of ${data.readiness.value.requiredCount} required items`
                        : 'Not calculated'}
                    </span>
                  </div>
                  {data.readiness?.ok && data.readiness.value.requiredCount > 0 ? (
                    <div className="meter" aria-hidden="true">
                      <div
                        className="meter-fill"
                        style={{
                          width: `${(data.readiness.value.satisfiedRequired / data.readiness.value.requiredCount) * 100}%`,
                        }}
                      />
                    </div>
                  ) : null}
                  <p className="muted">
                    {!data.featured.packVersionId
                      ? 'This case uses manual requirements. Review its checklist in the case.'
                      : 'Requirement completeness is not an approval prediction.'}
                  </p>
                </div>
                <div className="traveller-section-heading">
                  <Link className="btn btn-primary" href={`/app/mission/${data.featured.id}`}>
                    Continue Case →
                  </Link>
                  <span className="muted">
                    Updated {formatTimestampDate(data.featured.updatedAt)}
                  </span>
                </div>
              </>
            ) : (
              <EmptyState
                icon="briefcase"
                title="No Active Case Yet"
                action={{ href: `/app/applicant/${id}/missions`, label: 'Start a Visa Case' }}
              >
                Create a case to organize this traveller's requirements and documents.
              </EmptyState>
            )}
          </article>
          {data.active.length > 1 ? (
            <div className="card rows">
              {data.active.slice(1, 4).map((m) => (
                <Link className="row row-link" href={`/app/mission/${m.id}`} key={m.id}>
                  <span className="row-key">{m.title}</span>
                  <StatusBadge tone="neutral">{STAGE_LABELS[m.state] ?? 'In Progress'}</StatusBadge>
                </Link>
              ))}
            </div>
          ) : null}
          <h3>Needs Your Attention</h3>
          <NextStepCard title={next.title} why={next.why} href={next.href} action={next.action} />
          {attention > 0 ? (
            <article className="card rows">
              {requests.length ? (
                <Link className="row row-link" href={`/app/applicant/${id}/evidence`}>
                  <span className="row-key">Evidence Requests Waiting for a Reply</span>
                  <StatusBadge tone="warning">{requests.length}</StatusBadge>
                </Link>
              ) : null}
              {data.proposals.length ? (
                <Link className="row row-link" href={`/app/applicant/${id}/documents`}>
                  <span className="row-key">Suggested Details Awaiting Approval</span>
                  <StatusBadge tone="warning">{data.proposals.length}</StatusBadge>
                </Link>
              ) : null}
              {flagged.length ? (
                <Link className="row row-link" href={`/app/applicant/${id}/documents`}>
                  <span className="row-key">Documents Needing Review</span>
                  <StatusBadge tone="warning">{flagged.length}</StatusBadge>
                </Link>
              ) : null}
            </article>
          ) : null}
        </div>
        <aside
          className="split-rail"
          aria-label="Upcoming dates, recent activity and profile health"
        >
          <h3>Upcoming</h3>
          <article className="card">
            {agenda.length ? (
              <ol className="traveller-agenda">
                {agenda.map((row) => (
                  <li key={row.key}>
                    <Link href={row.href}>{row.label}</Link>
                    <time dateTime={row.date.toISOString()}>{formatTimestampDate(row.date)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                icon="alert"
                title={data.missions.ok ? 'No Upcoming Case Dates' : 'Dates are unavailable'}
              >
                Set a target deadline or travel date in a case. Appointments remain in the
                individual case calendar.
              </EmptyState>
            )}
            <Link href={`/app/applicant/${id}/expiry`}>Document Expiry Centre →</Link>
          </article>
          <h3>Recent Activity</h3>
          <article className="card">
            {activity.length ? (
              <ol className="traveller-activity">
                {activity.map((row) => (
                  <li key={row.key}>
                    <Link href={row.href}>
                      <strong>{row.label}</strong>
                      <span>{row.detail}</span>
                    </Link>
                    <time dateTime={row.date}>{formatTimestampDate(row.date)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon="activity" title="No Recorded Activity Yet">
                Profile changes, uploads and case updates will appear here. This is a recent-record
                summary, not a complete audit log.
              </EmptyState>
            )}
            <Link href={`/app/applicant/${id}/history`}>Profile History →</Link>
          </article>
          <article className="card">
            <h3>Profile &amp; Sharing</h3>
            <div className="meter-label">
              <span>Details with values in open sections</span>
              <span>
                {completed} / {completion.total}
              </span>
            </div>
            <div className="meter" aria-hidden="true">
              <div className="meter-fill" style={{ width: `${completeness}%` }} />
            </div>
            <p className="muted">Completeness does not verify identity.</p>
            <Link href={`/app/applicant/${id}/profile`}>Continue Profile →</Link>
            <p className="muted">
              Active sharing grants:{' '}
              {data.access.ok
                ? data.access.value.filter((g) => g.status === 'ACTIVE').length
                : 'Unavailable'}
            </p>
            <Link href={`/app/applicant/${id}/sharing`}>Manage Sharing →</Link>
          </article>
        </aside>
      </div>
    </div>
  );
}
