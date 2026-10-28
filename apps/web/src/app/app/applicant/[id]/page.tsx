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
  listNeedsAttention,
  listPendingProposals,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaseReadinessRing } from '../../../../components/case-readiness-ring';
import { DeadlineClock } from '../../../../components/deadline-clock';
import { DepthScope, atLevel } from '../../../../components/depth';
import { DepthSwitch } from '../../../../components/depth-switch';
import { EmptyState, NextStepCard, PageHeader, StatusBadge } from '../../../../components/ui';
import { openCasesNewestFirst } from '../../../../lib/case-stages';
import { depthCopyFor } from '../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../lib/ccd/depth.server';
import { formatTimestampDate } from '../../../../lib/format-date';
import { attentionActionLabel } from '../../../../lib/labels';
import { completionOf, essentialsProgress, fieldLabel } from '../../../../lib/master-profile';
import { openOwnerGate } from '../../../../lib/owner-gate';
import { agree, plural } from '../../../../lib/plural';
import { withSession } from '../../../../lib/session';
import { STAGE_LABELS } from '../../agency/[orgId]/case-search-form';
import { attentionContext, attentionHeading } from '../../attention-display';
import {
  CLOCK_HOME_LIMIT,
  deadlineLines,
  loadDeadlineEntries,
  validUntilLine,
} from '../../deadline-clock-data';

