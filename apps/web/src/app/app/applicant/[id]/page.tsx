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
  rankAttentionItems,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaseReadinessRing } from '../../../../components/case-readiness-ring';
import { DeadlineClock } from '../../../../components/deadline-clock';
import { DepthScope, atLevel } from '../../../../components/depth';
import { DepthSwitch } from '../../../../components/depth-switch';
import { NO_CHECKLIST_LINE } from '../../../../components/progress-ring';
import { EmptyState, NextStepCard, PageHeader, StatusBadge } from '../../../../components/ui';
import { AboutDisclosure, ActionRow, ProgressMeter } from '../../../../components/ui-lift';
import { openCasesNewestFirst } from '../../../../lib/case-stages';
import { depthCopyFor } from '../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../lib/ccd/depth.server';
import { formatTimestampDate } from '../../../../lib/format-date';
import { attentionActionLabel } from '../../../../lib/labels';
import { completionOf, essentialsProgress, fieldLabel } from '../../../../lib/master-profile';
import { openOwnerGate } from '../../../../lib/owner-gate';
import { noticesToRank, readPackageNotices } from '../../../../lib/package-notices';
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
import { HeldFilesLine, readHeldFileCount } from '../../held-files-line';
import { TravellerLifecycleBar } from './traveller-manage/lifecycle-bar';
import { loadTravellerManage } from './traveller-manage/load';
import { OUTCOME_PARAM } from './traveller-manage/messages';

export const metadata: Metadata = { title: 'Traveller Home' };
export const dynamic = 'force-dynamic';

