import { createTranslator } from '@visastack/i18n';
import {
  type ChangesSinceConfirmed,
  type OverallReadinessState,
  type RequirementResultState,
  accountPrincipal,
  computeReadiness,
  getApplicant,
  getEvidenceCandidates,
  getLatestExplanationForRequirement,
  getLiveAcknowledgement,
  getMissionForOwner,
  getPack,
  getPackVersion,
  grantReachesCase,
  isFactStatusEligible,
  legalTransitions,
  listAccessForApplicant,
  listAcknowledgementsForMission,
  listAppointments,
  listChangesSinceConfirmed,
  listComplaintEvents,
  listComplaintsForMission,
  listContributorRequests,
  listFeedbackForMission,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissionsByItineraryRef,
  listNotesForOwner,
  listOutcomesForMission,
  listPublishedPackVersions,
  listRequirements,
  listSelectedEvidence,
  listSubmissionsForMission,
  listTasks,
  referenceCodeFor,
  requireAccess,
  safeHttpUrl,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import {
  CasePreparationSummary,
  CaseStageTracker,
} from '../../../../components/case-preparation-summary';
import { ReferenceCode } from '../../../../components/reference-code';
import { Disclosure, PageHeader, StatusBadge } from '../../../../components/ui';
import { isExplanationConfigured } from '../../../../lib/ai';
import { memoryHref } from '../../../../lib/application-memory-labels';
import { humanizeCode } from '../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
import { getLocale } from '../../../../lib/locale';
import { fieldLabel } from '../../../../lib/master-profile';
import { REQUIREMENT_GROUPS } from '../../../../lib/requirement-groups';
import { withSession } from '../../../../lib/session';
import { AttachPackForm, type PackOption } from './attach-pack-form';
import { ChangesSinceConfirmedList } from './changes-since-confirmed';
import {
  AppointmentsPanel,
  EvidenceSelectionPanel,
  LettersPanel,
  TasksPanel,
} from './collaboration-panels';
import { ComplaintPanel, FeedbackPanel } from './complaint-feedback-panel';
import { ContributorRequestsPanel } from './contributor-requests-panel';
import { composeSelectionCandidateKey } from './evidence-selection-key';
import {
  CaseDetailsForm,
  ItineraryForm,
  SnapshotButton,
  TransitionButtons,
} from './mission-buttons';
import { OutcomePanel } from './outcome-panel';
import { ExplainGapButton } from './readiness-gap-explain';
import { SubmissionReportPanel } from './submission-report-panel';

export const metadata: Metadata = { title: 'Case' };

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  INTAKE: 'Intake',
  IN_REVIEW: 'In Review',
  AWAITING_APPLICANT: 'Awaiting Applicant',
  SUBMISSION_READY: 'Submission Ready',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In Progress',
  READY_FOR_REVIEW: 'Ready for Review',
  UNDER_REVIEW: 'Under Review',
  READY_TO_EXPORT: 'Ready to Export',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

// A snapshot taken once the mission has reached this stage of the reviewer
// workflow is the application packet (Build Spec §4.5's "pack production"),
// not just a working evidence capture.
const PACKET_STATES: ReadonlySet<string> = new Set(['READY_TO_EXPORT', 'LOCKED', 'CLOSED']);

// RUL-04's four case-level outcomes (directive §10 case-readiness experience),
// never averaged from the per-requirement states below.
const OVERALL_STATE_META: Record<OverallReadinessState, { label: string; tone: string }> = {
  READY_FOR_APPLICANT_REVIEW: { label: 'Ready for Review', tone: 'badge-success' },
  NEEDS_REVIEW: { label: 'Needs Review', tone: 'badge-warning' },
  NEEDS_ACTION: { label: 'Needs Action', tone: 'badge-danger' },
  MANUAL_ONLY: { label: 'Manual · Not Automatically Assessed', tone: 'badge-neutral' },
};

// RUL-04's seven per-requirement outcomes. Sort order surfaces what still
// needs a decision first; NOT_APPLICABLE trails last since it needs none.
const REQUIREMENT_STATE_META: Record<
  RequirementResultState,
  { label: string; tone: string; next: string; order: number }
> = {
  CRITICAL_GAP: {
    label: 'Missing',
    tone: 'badge-danger',
    next: 'Add this to move the case forward.',
    order: 0,
  },
  CONFLICTING: {
    label: 'Two Values',
    tone: 'badge-danger',
    next: 'Two different values are on file. Pick the right one on your profile before it can count.',
    order: 1,
  },
  EXPIRING_STALE: {
    label: 'Out of Date',
    tone: 'badge-danger',
    next: 'The evidence on file is too old for this route. Add a current version.',
    order: 2,
  },
  UNVERIFIED: {
    label: 'To Confirm',
    tone: 'badge-warning',
    next: 'Whether this applies depends on case details that are not confirmed yet.',
    order: 3,
  },
  ATTENTION: {
    label: 'Optional',
    tone: 'badge-neutral',
    next: 'Optional for this case.',
    order: 4,
  },
  SATISFIED: { label: 'On File', tone: 'badge-success', next: '', order: 5 },
  NOT_APPLICABLE: {
    label: 'Not Applicable',
    tone: 'badge-neutral',
    next: 'Does not apply to this case.',
    order: 6,
  },
};

type AttentionKind = 'changed' | 'missing' | 'unconfirmed' | 'tasks';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// WP-X1 next step card: wording for the first attention item. A changed case
// is shown by its own alert instead, so it has no card wording.
const NEXT_STEP_COPY: Record<
  Exclude<AttentionKind, 'changed'>,
  { readonly title: (count: number) => string; readonly body: string; readonly action: string }
> = {
  // Counts missing, out-of-date and mismatched required items together.
  missing: {
    title: (count) => `Fix ${plural(count, 'required item', 'required items')}`,
    body: 'Some required items are missing, out of date or do not match.',
    action: 'See What Needs Fixing',
  },
  unconfirmed: {
    title: (count) => `Confirm ${plural(count, 'item', 'items')}`,
    body: 'Whether these apply depends on case details that are not confirmed yet.',
    action: 'See What to Confirm',
  },
  tasks: {
    title: (count) => `Finish ${plural(count, 'open task', 'open tasks')}`,
    body: 'Your open tasks are listed under Tasks, appointments and letters.',
    action: 'Open Tasks',
  },
};

interface RequirementDetailRow {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly optional: boolean;
  readonly state: RequirementResultState;
  readonly citation: string;
  readonly sourceTitle: string | null;
  readonly sourceUrl: string | null;
  readonly publisher: string | null;
  readonly observedDate: string | null;
  readonly sourceInaccessible: boolean;
}

export default async function MissionPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const t = createTranslator(locale);

  const data = await withSession(async ({ db, accountId }) => {
    const owned = await getMissionForOwner(db, accountId, id);
    if (!owned.ok) return null;
    const mission = owned.value;
    const applicant = await getApplicant(db, mission.applicantId);
    const [
      readiness,
      requirements,
      packVersionRow,
      snapshots,
      packs,
      tasks,
      letters,
      selections,
      candidates,
      linkedMissions,
      access,
      contributorRequests,
      notes,
      appointments,
      liveAcknowledgement,
      allAcknowledgements,
      outcomes,
      submissions,
      complaints,
      feedback,
      explanationConfigured,
    ] = await Promise.all([
      mission.packVersionId ? computeReadiness(db, mission.id) : Promise.resolve(null),
      mission.packVersionId ? listRequirements(db, mission.packVersionId) : Promise.resolve([]),
      mission.packVersionId
        ? getPackVersion(db, mission.packVersionId)
        : Promise.resolve(undefined),
      listMissionSnapshots(db, accountId, mission.id),
      listPublishedPackVersions(db),
      listTasks(db, accountId, mission.id),
      listGeneratedOutputs(db, accountId, mission.id),
      listSelectedEvidence(db, accountId, mission.id),
      getEvidenceCandidates(db, accountId, mission.id),
      mission.itineraryRef
        ? listMissionsByItineraryRef(db, {
            actorAccountId: accountId,
            itineraryRef: mission.itineraryRef,
          })
        : Promise.resolve([]),
      listAccessForApplicant(db, accountId, mission.applicantId),
      listContributorRequests(db, { actorAccountId: accountId, missionId: mission.id }),
      listNotesForOwner(db, accountId, mission.id),
      listAppointments(db, accountId, mission.id),
      // CAS-07 (Part 7 §6): whether this case currently has a live
      // acknowledgement -- surfaced here so the SUBMISSION_READY gate
      // (transitionMission) is legible before an owner clicks a button that
      // would otherwise fail with no visible reason why.
      getLiveAcknowledgement(db, mission.id),
      // Full history (not just the live one) so a "this case is dirty" banner
      // can distinguish "never acknowledged" from "was acknowledged, then a
      // material edit invalidated it, with no new live acknowledgement since"
      // -- getLiveAcknowledgement alone renders identically for both.
      listAcknowledgementsForMission(db, accountId, mission.id),
      listOutcomesForMission(db, accountId, mission.id),
      listSubmissionsForMission(db, accountId, mission.id),
      listComplaintsForMission(db, accountId, mission.id),
      listFeedbackForMission(db, accountId, mission.id),
      isExplanationConfigured(db),
    ]);
    const complaintList = complaints.ok ? complaints.value : [];
    const complaintEventsById = new Map(
      await Promise.all(
        complaintList.map(
          async (c) => [c.id, await listComplaintEvents(db, accountId, c.id)] as const,
        ),
      ),
    );
    const pack = packVersionRow ? await getPack(db, packVersionRow.packId) : undefined;
    // Case-readiness UI (directive §10): every requirement's richer RUL-04
    // state, joined back to its RUL-02 source-grounding fields (citation
    // alone lives on `RequirementResultSummary`; source URL/title/publisher/
    // observed date only live on the underlying `packRequirements` row), then
    // ordered so what still needs a decision surfaces above what doesn't.
    const readinessValue = readiness?.ok ? readiness.value : null;
    const requirementRowsById = new Map(requirements.map((r) => [r.id, r] as const));
    const requirementDetails: RequirementDetailRow[] = (readinessValue?.requirementResults ?? [])
      .map((r): RequirementDetailRow => {
        const row = requirementRowsById.get(r.packRequirementId);
        return {
          packRequirementId: r.packRequirementId,
          kind: r.kind,
          key: r.key,
          optional: r.optional,
          state: r.state,
          citation: row?.citation ?? '',
          sourceTitle: row?.sourceTitle ?? null,
          sourceUrl: row?.sourceUrl ?? null,
          publisher: row?.publisher ?? null,
          observedDate: row?.observedDate ? row.observedDate.toISOString() : null,
          sourceInaccessible: row?.sourceInaccessibleAt != null,
        };
      })
      .sort(
        (a, b) => REQUIREMENT_STATE_META[a.state].order - REQUIREMENT_STATE_META[b.state].order,
      );
    // Part 8 AI-01 item 5: the most recent AI explanation on file for each
    // genuine gap row (CRITICAL_GAP/ATTENTION only, the two states this task
    // covers) -- same fan-out shape as issuerVerifications/ocrRuns elsewhere
    // in this codebase's own document-list pages.
    const explanationEntries = await Promise.all(
      requirementDetails
        .filter((r) => r.state === 'CRITICAL_GAP' || r.state === 'ATTENTION')
        .map(
          async (r) =>
            [
              r.packRequirementId,
              await getLatestExplanationForRequirement(db, r.packRequirementId),
            ] as const,
        ),
    );
    const explanationsByRequirement = new Map(explanationEntries);
    const requiredHardGapCount = requirementDetails.filter(
      (r) =>
        !r.optional &&
        (r.state === 'CRITICAL_GAP' || r.state === 'CONFLICTING' || r.state === 'EXPIRING_STALE'),
    ).length;
    const requiredUnverifiedCount = requirementDetails.filter(
      (r) => !r.optional && r.state === 'UNVERIFIED',
    ).length;
    // Commercial V1 Part 4 §13: "An independent traveller may self-review:
    // label it self-reviewed." No organisation currently holding an ACTIVE,
    // accepted grant on this applicant means there is no external reviewer
    // in the picture at all, so the traveller's own assessment is the only
    // one that exists; this is never inferred from the mission's own state.
    // Only an organization whose grant reaches THIS case counts: a grant for
    // another case, or an all-cases grant this case is excluded from (ADR
    // 0017), is no reviewer here. The same case-scope rule as every access check.
    const selfReviewed =
      access.ok &&
      !access.value.some(
        (g) =>
          g.recipientOrganizationId !== null &&
          g.status === 'ACTIVE' &&
          grantReachesCase(g, mission.id),
      );
    // "This case is dirty" (§5): was acknowledged at least once, that
    // acknowledgement was later invalidated by a material edit, and no new
    // live acknowledgement has replaced it since.
    const isDirty =
      allAcknowledgements.ok &&
      !liveAcknowledgement &&
      allAcknowledgements.value.some(
        (a) => a.decision === 'ACKNOWLEDGED' && a.invalidatedAt !== null,
      );
    // WP-V3 part 3: what changed since the last confirmation, names only,
    // read through the central access gate. A failure leaves the alert as it was.
    let changesSinceConfirmed: ChangesSinceConfirmed | null = null;
    if (isDirty) {
      const gate = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { missionId: mission.id },
        { purpose: 'application_memory' },
      );
      const listed = gate.ok ? await listChangesSinceConfirmed(gate.value) : null;
      changesSinceConfirmed = listed?.ok ? listed.value : null;
    }
    // Evidence picker for the outcome form -- every distinct document already
    // surfaced as evidence-eligible for this mission, deduplicated (the same
    // document can satisfy more than one requirement).
    const evidenceOptionsById = new Map<string, string>();
    for (const c of candidates.ok ? candidates.value : []) {
      for (const d of c.documentCandidates) {
        if (!evidenceOptionsById.has(d.documentId))
          evidenceOptionsById.set(d.documentId, d.displayName);
      }
    }
    // Composite key (finding #33, post-programme defect register) - see
    // evidence-selection-key.ts's own doc comment.
    const selectionIdsByCandidate: Record<string, string> = {};
    if (selections.ok) {
      for (const s of selections.value) {
        if (s.factId) {
          selectionIdsByCandidate[composeSelectionCandidateKey(s.packRequirementId, s.factId)] =
            s.id;
        }
        if (s.documentId) {
          selectionIdsByCandidate[composeSelectionCandidateKey(s.packRequirementId, s.documentId)] =
            s.id;
        }
      }
    }
    // Every linked mission is already scoped to the caller's own applicants
    // (listMissionsByItineraryRef's own guarantee), so a name lookup per
    // distinct applicant id is safe, never a cross-account resolution.
    const otherLinked = linkedMissions.filter((m) => m.id !== mission.id);
    const linkedApplicantNames = new Map<string, string>();
    for (const m of otherLinked) {
      if (linkedApplicantNames.has(m.applicantId)) continue;
      const linkedApplicant = await getApplicant(db, m.applicantId);
      linkedApplicantNames.set(m.applicantId, linkedApplicant?.displayName ?? 'Applicant');
    }
    // The case's visible code (ADR 0018); none while migration 0091 has not run.
    const referenceCode = await referenceCodeFor(db, 'C', mission.id);
    return {
      referenceCode,
      mission,
      applicantName: applicant?.displayName ?? 'Applicant',
      applicantId: mission.applicantId,
      liveAcknowledgedAt: liveAcknowledgement?.createdAt.toISOString() ?? null,
      isDirty,
      changesSinceConfirmed,
      evidenceOptions: [...evidenceOptionsById.entries()].map(([documentId, displayName]) => ({
        documentId,
        displayName,
      })),
      outcomes: outcomes.ok
        ? outcomes.value.map((o) => ({
            id: o.id,
            decision: o.decision,
            decisionDate: o.decisionDate.toISOString(),
            officialWording: o.officialWording,
            agencyInterpretation: o.agencyInterpretation,
            createdAt: o.createdAt.toISOString(),
          }))
        : [],
      submissions: submissions.ok
        ? submissions.value.map((s) => ({
            id: s.id,
            channel: s.channel,
            externalReportDescription: s.externalReportDescription,
            externalReference: s.externalReference,
            submittedAt: s.submittedAt.toISOString(),
          }))
        : [],
      complaints: complaintList.map((c) => {
        const events = complaintEventsById.get(c.id);
        return {
          id: c.id,
          description: c.description,
          status: c.status,
          resolution: c.resolution,
          createdAt: c.createdAt.toISOString(),
          events: (events?.ok ? events.value : []).map((e) => ({
            id: e.id,
            fromStatus: e.fromStatus,
            toStatus: e.toStatus,
            note: e.note,
            createdAt: e.createdAt.toISOString(),
          })),
        };
      }),
      feedback: feedback.ok
        ? feedback.value.map((f) => ({
            id: f.id,
            comments: f.comments,
            createdAt: f.createdAt.toISOString(),
          }))
        : [],
      canSubmitFeedback: mission.state === 'CLOSED' || mission.state === 'CANCELLED',
      readiness: readinessValue,
      requirementDetails,
      requiredHardGapCount,
      requiredUnverifiedCount,
      explanationConfigured,
      explanationsByRequirement,
      packInfo: pack
        ? {
            name: pack.name,
            authoritative: pack.authoritative,
            route: pack.route,
            jurisdiction: pack.jurisdiction,
            effectiveDate: packVersionRow?.effectiveDate
              ? packVersionRow.effectiveDate.toISOString()
              : null,
          }
        : null,
      snapshots: snapshots.ok ? snapshots.value : [],
      tasks: tasks.ok
        ? tasks.value.map((t) => ({
            id: t.id,
            description: t.description,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
            dueTimezone: t.dueTimezone,
          }))
        : [],
      appointments: appointments.ok
        ? appointments.value.map((a) => ({
            id: a.id,
            title: a.title,
            localDateTime: a.localDateTime.toISOString(),
            timezone: a.timezone,
            place: a.place,
            channel: a.channel,
            status: a.status,
          }))
        : [],
      letters: letters.ok ? letters.value : [],
      candidates: candidates.ok ? candidates.value : [],
      selectionIdsByCandidate,
      linkedMissions: otherLinked.map((m) => ({
        id: m.id,
        title: m.title,
        applicantName: linkedApplicantNames.get(m.applicantId) ?? 'Applicant',
      })),
      packOptions: packs.map(
        (p): PackOption => ({
          packVersionId: p.packVersionId,
          label: `${p.packName} · v${p.version} · ${p.requirementCount} requirement${p.requirementCount === 1 ? '' : 's'}`,
        }),
      ),
      selfReviewed,
      contributorRequests: contributorRequests.ok
        ? contributorRequests.value.map((r) => ({
            id: r.id,
            contributorEmail: r.contributorEmail,
            docType: r.docType,
            purpose: r.purpose,
            status: r.status,
            expiresAt: r.expiresAt.toISOString(),
          }))
        : [],
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        authorEmail: n.authorEmail,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  if (!data) notFound();

  const { mission } = data;
  const nextStates = legalTransitions(mission.state);

  const openTasks = data.tasks.filter(
    (task) => task.status === 'OPEN' || task.status === 'IN_PROGRESS',
  ).length;
  const attention: {
    readonly kind: AttentionKind;
    readonly label: string;
    readonly href: string;
    readonly count: number;
    readonly tone: 'warning' | 'danger';
  }[] = [
    ...(data.isDirty
      ? [
          {
            kind: 'changed' as const,
            label: 'Changed Since Confirmed',
            href: '#snapshots',
            count: 1,
            tone: 'danger' as const,
          },
        ]
      : []),
    ...(data.readiness && data.requiredHardGapCount > 0
      ? [
          {
            kind: 'missing' as const,
            label:
              data.requiredHardGapCount === 1 ? 'required item missing' : 'required items missing',
            href: '#readiness',
            count: data.requiredHardGapCount,
            tone: 'danger' as const,
          },
        ]
      : []),
    ...(data.readiness && data.requiredUnverifiedCount > 0
      ? [
          {
            kind: 'unconfirmed' as const,
            label: 'need a check',
            href: '#readiness',
            count: data.requiredUnverifiedCount,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(openTasks > 0
      ? [
          {
            kind: 'tasks' as const,
            label: openTasks === 1 ? 'open task' : 'open tasks',
            href: '#work',
            count: openTasks,
            tone: 'warning' as const,
          },
        ]
      : []),
  ];
  // WP-X1: the first item of the existing attention list, in its existing
  // order, is the next step. A changed case shows its alert instead (that is
  // its next step); an empty list keeps the existing success badge and no card.
  const nextStep = data.isDirty ? undefined : attention[0];

  return (
    <section className="section container">
      <PageHeader
        back={{
          href: `/app/applicant/${data.applicantId}/missions`,
          label: `${data.applicantName} · Cases`,
        }}
        eyebrow="Case"
        title={mission.title}
        meta={
          <>
            <span>
              {mission.destination ? `${mission.destination} · ` : ''}
              {STATE_LABELS[mission.state] ?? mission.state}
            </span>
            <ReferenceCode code={data.referenceCode} label="Case Reference" />
            {data.liveAcknowledgedAt ? (
              <StatusBadge tone="success">
                Confirmed by the applicant on {formatTimestampDate(data.liveAcknowledgedAt)}
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Applicant has not confirmed yet</StatusBadge>
            )}
          </>
        }
        actions={
          <>
            <a className="btn btn-secondary" href="#evidence">
              Add Evidence
            </a>
            <SnapshotButton missionId={mission.id} />
          </>
        }
      />

      <CaseStageTracker state={mission.state} labels={STATE_LABELS} nextStates={nextStates} />

      {data.isDirty ? (
        <div className="case-alert">
          <p className="case-alert-title">This case has changed since it was last acknowledged.</p>
          <p className="case-alert-body">
            A material edit invalidated the previous sign-off. Capture a new snapshot and
            acknowledge it again before relying on this case as submission-ready.
          </p>
          {/* WP-V3 part 3: the list of changed details. */}
          <ChangesSinceConfirmedList
            applicantId={data.applicantId}
            changes={data.changesSinceConfirmed}
          />
          <SnapshotButton
            missionId={mission.id}
            label="Take a New Snapshot"
            primary
            align="start"
          />
        </div>
      ) : null}

      {nextStep && nextStep.kind !== 'changed' ? (
        <section className="case-next-step" aria-labelledby="case-next-step-heading">
          <h2 className="case-next-step-kicker" id="case-next-step-heading">
            Next Step
          </h2>
          <p className="case-next-step-title">
            {NEXT_STEP_COPY[nextStep.kind].title(nextStep.count)}
          </p>
          <p className="case-next-step-body">{NEXT_STEP_COPY[nextStep.kind].body}</p>
          <a className="btn btn-primary" href={nextStep.href}>
            {NEXT_STEP_COPY[nextStep.kind].action}
          </a>
        </section>
      ) : null}
      {/* Owner-approved wording, 25 Oct 2026. */}
      <p className="case-journey-reminder">
        Preparing a file is not the same as submitting it. VisaStack does not submit applications or
        predict decisions.
      </p>
      {/* WP-V4 places the request triage summary directly under the next step. */}

      <div className="case-context-strip">
        {mission.manualMode ? (
          <details className="case-manual-notice">
            <summary>Manual assessment: this route has no automated requirement pack</summary>
            <p>
              You are responsible for confirming what this case needs. Completeness is not an
              official readiness assessment, on this page or in an exported snapshot.
            </p>
          </details>
        ) : null}

        <ul className="case-attention" aria-label="What needs attention on this case">
          {attention.length === 0 ? (
            <li>
              <span className="case-attention-ok">
                <StatusBadge tone="success">Nothing needs attention right now</StatusBadge>
              </span>
            </li>
          ) : (
            attention.map((item) => (
              <li key={item.label}>
                <a href={item.href}>
                  <StatusBadge tone={item.tone}>{item.count}</StatusBadge>
                  {item.label}
                </a>
              </li>
            ))
          )}
        </ul>
      </div>

      <nav className="jump-nav" aria-label="Sections of this case">
        <a href="#readiness">Readiness</a>
        <a href="#evidence">Evidence</a>
        <a href="#work">Tasks and Letters</a>
        <a href="#snapshots">Snapshots</a>
        <a href="#notes">Contributors and Notes</a>
        <a href="#outcome">Submission and Outcome</a>
      </nav>

      <div className="split">
        <div className="split-main">
          <article className="card case-evidence-overview" id="readiness">
            {data.selfReviewed ? (
              <p
                className="muted"
                style={{ fontSize: 'var(--text-small)', marginBottom: '0.75rem' }}
              >
                <span className="badge badge-neutral">Self-reviewed</span> No agency currently has
                access to this case, so you are the only one assessing it.
              </p>
            ) : null}
            {data.readiness ? (
              <>
                <CasePreparationSummary
                  readiness={data.readiness}
                  acknowledged={Boolean(data.liveAcknowledgedAt) && !data.isDirty}
                />
                <p className={`badge ${OVERALL_STATE_META[data.readiness.overallState].tone}`}>
                  {OVERALL_STATE_META[data.readiness.overallState].label}
                </p>
                {data.readiness.overallState !== 'MANUAL_ONLY' ? (
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', marginBottom: '1rem' }}
                  >
                    {data.readiness.overallState === 'READY_FOR_APPLICANT_REVIEW'
                      ? t('mission.readiness.ready')
                      : data.readiness.overallState === 'NEEDS_REVIEW'
                        ? t('mission.readiness.needsReview', {
                            count: data.requiredUnverifiedCount,
                          })
                        : t('mission.readiness.missing', { count: data.requiredHardGapCount })}
                  </p>
                ) : null}
                {data.requirementDetails.length > 0 ? (
                  <>
                    <h3 className="case-checklist-heading">Evidence Checklist</h3>
                    {REQUIREMENT_GROUPS.map((group) => {
                      const groupRows = data.requirementDetails.filter((r) =>
                        group.states.includes(r.state),
                      );
                      if (groupRows.length === 0) return null;
                      return (
                        <Fragment key={group.heading}>
                          <h4 className="case-group-heading">
                            {group.heading} <span className="muted">{groupRows.length}</span>
                          </h4>
                          <div className="rows">
                            {groupRows.map((r) => {
                              const meta = REQUIREMENT_STATE_META[r.state];
                              const label =
                                r.kind === 'FIELD'
                                  ? (fieldLabel(r.key) ?? humanizeCode(r.key))
                                  : humanizeCode(r.key);
                              const sourceLine = [r.publisher, r.sourceTitle]
                                .filter(Boolean)
                                .join(' · ');
                              const sourceHref = safeHttpUrl(r.sourceUrl);
                              return (
                                <div
                                  className="row"
                                  key={r.packRequirementId}
                                  style={{
                                    flexDirection: 'column',
                                    alignItems: 'stretch',
                                    gap: '0.3rem',
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      gap: '0.75rem',
                                    }}
                                  >
                                    <span className="row-key">
                                      {label || '(unnamed)'}
                                      {r.optional ? ' · optional' : ''}
                                    </span>
                                    <span className={`badge ${meta.tone}`}>{meta.label}</span>
                                  </div>
                                  {meta.next ? (
                                    <span className="muted u-fs-085">
                                      {meta.next}
                                      {r.state === 'CONFLICTING' ? (
                                        <>
                                          {' '}
                                          <Link href={`/app/applicant/${data.applicantId}/profile`}>
                                            Resolve on Profile →
                                          </Link>
                                        </>
                                      ) : null}
                                      {r.state === 'CRITICAL_GAP' ||
                                      r.state === 'EXPIRING_STALE' ? (
                                        <>
                                          {' '}
                                          <a href="#evidence">Provide Evidence ↓</a>
                                        </>
                                      ) : null}
                                    </span>
                                  ) : null}
                                  {r.citation ? (
                                    <span className="muted u-fs-075">
                                      Cite: {sourceLine || r.citation}
                                      {r.observedDate
                                        ? ` · as of ${formatDateOnly(r.observedDate)}`
                                        : ''}
                                      {sourceHref ? (
                                        <>
                                          {' · '}
                                          <a href={sourceHref} target="_blank" rel="noreferrer">
                                            source
                                          </a>
                                        </>
                                      ) : null}
                                    </span>
                                  ) : null}
                                  {r.sourceInaccessible ? (
                                    <span
                                      className="badge badge-danger"
                                      style={{ alignSelf: 'flex-start' }}
                                    >
                                      Source Currently Unreachable - Under Review
                                    </span>
                                  ) : null}
                                  {data.explanationConfigured &&
                                  (r.state === 'CRITICAL_GAP' || r.state === 'ATTENTION') ? (
                                    <ExplainGapButton
                                      missionId={data.mission.id}
                                      packRequirementId={r.packRequirementId}
                                      explanation={
                                        data.explanationsByRequirement.get(r.packRequirementId)
                                          ?.explanation ?? null
                                      }
                                    />
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </Fragment>
                      );
                    })}
                  </>
                ) : null}
                <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '1rem' }}>
                  Readiness is completeness only - never an approval likelihood.
                </p>
              </>
            ) : (
              <p className="card-body">Attach a requirement pack to see readiness.</p>
            )}
          </article>

          <Disclosure title="Select or Update Evidence" hint="Open when you need to make a change">
            <div className="grid u-mt-150" id="evidence">
              <EvidenceSelectionPanel
                missionId={mission.id}
                candidates={data.candidates.map((c) => ({
                  packRequirementId: c.packRequirementId,
                  kind: c.kind,
                  label:
                    c.kind === 'FIELD'
                      ? (fieldLabel(c.key) ?? humanizeCode(c.key))
                      : humanizeCode(c.key),
                  citation: c.citation,
                  factCandidates: c.factCandidates.map((f) => ({
                    factId: f.factId,
                    value: f.value,
                    repeatingRecordKey: f.repeatingRecordKey,
                    eligible: isFactStatusEligible(f.status),
                  })),
                  documentCandidates: c.documentCandidates.map((d) => ({
                    documentId: d.documentId,
                    displayName: d.displayName,
                    eligible: d.eligible,
                    staleness: d.staleness.status,
                  })),
                  selectedFactIds: c.selectedFactIds,
                  selectedDocumentIds: c.selectedDocumentIds,
                  selectionIdsByCandidate: data.selectionIdsByCandidate,
                }))}
              />
            </div>
          </Disclosure>

          <Disclosure
            title="Tasks, Appointments and Letters"
            hint="Open when you need to make a change"
          >
            <div className="grid u-mt-150" id="work">
              <TasksPanel missionId={mission.id} tasks={data.tasks} />
              <AppointmentsPanel missionId={mission.id} appointments={data.appointments} />
              <LettersPanel
                missionId={mission.id}
                letters={data.letters.map((l) => ({
                  id: l.id,
                  version: l.version,
                  content: l.content,
                  createdAt: l.createdAt.toISOString(),
                }))}
                canGenerate={data.candidates.some(
                  (c) =>
                    c.factCandidates.some((f) => isFactStatusEligible(f.status)) ||
                    c.documentCandidates.some((d) => d.eligible),
                )}
              />
            </div>
          </Disclosure>

          <div id="notes">
            <Disclosure
              title="Contributors and Notes from Your Agency"
              hint="Ask a sponsor for one document, read shared notes"
            >
              <div className="grid">
                <article className="card">
                  <p className="card-kicker">Delegate</p>
                  <h2 className="card-title">Ask a Contributor</h2>
                  <p className="card-body u-mb-125">
                    Ask a sponsor or family member - who never gets a wallet, profile, or case view
                    of any kind - for exactly one named document. They see only what you type below
                    before deciding whether to upload.
                  </p>
                  <ContributorRequestsPanel
                    missionId={mission.id}
                    requests={data.contributorRequests}
                  />
                </article>

                <article className="card">
                  <p className="card-kicker">Collaboration</p>
                  <h2 className="card-title">Notes from Your Agency</h2>
                  <p className="card-body u-mb-125">
                    Notes an agency working this case has chosen to share with you. An agency's own
                    internal notes are never shown here.
                  </p>
                  {data.notes.length === 0 ? (
                    <p className="muted u-fs-085">No notes shared with you yet.</p>
                  ) : (
                    <div className="rows">
                      {data.notes.map((n) => (
                        <div
                          className="row"
                          key={n.id}
                          style={{ flexDirection: 'column', alignItems: 'flex-start' }}
                        >
                          <span className="u-fs-085">{n.body}</span>
                          <span
                            className="muted"
                            style={{ fontSize: 'var(--text-caption)', marginTop: '0.2rem' }}
                          >
                            {n.authorEmail ?? 'Unknown'}, {formatTimestampDate(n.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            </Disclosure>
          </div>

          <Disclosure title="Submission and Outcome" hint="Open when you need to make a change">
            <div className="grid u-mt-150" id="outcome">
              <SubmissionReportPanel
                missionId={mission.id}
                submissions={data.submissions}
                eligible={mission.state === 'SUBMISSION_READY'}
              />
              <OutcomePanel
                missionId={mission.id}
                outcomes={data.outcomes}
                evidenceOptions={data.evidenceOptions}
              />
            </div>
          </Disclosure>

          <div className="u-mt-150">
            <Disclosure
              title="Problems and Feedback"
              hint="Raise a complaint or give feedback on this case"
            >
              <div className="grid">
                <ComplaintPanel missionId={mission.id} complaints={data.complaints} />
                <FeedbackPanel
                  missionId={mission.id}
                  feedback={data.feedback}
                  canSubmit={data.canSubmitFeedback}
                />
              </div>
            </Disclosure>
          </div>
        </div>
        <aside className="split-rail" aria-label="About this case">
          <article className="card">
            <p className="card-kicker">Case</p>
            <h2 className="card-title">Case Details</h2>
            <p className="card-body">
              {mission.jurisdiction || 'Jurisdiction not set'}
              {mission.serviceCategory ? ` · ${mission.serviceCategory}` : ''}
            </p>
            <p className="muted">
              {mission.travelStartDate
                ? formatDateOnly(mission.travelStartDate)
                : 'Travel dates not set'}
              {mission.travelEndDate ? ` to ${formatDateOnly(mission.travelEndDate)}` : ''}
            </p>
            <details className="case-details-edit">
              <summary>Edit Case Details</summary>
              <CaseDetailsForm
                missionId={mission.id}
                jurisdiction={mission.jurisdiction}
                serviceCategory={mission.serviceCategory}
                travelStartDate={mission.travelStartDate}
                travelEndDate={mission.travelEndDate}
                targetDeadline={mission.targetDeadline}
                manualMode={mission.manualMode}
              />
            </details>
          </article>
          <article className="card">
            <p className="card-kicker">Requirements</p>
            <h2 className="card-title">Requirement Pack</h2>
            {mission.packVersionId && data.packInfo ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span className="card-body u-m-0">{data.packInfo.name}</span>
                  <span
                    className={`badge ${data.packInfo.authoritative ? 'badge-success' : 'badge-neutral'}`}
                  >
                    {data.packInfo.authoritative
                      ? 'Official Requirement Pack'
                      : 'Agency Custom Checklist'}
                  </span>
                </div>
                {data.packInfo.jurisdiction || data.packInfo.route ? (
                  <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
                    {[data.packInfo.jurisdiction, data.packInfo.route].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
                {data.packInfo.effectiveDate ? (
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', margin: '0.35rem 0 0' }}
                  >
                    In effect since {formatDateOnly(data.packInfo.effectiveDate)}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="card-body u-mb-100">
                  Attach a published requirement pack to compute readiness.
                </p>
                <AttachPackForm missionId={mission.id} options={data.packOptions} />
              </>
            )}
          </article>
          <article className="card">
            <p className="card-kicker">Workflow</p>
            <h2 className="card-title">Advance the Case</h2>
            {nextStates.length === 0 ? (
              <p className="card-body">This case is in a terminal state.</p>
            ) : (
              <div className="u-mt-050">
                <TransitionButtons missionId={mission.id} nextStates={nextStates} />
              </div>
            )}
          </article>
          <article className="card" id="snapshots">
            <p className="card-kicker">History</p>
            <h2 className="card-title">Snapshots</h2>
            <p className="card-body case-memory-link">
              Each snapshot keeps exactly what it held.{' '}
              <Link href={memoryHref(data.applicantId)}>Open Application Memory</Link> to see every
              case for this person and compare what you confirmed with today.
            </p>
            {data.snapshots.length === 0 ? (
              <p className="card-body">
                No snapshots yet. Capture one to freeze this case's evidence and checksum.
              </p>
            ) : (
              <div className="rows u-mt-050">
                {data.snapshots.map((snap) => {
                  const content = snap.content as { state?: string } | null;
                  const isPacket = content?.state ? PACKET_STATES.has(content.state) : false;
                  return (
                    <Link
                      href={`/app/mission/${mission.id}/snapshots/${snap.id}`}
                      className="row"
                      key={snap.id}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <span className="row-key">
                        Version {snap.version}
                        {isPacket ? (
                          <span className="badge badge-success" style={{ marginLeft: '0.5rem' }}>
                            Application Packet
                          </span>
                        ) : null}
                      </span>
                      <span className="row-val u-fs-075" title={snap.checksum}>
                        {snap.checksum.slice(0, 12)}…
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </article>
          <article className="card">
            <p className="card-kicker">Family Trip</p>
            <h2 className="card-title">Itinerary Reference</h2>
            <p className="card-body u-mb-100">
              An optional label linking this case to another family member's, purely for display.
              Access and permissions stay entirely separate per case.
            </p>
            <ItineraryForm missionId={mission.id} itineraryRef={mission.itineraryRef} />
            {data.linkedMissions.length > 0 ? (
              <div className="rows u-mt-100">
                {data.linkedMissions.map((m) => (
                  <Link className="row row-link" key={m.id} href={`/app/mission/${m.id}`}>
                    <span className="row-key">{m.applicantName}</span>
                    <span className="muted">{m.title}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </article>
        </aside>
      </div>
    </section>
  );
}