export const metadata: Metadata = { title: 'Traveller Home' };
export const dynamic = 'force-dynamic';

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
    // Started now so they run beside the reads below; neither throws (a failed read is null).
    const deadlinesRead = loadDeadlineEntries(db, accountId, id, new Date(), CLOCK_HOME_LIMIT);
    // What needs this person next comes from the same Needs Attention ranking as Account Home
    // (ADR 0016), read through the central gate as the owner. A refusal or failed read gives
    // null, and the page falls back to the checks it can make itself.
    const attentionReading = (async () => {
      try {
        const gate = await openOwnerGate(db, accountId, id);
        const listed = gate ? await listNeedsAttention(gate, { now: new Date() }) : null;
        return listed?.ok ? listed.value : null;
      } catch {
        return null;
      }
    })();
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
    const active = missions.ok ? openCasesNewestFirst(missions.value) : [];
    const featured = active[0];

    const readiness = featured?.packVersionId ? await computeReadiness(db, featured.id) : null;
    return {
      deadlines: await deadlinesRead,
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
      attentionRead: await attentionReading,
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
  // The short starter list leads; the size of the whole profile follows once it is done.
  const essentials = essentialsProgress(data.profile, data.sectionChoices);
  const essentialsDone = essentials.done;
  const attention = requests.length + data.proposals.length + flagged.length;
  const partial = !data.documents.ok || !data.missions.ok || !data.requests.ok || !data.access.ok;
  const topItem = data.attentionRead?.items[0];
  // The ranking decides first, with Account Home's wording. Without it (a failed read) the page
  // checks requests and suggestions itself. Flagged documents and the profile come next.
  const next = !data.coreGranted
    ? {
        href: '/app#permissions',
        title: 'Allow Core Processing',
        why: 'Choose whether your profile and documents may be saved. You can withdraw this permission.',
        action: 'Review Permissions',
      }
    : topItem
      ? {
          href: topItem.href,
          title: attentionHeading(topItem),
          why: attentionContext(topItem)
            ? `${attentionContext(topItem)}. ${topItem.why}`
            : topItem.why,
          action: attentionActionLabel(topItem),
          tone: 'warning' as const,
        }
      : data.attentionRead === null && requests.length
        ? {
            href: `/app/applicant/${id}/evidence`,
            title: 'Reply to an Evidence Request',
            why: 'An agency is waiting for evidence before it can continue.',
            action: 'Open Requests',
          }
        : data.attentionRead === null && data.proposals.length
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
            : !essentialsDone
              ? {
                  href: `/app/applicant/${id}/profile`,
                  title: 'Add Your Essentials',
                  why: `${essentials.answered} of ${essentials.total} essentials added: the details most visa forms ask for first. This is completeness, not verification.`,
                  action: 'Open Profile',
                }
              : completeness < 100
                ? {
                    href: `/app/applicant/${id}/profile`,
                    title: 'Continue Your Profile',
                    why: `${completed} of ${completion.total} details in your open sections have values. This is completeness, not verification.`,
                    action: 'Open Profile',
                  }
                : partial || data.attentionRead === null
                  ? {
                      // Something could not be read, so the page cannot say nothing is waiting.
                      href: `/app/applicant/${id}/missions`,
                      title: 'Start or Review a Case',
                      why: 'Reuse your existing profile for the next visa route.',
                      action: 'Open Cases',
                    }
                  : {
                      // Nothing needs the person: a calm all-clear that picks the case back up.
                      href: data.featured
                        ? `/app/mission/${data.featured.id}`
                        : `/app/applicant/${id}/missions#start-case`,
                      title: 'Nothing Needs You Right Now',
                      why: data.featured
                        ? `You are up to date. Pick up ${data.featured.title} where you left off.`
                        : [
                            'You are up to date.',
                            // One real fact, never an invented task (CCD section 6).
                            data.deadlines && validUntilLine(data.deadlines, { showPerson: false }),
                            'Start a case when you plan your next trip.',
                          ]
                            .filter(Boolean)
                            .join(' '),
                      action: data.featured ? 'Continue Case' : 'Start a Case',
                      tone: 'ok' as const,
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
  const depth = await readDepth('traveller-home');
  const depthWords = depthCopyFor('traveller');
  return (
    <div className="traveller-overview">
      <PageHeader
        eyebrow="Home"
        title={data.applicant.displayName}
        description={
          partial
            ? 'Some records could not be loaded. Try refreshing before relying on these totals.'
            : attention
              ? `${plural(attention, 'item')} ${agree(attention, 'needs', 'need')} a decision or a closer look.`
              : 'Your next steps, documents and cases in one place.'
        }
        actions={
          <Link className="btn btn-secondary" href={`/app/applicant/${id}/missions#start-case`}>
            Start a Case
          </Link>
        }
      />
      <DepthScope family="traveller-home" depth={depth}>
        <DepthSwitch family="traveller-home" initial={depth} copy={depthWords} />
        {partial ? (
          <output className="notice notice-warn">
            Some sections are unavailable. Unavailable totals are not reported as zero.
          </output>
        ) : null}
        <NextStepCard {...next} />
        {data.featured ? (
          <p className="muted" data-only="glance">
            Your case: <Link href={`/app/mission/${data.featured.id}`}>{data.featured.title}</Link>
            {' \u00b7 '}
            {STAGE_LABELS[data.featured.state] ?? 'In Progress'}
          </p>
        ) : null}
        <div className="traveller-metrics" {...atLevel('browse')}>
          <Link className="card traveller-metric" href={`/app/applicant/${id}/missions`}>
            <span>Active Cases</span>
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
            <div className="depth-item" {...atLevel('browse')}>
              <div className="traveller-section-heading">
                <h3>Continue Where You Left Off</h3>
                <Link href={`/app/applicant/${id}/missions`}>All Cases →</Link>
              </div>
              <article className="card traveller-featured-case">
                {!data.missions.ok ? (
                  <EmptyState icon="alert" title="Cases Are Unavailable">
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
                      <strong>Checklist Progress</strong>
                      <CaseReadinessRing
                        readiness={data.readiness?.ok ? data.readiness.value : null}
                        {...(data.featured.packVersionId
                          ? { emptyLine: 'Progress could not be worked out. Refresh to try again.' }
                          : { pickHref: `/app/mission/${data.featured.id}#pack` })}
                      />
                      <p className="muted">
                        {!data.featured.packVersionId
                          ? "Until a checklist is attached, you review this case's requirements by hand in the case."
                          : 'Requirement completeness is not an approval prediction.'}
                      </p>
                    </div>
                    <div className="traveller-section-heading">
                      <Link className="btn btn-secondary" href={`/app/mission/${data.featured.id}`}>
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
                    why="Then you can see which checklist items are ready and which are still missing."
                    action={{
                      href: `/app/applicant/${id}/missions#start-case`,
                      label: 'Start a Case',
                    }}
                  >
                    A case is where one visa application comes together. Start one for the route you
                    are planning, and your saved documents are checked against its checklist.
                  </EmptyState>
                )}
              </article>
              {data.active.length > 1 ? (
                <div className="card rows">
                  {data.active.slice(1, 4).map((m) => (
                    <Link className="row row-link" href={`/app/mission/${m.id}`} key={m.id}>
                      <span className="row-key">{m.title}</span>
                      <StatusBadge tone="neutral">
                        {STAGE_LABELS[m.state] ?? 'In Progress'}
                      </StatusBadge>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="depth-item" {...atLevel('browse')}>
              <h3>Needs Your Attention</h3>
              {attention === 0 ? (
                <p className="muted">Nothing needs a decision right now.</p>
              ) : null}
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
          </div>
          <aside
            className="split-rail"
            aria-label="Upcoming dates, recent activity and profile health"
            {...atLevel('browse')}
          >
            <div className="depth-item" {...atLevel('browse')}>
              <DeadlineClock
                heading="Deadline Clock"
                headingId="applicant-deadline-clock-heading"
                headingLevel="h3"
                lines={
                  data.deadlines === null
                    ? null
                    : deadlineLines(data.deadlines, { showPerson: false })
                }
                addAction={{ href: `/app/applicant/${id}/documents`, label: 'Add a Document' }}
                more={{ href: `/app/applicant/${id}/expiry`, label: 'See All Dates' }}
              />
            </div>
            <div className="depth-item" {...atLevel('everything')}>
              <h3>Upcoming</h3>
              <article className="card">
                {agenda.length ? (
                  <ol className="traveller-agenda">
                    {agenda.map((row) => (
                      <li key={row.key}>
                        <Link href={row.href}>{row.label}</Link>
                        <time dateTime={row.date.toISOString()}>
                          {formatTimestampDate(row.date)}
                        </time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyState
                    icon="alert"
                    title={data.missions.ok ? 'No Upcoming Case Dates' : 'Dates Are Unavailable'}
                  >
                    Set a target deadline or travel date in a case. Appointments remain in the
                    individual case calendar.
                  </EmptyState>
                )}
                <Link href={`/app/applicant/${id}/expiry`}>Dates &amp; Expiry →</Link>
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
                    Profile changes, uploads and case updates will appear here. This is a
                    recent-record summary, not a complete audit log.
                  </EmptyState>
                )}
                <Link href={`/app/applicant/${id}/history`}>Profile History →</Link>
              </article>
              <article className="card">
                <h3>Profile &amp; Sharing</h3>
                {essentialsDone ? (
                  <>
                    <div className="meter-label">
                      <span>Details with values in open sections</span>
                      <span>
                        {completed} / {completion.total}
                      </span>
                    </div>
                    <div className="meter" aria-hidden="true">
                      <div className="meter-fill" style={{ width: `${completeness}%` }} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="meter-label">
                      <span>Essentials added</span>
                      <span>
                        {essentials.answered} / {essentials.total}
                      </span>
                    </div>
                    <div className="meter" aria-hidden="true">
                      <div
                        className="meter-fill"
                        style={{
                          width: `${essentials.percent}%`,
                        }}
                      />
                    </div>
                  </>
                )}
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
            </div>
          </aside>
        </div>
      </DepthScope>
    </div>
  );
}
