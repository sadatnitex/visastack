import { tripChecksApply, tripChecksNeedingAction } from '@visastack/core';
import { aiAppLabel } from '@visastack/core/ai-features';
import { createTranslator } from '@visastack/i18n';
import {
  type ChangesSinceConfirmed,
  type Db,
  type OverallReadinessState,
  type RequirementResultState,
  accountPrincipal,
  computeReadiness,
  computeTripChecks,
  getAiFeatureState,
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
import {
  CasePreparationSummary,
  CaseStageTracker,
} from '../../../../components/case-preparation-summary';
import { CaseReadinessRing } from '../../../../components/case-readiness-ring';
import { CollapsibleGroups } from '../../../../components/collapsible-group';
import { DepthScope, atLevel } from '../../../../components/depth';
import { DepthSwitch } from '../../../../components/depth-switch';
import { ReferenceCode } from '../../../../components/reference-code';
import { type RowNoun, ShowMore } from '../../../../components/show-more';
import { StickyActionBar } from '../../../../components/sticky-action-bar';
import { Disclosure, PageHeader, StatusBadge } from '../../../../components/ui';
import { isExplanationConfigured } from '../../../../lib/ai';
import { memoryHref } from '../../../../lib/application-memory-labels';
import { bookingReminderFor } from '../../../../lib/booking-reminder';
import { checklistsToPick } from '../../../../lib/case-checklist-match';
import { savedCaseMatchTerms } from '../../../../lib/case-choices';
import { CASE_STATE_LABELS, caseStateLabel, stageButtonStates } from '../../../../lib/case-stages';
import { depthCopyFor } from '../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../lib/ccd/depth.server';
import { humanizeCode } from '../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
import { getLocale } from '../../../../lib/locale';
import { fieldLabel } from '../../../../lib/master-profile';
import {
  type SearchParamsRecord,
  TRAVELLER_LIST_STEP,
  firstParam,
  nextShow,
  parseShow,
} from '../../../../lib/paging';
import { REQUIREMENT_GROUPS } from '../../../../lib/requirement-groups';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';
import { AttachPackForm, type PackOption } from './attach-pack-form';
import { CaseMoreMenu } from './case-more-menu';
import { CaseWelcome } from './case-welcome';
import { type WelcomeChecklists, caseWelcomeCopy } from './case-welcome-copy';
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
import { OpenGroupOnLink } from './open-group-on-link';
import { OutcomePanel } from './outcome-panel';
import { ExplainGapButton } from './readiness-gap-explain';
import { isPacketSnapshot } from './snapshot-packet';
import { SubmissionReportPanel } from './submission-report-panel';
import { TripChecksPanel } from './trip-checks-panel';

export const metadata: Metadata = { title: 'Case' };

export const dynamic = 'force-dynamic';

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

type AttentionKind = 'changed' | 'missing' | 'unconfirmed' | 'trip' | 'tasks';

/** How many snapshots the case page lists; the rest are one link away (WP-SB2). */
const SNAPSHOTS_ON_PAGE = 5;

/** Rows a checklist group shows before the rest fold under Show All (WP-SB2). */
const CHECKLIST_ROWS_SHOWN = 3;

/**
 * The case page's capped lists (WP-SB2): each shows 10 rows, then Show More asks the server for
 * 10 more through its own address parameter, so opening one list never resets another.
 */
const CAPPED_LISTS = {
  tasks: { noun: { one: 'task', other: 'tasks' }, rowId: 'case-task' },
  notes: { noun: { one: 'note', other: 'notes' }, rowId: 'case-note' },
  outcomes: { noun: { one: 'outcome', other: 'outcomes' }, rowId: 'case-outcome' },
  complaints: { noun: { one: 'complaint', other: 'complaints' }, rowId: 'case-complaint' },
  feedback: { noun: { one: 'feedback note', other: 'feedback notes' }, rowId: 'case-feedback' },
} as const satisfies Record<string, { readonly noun: RowNoun; readonly rowId: string }>;

type CappedList = keyof typeof CAPPED_LISTS;

const LIST_STEP = { step: TRAVELLER_LIST_STEP } as const;

/** The checklist groups' ids are `<prefix>-<heading in lower case with hyphens>`. */
const CHECKLIST_ID_PREFIX = 'case-checklist';

/** How long after it is made a case still opens with its welcome note. */
const WELCOME_WINDOW_MS = 60 * 60 * 1000;

/** Whether a case was made recently enough to open with its welcome note. */
function madeJustNow(createdAt: Date | string): boolean {
  return Date.now() - new Date(createdAt).getTime() < WELCOME_WINDOW_MS;
}

/**
 * For the welcome note of a case with no checklist: whether published checklists fit its country
 * and purpose and may cover its traveller. A case that names no country or no purpose has no route
 * to narrow by, so it is offered the picker when any checklist is published. A failed check is
 * `unknown`, never a guess.
 */
async function welcomeChecklists(
  db: Db,
  accountId: string,
  mission: {
    readonly id: string;
    readonly destination: string | null;
    readonly purpose: string | null;
  },
  publishedCount: number,
): Promise<WelcomeChecklists> {
  const route = savedCaseMatchTerms(mission.destination, mission.purpose);
  if (!route) {
    return publishedCount > 0 ? { kind: 'pick', travellerUnconfirmed: false } : { kind: 'none' };
  }
  try {
    const fitting = await checklistsToPick(db, { accountId, missionId: mission.id, ...route });
    if (fitting.length === 0) return { kind: 'none' };
    return {
      kind: 'pick',
      travellerUnconfirmed: fitting.some((checklist) => !checklist.coversTraveller),
    };
  } catch (error) {
    reportServerError('MissionPage', error, { step: 'welcome checklists' });
    return { kind: 'unknown' };
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// WP-X1 next step card: wording for the first attention item. A changed case
// is shown by its own alert instead, so it has no card wording.
// CCD section 6: it speaks of this case by its name, and names the first item to fix.
const NEXT_STEP_COPY: Record<
  Exclude<AttentionKind, 'changed'>,
  {
    readonly title: (count: number, caseTitle: string) => string;
    readonly body: (firstItem: string | null) => string;
    readonly action: string;
  }
> = {
  // Counts missing, out-of-date and mismatched required items together.
  missing: {
    title: (count, caseTitle) =>
      `Fix ${plural(count, 'required item', 'required items')} for ${caseTitle}`,
    body: (firstItem) =>
      `${firstItem ? `First to fix: ${firstItem}. ` : ''}Some required items are missing, out of date or do not match.`,
    action: 'See What Needs Fixing',
  },
  unconfirmed: {
    title: (count, caseTitle) => `Confirm ${plural(count, 'item', 'items')} for ${caseTitle}`,
    body: () => 'Whether these apply depends on case details that are not confirmed yet.',
    action: 'See What to Confirm',
  },
  trip: {
    title: (count, caseTitle) => `Check ${plural(count, 'date', 'dates')} for ${caseTitle}`,
    body: () =>
      'Open Trip Date Checks to see which dates do not line up with your passport, insurance or plans.',
    action: 'See Trip Date Checks',
  },
  tasks: {
    title: (count, caseTitle) =>
      `Finish ${plural(count, 'open task', 'open tasks')} for ${caseTitle}`,
    body: () => 'Your open tasks are listed under Tasks, appointments and letters.',
    action: 'Open Tasks',
  },
};

/** A checklist item's name, as the checklist shows it. */
const requirementLabel = (r: { readonly kind: 'FIELD' | 'DOCUMENT'; readonly key: string }) =>
  r.kind === 'FIELD' ? (fieldLabel(r.key) ?? humanizeCode(r.key)) : humanizeCode(r.key);

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
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const { id } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};
  // Named apart from the lists read below, which use the same words.
  const {
    welcome,
    tasks: tasksShow,
    notes: notesShow,
    outcomes: outcomesShow,
    complaints: complaintsShow,
    feedback: feedbackShow,
  } = query;
  // Start a Case and Start a New Case from This One both arrive with `welcome=1`.
  const welcomeAsked = firstParam(welcome) === '1';
  // How many rows each capped list shows: 10 by default, more after Show More (WP-SB2).
  const shown: Record<CappedList, number> = {
    tasks: parseShow(tasksShow, LIST_STEP),
    notes: parseShow(notesShow, LIST_STEP),
    outcomes: parseShow(outcomesShow, LIST_STEP),
    complaints: parseShow(complaintsShow, LIST_STEP),
    feedback: parseShow(feedbackShow, LIST_STEP),
  };

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
      tripChecks,
    ] = await Promise.all([
      mission.packVersionId ? computeReadiness(db, mission.id) : Promise.resolve(null),
      mission.packVersionId ? listRequirements(db, mission.packVersionId) : Promise.resolve([]),
      mission.packVersionId
        ? getPackVersion(db, mission.packVersionId)
        : Promise.resolve(undefined),
      listMissionSnapshots(db, accountId, mission.id, { limit: SNAPSHOTS_ON_PAGE }),
      listPublishedPackVersions(db),
      listTasks(db, accountId, mission.id, { limit: shown.tasks }),
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
      listNotesForOwner(db, accountId, mission.id, { limit: shown.notes }),
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
      listComplaintsForMission(db, accountId, mission.id, { limit: shown.complaints }),
      listFeedbackForMission(db, accountId, mission.id, { limit: shown.feedback }),
      isExplanationConfigured(db),
      // The date checks read the traveller's profile, so they run through the access gate for the
      // owner of this case. A refusal or an error shows a plain message, never a made-up result.
      // A case with no travel date, or one already handed in, needs no gate call at all.
      tripChecksApply(mission.state) && (mission.travelStartDate || mission.travelEndDate)
        ? requireAccess(
            db,
            accountPrincipal(accountId),
            'VIEW_METADATA',
            { missionId: mission.id },
            { purpose: 'self' },
          )
            .then((gate) => (gate.ok ? computeTripChecks(gate.value) : null))
            .catch(() => null)
        : Promise.resolve([]),
    ]);
    const complaintList = complaints.ok ? complaints.value.items : [];
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
    // Gap Explanations' own switch (S28), read only when the button could show. Off, a short
    // hint takes the button's place and any explanation already given stays.
    const explanationGate =
      explanationConfigured && explanationEntries.length > 0
        ? await requireAccess(
            db,
            accountPrincipal(accountId),
            'VIEW_METADATA',
            { missionId: mission.id },
            { purpose: 'self' },
          )
        : null;
    const explanationFeature = explanationGate?.ok
      ? await getAiFeatureState(db, 'ai_explanations', { proof: explanationGate.value })
      : null;
    const requiredHardGaps = requirementDetails.filter(
      (r) =>
        !r.optional &&
        (r.state === 'CRITICAL_GAP' || r.state === 'CONFLICTING' || r.state === 'EXPIRING_STALE'),
    );
    const requiredHardGapCount = requiredHardGaps.length;
    // The first in checklist order: the Next Step names it.
    const firstHardGap = requiredHardGaps[0];
    const firstHardGapLabel = firstHardGap ? requirementLabel(firstHardGap) : null;
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
      linkedApplicantNames.set(m.applicantId, linkedApplicant?.displayName ?? 'Traveller');
    }
    // The case's visible code (ADR 0018); none while migration 0091 has not run.
    const referenceCode = await referenceCodeFor(db, 'C', mission.id);
    // The welcome note greets a case that was just made; an old case opened with the same address
    // shows none. `checklists` is null when the case already has one linked.
    const welcomeNote =
      welcomeAsked && madeJustNow(mission.createdAt)
        ? {
            checklists: mission.packVersionId
              ? null
              : await welcomeChecklists(db, accountId, mission, packs.length),
          }
        : null;
    return {
      referenceCode,
      welcomeNote,
      mission,
      applicantName: applicant?.displayName ?? 'Traveller',
      applicantId: mission.applicantId,
      liveAcknowledgedAt: liveAcknowledgement?.createdAt.toISOString() ?? null,
      isDirty,
      changesSinceConfirmed,
      evidenceOptions: [...evidenceOptionsById.entries()].map(([documentId, displayName]) => ({
        documentId,
        displayName,
      })),
      // The outcome read has no server cap of its own yet (outside this package), so the page
      // shows the newest rows only; a case holds a handful of outcomes in practice.
      outcomeTotal: outcomes.ok ? outcomes.value.length : 0,
      outcomes: outcomes.ok
        ? outcomes.value.slice(0, shown.outcomes).map((o) => ({
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
      complaintTotal: complaints.ok ? complaints.value.total : 0,
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
      feedbackTotal: feedback.ok ? feedback.value.total : 0,
      feedback: feedback.ok
        ? feedback.value.items.map((f) => ({
            id: f.id,
            comments: f.comments,
            createdAt: f.createdAt.toISOString(),
          }))
        : [],
      canSubmitFeedback: mission.state === 'CLOSED' || mission.state === 'CANCELLED',
      readiness: readinessValue,
      requirementDetails,
      requiredHardGapCount,
      firstHardGapLabel,
      requiredUnverifiedCount,
      explanationConfigured,
      tripChecks,
      explanationFeature,
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
      snapshots: snapshots.ok ? snapshots.value.items : [],
      moreSnapshots: snapshots.ok && snapshots.value.nextCursor !== null,
      taskTotal: tasks.ok ? tasks.value.total : 0,
      openTaskCount: tasks.ok ? tasks.value.open : 0,
      tasks: tasks.ok
        ? tasks.value.items.map((t) => ({
            id: t.id,
            description: t.description,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
            dueTimezone: t.dueTimezone,
            // A reminder the person's own AI app added (S21), named by the app, cleaned here.
            // Name and web address, so an app calling itself "VisaStack" cannot pass as us.
            addedBy: t.addedBy
              ? aiAppLabel({ name: t.addedBy.appName, host: t.addedBy.appHost })
              : null,
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
        applicantName: linkedApplicantNames.get(m.applicantId) ?? 'Traveller',
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
      noteTotal: notes.total,
      notes: notes.items.map((n) => ({
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
  // Cancelling is final, so it is offered only from the More menu, behind a question.
  const stageStates = stageButtonStates(nextStates);
  const canCancel = nextStates.includes('CANCELLED');

  // Counted on the server across the whole case, not from the rows on the page.
  const openTasks = data.openTaskCount;
  const showTripChecks =
    tripChecksApply(mission.state) && Boolean(mission.travelStartDate || mission.travelEndDate);
  const tripChecksToAct = tripChecksNeedingAction(data.tripChecks ?? []);
  const hasChecklist = Boolean(data.readiness) && data.requirementDetails.length > 0;
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
            // Its own group of the checklist, which opens when the link is followed (WP-SB2).
            href: hasChecklist ? `#${CHECKLIST_ID_PREFIX}-needs-a-check` : '#readiness',
            count: data.requiredUnverifiedCount,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(tripChecksToAct > 0
      ? [
          {
            kind: 'trip' as const,
            label: tripChecksToAct === 1 ? 'date to check' : 'dates to check',
            href: '#trip-checks',
            count: tripChecksToAct,
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
  const depth = await readDepth('case');
  // The next step card shows only when nothing changed since the last confirmation.
  const showNextStep = nextStep !== undefined && nextStep.kind !== 'changed';
  // The one primary button on the page belongs to the next step or the changed-case alert; the
  // welcome note and the checklist picker offer theirs only when neither is there.
  const hasNextStepOrAlert = data.isDirty || showNextStep;
  /** One checklist row (WP-SB2 moved it out of the group so a group can show its first rows). */
  const requirementRow = (r: RequirementDetailRow) => {
    const meta = REQUIREMENT_STATE_META[r.state];
    const label = requirementLabel(r);
    const sourceLine = [r.publisher, r.sourceTitle].filter(Boolean).join(' · ');
    const sourceHref = safeHttpUrl(r.sourceUrl);
    const bookingReminder =
      r.state === 'CRITICAL_GAP' || r.state === 'ATTENTION'
        ? bookingReminderFor(r.kind, r.key)
        : null;
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
            {r.state === 'CRITICAL_GAP' || r.state === 'EXPIRING_STALE' ? (
              <>
                {' '}
                <a href="#evidence">Provide Evidence ↓</a>
              </>
            ) : null}
          </span>
        ) : null}
        {bookingReminder ? <span className="muted u-fs-085">{bookingReminder}</span> : null}
        {r.citation ? (
          <span className="muted u-fs-075">
            Cite: {sourceLine || r.citation}
            {r.observedDate ? ` · as of ${formatDateOnly(r.observedDate)}` : ''}
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
          <span className="badge badge-danger" style={{ alignSelf: 'flex-start' }}>
            Source Currently Unreachable - Under Review
          </span>
        ) : null}
        {data.explanationConfigured && (r.state === 'CRITICAL_GAP' || r.state === 'ATTENTION') ? (
          <ExplainGapButton
            missionId={data.mission.id}
            packRequirementId={r.packRequirementId}
            explanation={
              data.explanationsByRequirement.get(r.packRequirementId)?.explanation ?? null
            }
            {...(data.explanationFeature && !data.explanationFeature.available
              ? { off: data.explanationFeature.reason }
              : {})}
          />
        ) : null}
      </div>
    );
  };
  const pathname = `/app/mission/${mission.id}`;
  const newCaseHref = `/app/applicant/${data.applicantId}/missions/prepare-again?from=${mission.id}`;
  const totals: Record<CappedList, number> = {
    tasks: data.taskTotal,
    notes: data.noteTotal,
    outcomes: data.outcomeTotal,
    complaints: data.complaintTotal,
    feedback: data.feedbackTotal,
  };
  const rowsOnPage: Record<CappedList, number> = {
    tasks: data.tasks.length,
    notes: data.notes.length,
    outcomes: data.outcomes.length,
    complaints: data.complaints.length,
    feedback: data.feedback.length,
  };
  // Show More keeps every other list's place, but not the one-time welcome note.
  const { welcome: _welcome, ...listQuery } = query;
  // A section someone asked to see more of stays open when the page comes back.
  const expanded = (list: CappedList) => shown[list] > TRAVELLER_LIST_STEP;
  /** The Show More control under one capped list; nothing when the list is short. */
  const showMore = (list: CappedList) => {
    const total = totals[list];
    if (total <= TRAVELLER_LIST_STEP) return null;
    const onPage = rowsOnPage[list];
    const next = onPage < total ? nextShow(shown[list], LIST_STEP) : null;
    return (
      <ShowMore
        id={`case-${list}-more`}
        landOn={`${CAPPED_LISTS[list].rowId}-${onPage}`}
        pathname={pathname}
        searchParams={listQuery}
        next={next === null ? null : { [list]: next }}
        shown={onPage}
        total={total}
        noun={CAPPED_LISTS[list].noun}
      />
    );
  };
  const nextStepAction = showNextStep && nextStep ? NEXT_STEP_COPY[nextStep.kind] : null;

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
              {caseStateLabel(mission.state)}
            </span>
            <ReferenceCode code={data.referenceCode} label="Case Reference" />
            {data.liveAcknowledgedAt ? (
              <StatusBadge tone="success">
                Confirmed by the traveller on {formatTimestampDate(data.liveAcknowledgedAt)}
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Traveller has not confirmed yet</StatusBadge>
            )}
          </>
        }
        actions={
          <>
            {/* On a phone these three fold into More (WP-SB2), which repeats them there. */}
            <div className="case-header-wide">
              <a className="btn btn-secondary" href="#evidence">
                Add Evidence
              </a>
              <Link className="btn btn-secondary" href={newCaseHref}>
                Start a New Case from This One
              </Link>
              <SnapshotButton missionId={mission.id} />
            </div>
            <CaseMoreMenu
              missionId={mission.id}
              applicantId={data.applicantId}
              canCancel={canCancel}
              headerActions={{ addEvidenceHref: '#evidence', newCaseHref }}
            />
          </>
        }
      />

      <DepthScope family="case" depth={depth}>
        <DepthSwitch family="case" initial={depth} copy={depthCopyFor('case')} />

        {data.welcomeNote ? (
          <CaseWelcome
            {...caseWelcomeCopy({
              packName: mission.packVersionId ? (data.packInfo?.name ?? null) : null,
              // A linked checklist whose name could not be read promises nothing.
              checklists: data.welcomeNote.checklists ?? { kind: 'unknown' },
              firstGapHref:
                attention.find((item) => item.kind !== 'changed' && item.kind !== 'trip')?.href ??
                null,
            })}
            primary={!hasNextStepOrAlert}
          />
        ) : null}

        <div {...atLevel('browse')}>
          <CaseStageTracker
            state={mission.state}
            labels={CASE_STATE_LABELS}
            nextStates={stageStates}
            cancelInMore={canCancel}
          />
        </div>

        {data.isDirty ? (
          <div className="case-alert">
            <p className="case-alert-title">
              This case has changed since it was last acknowledged.
            </p>
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
            <p className="case-alert-body">
              <a href="#snapshots">Open Snapshots</a> to confirm the new one.
            </p>
          </div>
        ) : null}

        {showNextStep && nextStep ? (
          <section className="case-next-step" aria-labelledby="case-next-step-heading">
            <h2 className="case-next-step-kicker" id="case-next-step-heading">
              Next Step
            </h2>
            <p className="case-next-step-title">
              {NEXT_STEP_COPY[nextStep.kind].title(nextStep.count, mission.title)}
            </p>
            <p className="case-next-step-body">
              {NEXT_STEP_COPY[nextStep.kind].body(data.firstHardGapLabel)}
            </p>
            <a className="btn btn-primary" href={nextStep.href}>
              {NEXT_STEP_COPY[nextStep.kind].action}
            </a>
          </section>
        ) : null}
        {/* Owner-approved wording, 25 Oct 2026. */}
        <p className="case-journey-reminder">
          Preparing a file is not the same as submitting it. VisaStack does not submit applications
          or predict decisions.
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

          <ul
            className="case-attention"
            aria-label="What needs attention on this case"
            {...atLevel('browse')}
          >
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

        {/* At every level: each link opens the level its section lives at. */}
        <nav className="jump-nav" aria-label="Sections of this case">
          {showTripChecks ? <a href="#trip-checks">Dates</a> : null}
          <a href="#readiness">Readiness</a>
          <a href="#evidence">Evidence</a>
          <a href="#work">Tasks and Letters</a>
          <a href="#snapshots">Snapshots</a>
          <a href="#notes">Contributors and Notes</a>
          <a href="#outcome">Submission and Outcome</a>
        </nav>

        <div className="split case-working-area">
          <div className="split-main">
            {showTripChecks ? (
              <article className="card" id="trip-checks" {...atLevel('browse')}>
                <TripChecksPanel checks={data.tripChecks} />
              </article>
            ) : tripChecksApply(mission.state) ? (
              <p className="muted u-fs-085" {...atLevel('browse')}>
                Add your travel dates under Edit Case Details to see passport and insurance date
                checks.
              </p>
            ) : null}
            <article
              className="card case-evidence-overview"
              // With a checklist, #readiness points at the checklist itself (Browse), so a link to it
              // opens that level; without one, it is the summary card.
              {...(hasChecklist ? {} : { id: 'readiness' })}
            >
              {data.selfReviewed ? (
                <p
                  {...atLevel('browse')}
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
                    <div id="readiness" {...atLevel('browse')}>
                      <h3 className="case-checklist-heading">Evidence Checklist</h3>
                      {/* WP-SB2: each group opens and closes; the first one with rows (what is
                          missing, when anything is) starts open. */}
                      <OpenGroupOnLink scopeId="readiness" />
                      <CollapsibleGroups
                        idPrefix={CHECKLIST_ID_PREFIX}
                        noun={{ one: 'item', other: 'items' }}
                        groups={REQUIREMENT_GROUPS.flatMap((group) => {
                          const groupRows = data.requirementDetails.filter((r) =>
                            group.states.includes(r.state),
                          );
                          if (groupRows.length === 0) return [];
                          return [
                            {
                              key: group.heading.toLowerCase().replace(/\s+/g, '-'),
                              title: group.heading,
                              count: groupRows.length,
                              content: (
                                <>
                                  <div className="rows">
                                    {groupRows.slice(0, CHECKLIST_ROWS_SHOWN).map(requirementRow)}
                                  </div>
                                  {groupRows.length > CHECKLIST_ROWS_SHOWN ? (
                                    <details className="case-checklist-rest">
                                      <summary>
                                        {plural(
                                          groupRows.length - CHECKLIST_ROWS_SHOWN,
                                          'More Item',
                                          'More Items',
                                        )}
                                      </summary>
                                      <div className="rows">
                                        {groupRows.slice(CHECKLIST_ROWS_SHOWN).map(requirementRow)}
                                      </div>
                                    </details>
                                  ) : null}
                                </>
                              ),
                            },
                          ];
                        })}
                      />
                    </div>
                  ) : null}
                  <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '1rem' }}>
                    Readiness is completeness only - never an approval likelihood.
                  </p>
                </>
              ) : (
                <>
                  <CaseReadinessRing readiness={null} pickHref="#pack" size="lg" />
                  <p className="card-body">
                    A checklist lists the papers this visa route asks for and shows which ones you
                    already have on file.
                  </p>
                </>
              )}
            </article>

            <div className="depth-item" {...atLevel('everything')}>
              <Disclosure
                title="Select or Update Evidence"
                hint="Open when you need to make a change"
              >
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
            </div>

            <div className="depth-item" {...atLevel('browse')}>
              <Disclosure
                title="Tasks, Appointments and Letters"
                hint="Open when you need to make a change"
                open={expanded('tasks')}
              >
                <div className="grid u-mt-150" id="work">
                  <TasksPanel
                    missionId={mission.id}
                    tasks={data.tasks}
                    rowIdPrefix={CAPPED_LISTS.tasks.rowId}
                    more={showMore('tasks')}
                    finishedTotal={data.taskTotal - data.openTaskCount}
                    finishedOpen={expanded('tasks')}
                  />
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
            </div>

            <div id="notes" {...atLevel('browse')}>
              <Disclosure
                title="Contributors and Notes from Your Agency"
                hint="Ask a sponsor for one document, read shared notes"
                open={expanded('notes')}
              >
                <div className="grid">
                  <article className="card">
                    <p className="card-kicker">Delegate</p>
                    <h2 className="card-title">Ask a Contributor</h2>
                    <p className="card-body u-mb-125">
                      Ask a sponsor or family member - who never gets a wallet, profile, or case
                      view of any kind - for exactly one named document. They see only what you type
                      below before deciding whether to upload.
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
                      Notes an agency working this case has chosen to share with you. An agency's
                      own internal notes are never shown here.
                    </p>
                    {data.notes.length === 0 ? (
                      <p className="muted u-fs-085">No notes shared with you yet.</p>
                    ) : (
                      <div className="rows">
                        {data.notes.map((n, index) => (
                          <div
                            className="row"
                            key={n.id}
                            id={`${CAPPED_LISTS.notes.rowId}-${index}`}
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
                        {showMore('notes')}
                      </div>
                    )}
                  </article>
                </div>
              </Disclosure>
            </div>

            <div className="depth-item" {...atLevel('everything')}>
              <Disclosure
                title="Submission and Outcome"
                hint="Open when you need to make a change"
                open={expanded('outcomes')}
              >
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
                    rowIdPrefix={CAPPED_LISTS.outcomes.rowId}
                    more={showMore('outcomes')}
                  />
                </div>
              </Disclosure>
            </div>

            <div className="u-mt-150" {...atLevel('everything')}>
              <Disclosure
                title="Problems and Feedback"
                hint="Raise a complaint or give feedback on this case"
                open={expanded('complaints') || expanded('feedback')}
              >
                <div className="grid">
                  <ComplaintPanel
                    missionId={mission.id}
                    complaints={data.complaints}
                    rowIdPrefix={CAPPED_LISTS.complaints.rowId}
                    more={showMore('complaints')}
                  />
                  <FeedbackPanel
                    missionId={mission.id}
                    feedback={data.feedback}
                    canSubmit={data.canSubmitFeedback}
                    rowIdPrefix={CAPPED_LISTS.feedback.rowId}
                    more={showMore('feedback')}
                  />
                </div>
              </Disclosure>
            </div>
          </div>
          <aside className="split-rail" aria-label="About this case" {...atLevel('browse')}>
            <article className="card" {...atLevel('browse')}>
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
            <article className="card" id="pack" {...atLevel('browse')}>
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
                      {[data.packInfo.jurisdiction, data.packInfo.route]
                        .filter(Boolean)
                        .join(' · ')}
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
                    Pick a checklist: attach a published requirement pack to see how many items are
                    ready.
                  </p>
                  <AttachPackForm
                    missionId={mission.id}
                    options={data.packOptions}
                    primary={!hasNextStepOrAlert && !data.welcomeNote}
                  />
                </>
              )}
            </article>
            <article className="card" {...atLevel('browse')}>
              <p className="card-kicker">Workflow</p>
              <h2 className="card-title">Advance the Case</h2>
              {stageStates.length === 0 ? (
                <p className="card-body">
                  {nextStates.length === 0
                    ? 'This case is in a terminal state.'
                    : 'There is no further stage from here. To stop the case, use More at the top of the page.'}
                </p>
              ) : (
                <div className="u-mt-050">
                  <TransitionButtons missionId={mission.id} nextStates={stageStates} />
                </div>
              )}
            </article>
            <article className="card" id="snapshots" {...atLevel('everything')}>
              <p className="card-kicker">History</p>
              <h2 className="card-title">Snapshots</h2>
              <p className="card-body case-memory-link">
                Each snapshot keeps exactly what it held.{' '}
                <Link href={memoryHref(data.applicantId)}>Open Case History</Link> to see every case
                for this person and compare what you confirmed with today.
              </p>
              {data.snapshots.length === 0 ? (
                <p className="card-body">
                  No snapshots yet. Capture one to freeze this case's evidence and checksum.
                </p>
              ) : (
                <div className="rows u-mt-050">
                  {data.snapshots.map((snap) => {
                    const isPacket = isPacketSnapshot(snap.content);
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
              {data.moreSnapshots ? (
                <p className="card-body u-mt-050">
                  <Link href={`/app/mission/${mission.id}/snapshots`}>See All Snapshots</Link>
                </p>
              ) : null}
            </article>
            <article className="card" {...atLevel('everything')}>
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
        {nextStepAction && nextStep ? (
          // WP-SB2: on a phone the next step stays in reach while the person scrolls the case.
          <div className="case-sticky-next">
            <StickyActionBar
              label="Next Step"
              note={nextStepAction.title(nextStep.count, mission.title)}
            >
              <a className="btn btn-secondary" href={nextStep.href}>
                {nextStepAction.action}
              </a>
            </StickyActionBar>
          </div>
        ) : null}
      </DepthScope>
    </section>
  );
}