export default async function ApplicantOverviewPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const outcome = (await searchParams)?.[OUTCOME_PARAM];
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
        if (!gate) return null;
        // UMPE P13: package changes and checklist updates join the same ranking, read beside it;
        // a failed read leaves them out rather than losing the rest.
        const [listed, notices] = await Promise.all([
          listNeedsAttention(gate, { now: new Date() }),
          readPackageNotices(gate),
        ]);
        if (!listed.ok) return null;
        return notices
          ? {
              ...listed.value,
              items: rankAttentionItems([
                ...listed.value.items,
                ...noticesToRank(listed.value.items, notices),
              ]),
            }
          : listed.value;
      } catch {
        return null;
      }
    })();
    // UMPE G4: family files waiting for Which Person?; never throws (a failed read counts none).
    const heldFilesRead = readHeldFileCount(db, accountId, id);
    // Archive, Restore and Remove Empty Record (LC-E); null hides them. Never throws.
    const manageReading = loadTravellerManage(db, accountId, id);
    const [profile, documents, coreGranted, proposals, missions, requests, access, sectionChoices] =
      await Promise.all([
        listApplicantProfile(db, id),
        // Counted and flagged as the Documents page's Current list is: everyday documents (LC-Z).
        listDocumentsDetailed(db, accountId, id, { lifecycle: 'everyday' }),
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
      manage: await manageReading,
      heldFiles: await heldFilesRead,
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
  // An AI app's suggestions about the profile itself are reviewed on My Profile (S21); every other
  // suggestion belongs to a document.
  const appSuggestions = data.proposals.filter(
    (reading) => reading.fromApp !== undefined && reading.proposal?.documentVersionId === null,
  );
  const readings = data.proposals.filter((reading) => !appSuggestions.includes(reading));
  const attention = requests.length + readings.length + appSuggestions.length + flagged.length;
  // The three first steps to being ready to apply, in the order a new traveller takes them. Shown
  // only while one is left, and only when the three can be read (never a step guessed as undone).
  // A file blocked by the safety check is not an added document, and a case that has finished is
  // still a case started: the steps never send a returning traveller back to the beginning.
  const cleanDocuments = documents.filter((d) => d.safetyStatus !== 'QUARANTINED');
  const casesEver = data.missions.ok ? data.missions.value.length : 0;
  const pathSteps = [
    {
      key: 'essentials',
      title: essentialsDone ? 'Essentials Added' : 'Add Your Essentials',
      line: essentialsDone
        ? 'All added'
        : `${essentials.answered} of ${essentials.total} added, about 5 minutes`,
      href: `/app/applicant/${id}/profile`,
      done: essentialsDone,
    },
    {
      key: 'document',
      title: cleanDocuments.length > 0 ? 'Document Added' : 'Add a Document',
      line: cleanDocuments.length
        ? `${plural(cleanDocuments.length, 'document')} in your wallet`
        : 'Start with your passport. It takes a minute.',
      href: `/app/applicant/${id}/documents/add`,
      done: cleanDocuments.length > 0,
    },
    {
      key: 'case',
      title: casesEver > 0 ? 'Case Started' : 'Start a Case',
      line: data.active.length
        ? `${plural(data.active.length, 'active case')}`
        : casesEver > 0
          ? 'Started before'
          : 'Check your documents against one visa route',
      href: `/app/applicant/${id}/missions#start-case`,
      done: casesEver > 0,
    },
  ];
  const pathDone = pathSteps.filter((step) => step.done).length;
  const pathNext = pathSteps.find((step) => !step.done)?.key;
  const showPath =
    data.coreGranted && data.documents.ok && data.missions.ok && pathDone < pathSteps.length;
  const partial = !data.documents.ok || !data.missions.ok || !data.requests.ok || !data.access.ok;
  const topItem = data.attentionRead?.items[0];
  // The ranking decides first, with Account Home's wording. Without it (a failed read) the page
  // checks requests and suggestions itself. Flagged documents and the profile come next.
  // Details read from the person's documents come first unless something is already past due:
  // they are the whole point of adding a document, and they wait for one answer on one screen.
  const detailsFirst = readings.length > 0 && topItem?.tier !== 1;
  const next = !data.coreGranted
    ? {
        href: '/app#permissions',
        title: 'Let VisaStack Process My Details',
        why: 'Choose whether your profile and documents may be saved. You can withdraw this permission.',
        action: 'Review Permissions',
      }
    : detailsFirst
      ? {
          href: `/app/applicant/${id}/review`,
          title: `${readings.length === 1 ? 'One Detail' : `${readings.length} Details`} Found in Your Documents`,
          why: 'Add them to your profile with one tap. Nothing is added until you accept it.',
          action: 'Review Details',
          tone: 'warning' as const,
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
          : data.attentionRead === null && appSuggestions.length
            ? {
                href: `/app/applicant/${id}/profile`,
                title: 'Suggestions from AI Apps Waiting for You',
                why: 'Nothing is saved to your profile until you accept it.',
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
                              data.deadlines &&
                                validUntilLine(data.deadlines, { showPerson: false }),
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
              ? `${plural(attention, 'item')} ${agree(attention, 'needs', 'need')} a look.`
              : 'Nothing is waiting for you.'
        }
        actions={
          data.manage?.lifecycle.state === 'RECENTLY_DELETED' ? undefined : (
            <Link className="btn btn-secondary" href={`/app/applicant/${id}/missions#start-case`}>
              Start a Case
            </Link>
          )
        }
      />
      <TravellerLifecycleBar
        applicantId={id}
        name={data.applicant.displayName}
        view={data.manage}
        outcome={outcome}
      />
      <DepthScope family="traveller-home" depth={depth}>
        <DepthSwitch family="traveller-home" initial={depth} copy={depthWords} notesBehindInfo />
        {partial ? (
          <output className="notice notice-warn">
            Some sections are unavailable. Unavailable totals are not reported as zero.
          </output>
        ) : null}
        <NextStepCard {...next} />
        {/* UMPE G4: family files waiting for Which Person? (one line, nothing when none). */}
        <HeldFilesLine applicantId={id} count={data.heldFiles} />
        {data.featured ? (
          <p className="muted" data-only="glance">
            Your case: <Link href={`/app/mission/${data.featured.id}`}>{data.featured.title}</Link>
            {' \u00b7 '}
            {STAGE_LABELS[data.featured.state] ?? 'In Progress'}
          </p>
        ) : null}
        <div className="traveller-metrics" {...atLevel('browse')}>
          <Link
            data-tone="blue"
            className={`card traveller-metric lift-tile${data.missions.ok && data.active.length === 0 ? ' lift-tile-zero' : ''}`}
            href={`/app/applicant/${id}/missions`}
          >
            <span className="lift-tile-label">Active Cases</span>
            <strong
              className={`lift-tile-numeral${data.missions.ok ? '' : ' traveller-metric-off'}`}
            >
              {data.missions.ok ? data.active.length : 'Unavailable'}
            </strong>
          </Link>
          <Link
            data-tone="teal"
            className={`card traveller-metric lift-tile${data.documents.ok && documents.length === 0 ? ' lift-tile-zero' : ''}`}
            href={`/app/applicant/${id}/documents`}
          >
            <span className="lift-tile-label">Documents in Your Wallet</span>
            <strong
              className={`lift-tile-numeral${data.documents.ok ? '' : ' traveller-metric-off'}`}
            >
              {data.documents.ok ? documents.length : 'Unavailable'}
            </strong>
          </Link>
          <Link
            data-tone={data.documents.ok && data.requests.ok && attention > 0 ? 'amber' : 'green'}
            className={`card traveller-metric lift-tile${data.documents.ok && data.requests.ok && attention === 0 ? ' lift-tile-zero' : ''}`}
            href={`/app/applicant/${id}/evidence`}
          >
            <span className="lift-tile-label">Items Needing Attention</span>
            <strong
              className={`lift-tile-numeral${
                data.documents.ok && data.requests.ok ? '' : ' traveller-metric-off'
              }`}
            >
              {data.documents.ok && data.requests.ok ? attention : 'Unavailable'}
            </strong>
          </Link>
        </div>
        {/* Owner, 5 Nov 2026: no page should have more than 30 words. What each total counts is one tap away. */}
        <AboutDisclosure summary="About These Totals">
          <p>Closed and cancelled cases are excluded.</p>
          <p>Open documents to review processing and safety.</p>
          <p>Requests, suggested details and flagged documents.</p>
        </AboutDisclosure>
        <div className="split traveller-working-area">
          <div className="split-main">
            {showPath ? (
              <div className="depth-item" {...atLevel('browse')}>
                <article className="card home-path" aria-labelledby="home-path-title">
                  <h3 id="home-path-title">
                    {pathDone === 0
                      ? 'Three Steps to Get Ready'
                      : `${pathDone} of ${pathSteps.length} Steps Done. Keep Going`}
                  </h3>
                  <ol className="home-path-steps" aria-label="Steps to get ready">
                    {pathSteps.map((step, index) => (
                      <li key={step.key}>
                        <Link className="home-path-step plain-link" href={step.href}>
                          <span
                            aria-hidden="true"
                            className={`home-path-mark${step.done ? ' home-path-done' : ''}`}
                          >
                            {step.done ? '\u2713' : index + 1}
                          </span>
                          <span className="home-path-text">
                            <span className="sr-only">
                              Step {index + 1} of {pathSteps.length}.
                            </span>
                            <strong>{step.title}</strong>
                            <span className="muted">{step.line}</span>
                          </span>
                          {step.done ? (
                            <span className="home-path-state">Done</span>
                          ) : step.key === pathNext ? (
                            <span className="home-path-state home-path-next">Next</span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </article>
              </div>
            ) : null}
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
                      {data.readiness?.ok && data.readiness.value.requiredCount > 0 ? (
                        <ProgressMeter
                          size={6}
                          value={data.readiness.value.satisfiedRequired}
                          max={data.readiness.value.requiredCount}
                          label="required items on file"
                          valueText={`${data.readiness.value.satisfiedRequired} of ${data.readiness.value.requiredCount} required items on file`}
                        />
                      ) : (
                        <CaseReadinessRing
                          size="sm"
                          readiness={data.readiness?.ok ? data.readiness.value : null}
                          {...(data.featured.packVersionId
                            ? {
                                emptyLine:
                                  'Progress could not be worked out. Refresh to try again.',
                              }
                            : { pickHref: `/app/mission/${data.featured.id}#pack` })}
                        />
                      )}
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
                    art="trips"
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
                <div className="card lc-flush">
                  {data.active.slice(1, 4).map((m) => (
                    <ActionRow
                      key={m.id}
                      href={`/app/mission/${m.id}`}
                      icon="briefcase"
                      title={m.title}
                      {...(m.packVersionId ? {} : { meta: NO_CHECKLIST_LINE })}
                      pill={
                        <StatusBadge tone="neutral">
                          {STAGE_LABELS[m.state] ?? 'In Progress'}
                        </StatusBadge>
                      }
                    />
                  ))}
                </div>
              ) : null}
            </div>
            <div className="depth-item" {...atLevel('browse')}>
              <h3>Needs Your Attention</h3>
              {attention === 0 ? (
                <p className="home-clear">
                  <span aria-hidden="true" className="home-clear-mark">
                    {'\u2713'}
                  </span>
                  Nothing needs a decision right now.
                </p>
              ) : null}
              {attention > 0 ? (
                <article className="card lc-flush">
                  {requests.length ? (
                    <ActionRow
                      href={`/app/applicant/${id}/evidence`}
                      icon="clipboard"
                      title="Evidence Requests Waiting for a Reply"
                      pill={<StatusBadge tone="warning">{requests.length}</StatusBadge>}
                    />
                  ) : null}
                  {readings.length ? (
                    <ActionRow
                      href={`/app/applicant/${id}/review`}
                      icon="eye"
                      title="Suggested Details Awaiting Approval"
                      pill={<StatusBadge tone="warning">{readings.length}</StatusBadge>}
                    />
                  ) : null}
                  {appSuggestions.length ? (
                    <ActionRow
                      href={`/app/applicant/${id}/profile`}
                      icon="shield"
                      title="Suggestions from AI Apps Waiting for You"
                      pill={<StatusBadge tone="warning">{appSuggestions.length}</StatusBadge>}
                    />
                  ) : null}
                  {flagged.length ? (
                    <ActionRow
                      href={`/app/applicant/${id}/documents`}
                      icon="file"
                      title="Documents Needing Review"
                      pill={<StatusBadge tone="warning">{flagged.length}</StatusBadge>}
                    />
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
                addAction={{ href: `/app/applicant/${id}/documents/add`, label: 'Add a Document' }}
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
                        <Link className="plain-link" href={row.href}>
                          {row.label}
                        </Link>
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
                <Link className="home-more plain-link" href={`/app/applicant/${id}/expiry`}>
                  Dates &amp; Expiry →
                </Link>
              </article>
              <h3>Recent Activity</h3>
              <article className="card">
                {activity.length ? (
                  <ol className="traveller-activity">
                    {activity.map((row) => (
                      <li key={row.key}>
                        <Link className="plain-link" href={row.href}>
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
                <Link className="home-more plain-link" href={`/app/applicant/${id}/history`}>
                  Profile History →
                </Link>
              </article>
              <article className="card home-profile">
                <h3>Profile &amp; Sharing</h3>
                {essentialsDone ? (
                  <>
                    <div className="meter-label">
                      <span>Details with values in open sections</span>
                      <span>
                        {completed} / {completion.total}
                      </span>
                    </div>
                    <ProgressMeter
                      size={6}
                      value={completed}
                      max={completion.total}
                      label="details with values in open sections"
                      valueText={null}
                    />
                  </>
                ) : (
                  <>
                    <div className="meter-label">
                      <span>Essentials added</span>
                      <span>
                        {essentials.answered} / {essentials.total}
                      </span>
                    </div>
                    <ProgressMeter
                      size={6}
                      value={essentials.answered}
                      max={essentials.total}
                      label="essentials added"
                      valueText={null}
                    />
                  </>
                )}
                <p className="muted">Completeness does not verify identity.</p>
                <Link className="home-more plain-link" href={`/app/applicant/${id}/profile`}>
                  Continue Profile →
                </Link>
                <p className="muted">
                  Active sharing grants:{' '}
                  {data.access.ok
                    ? data.access.value.filter((g) => g.status === 'ACTIVE').length
                    : 'Unavailable'}
                </p>
                <Link className="home-more plain-link" href={`/app/applicant/${id}/sharing`}>
                  Manage Sharing →
                </Link>
              </article>
            </div>
          </aside>
        </div>
      </DepthScope>
    </div>
  );
}
