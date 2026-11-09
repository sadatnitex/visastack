import {
  NO_FORMAT_RULES,
  requirementFormatLines,
  tripChecksApply,
  tripChecksNeedingAction,
} from '@visastack/core';
import { isStarterPackKey } from '@visastack/core';
import { aiAppLabel } from '@visastack/core/ai-features';
import { createTranslator } from '@visastack/i18n';
import {
  CHECKLIST_WORDING_MAX,
  type ChangesSinceConfirmed,
  type Db,
  type NoPackReason,
  accountPrincipal,
  caseExpiryConflicts,
  computeReadiness,
  computeTripChecks,
  getAiFeatureState,
  getApplicant,
  getCasePackage,
  getDocumentLifecycles,
  getEvidenceCandidates,
  getLatestExplanationForRequirement,
  getLiveAcknowledgement,
  getMissionForOwner,
  getPack,
  getPackVersion,
  grantReachesCase,
  latestSourceChecks,
  legalTransitions,
  listAccessForApplicant,
  listAcknowledgementsForMission,
  listAppointments,
  listCaseChecklistEdits,
  listChangesSinceConfirmed,
  listComplaintEvents,
  listComplaintsForMission,
  listContributorRequests,
  listFeedbackForMission,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissionsByItineraryRef,
  listNotesForOwner,
  listOutcomeAttempts,
  listOutcomesForMission,
  listRequirementDetails,
  listRequirements,
  listSelectedEvidence,
  listSubmissionsForMission,
  listTasks,
  localDate,
  pinnedPackNotice,
  referenceCodeFor,
  requireAccess,
  safeHttpUrl,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DepthScope, atLevel } from '../../../../components/depth';
import { DepthSwitch } from '../../../../components/depth-switch';
import { ListWithPane } from '../../../../components/list-pattern';
import { ReferenceCode } from '../../../../components/reference-code';
import { ShowMore } from '../../../../components/show-more';
import { PageHeader, StatusBadge } from '../../../../components/ui';
import { isExplanationConfigured } from '../../../../lib/ai';
import {
  NOTHING_TO_PICK,
  type SelectableChecklists,
  selectableChecklists,
  whyNoChecklist,
} from '../../../../lib/case-checklist-match';
import { savedCaseMatchTerms } from '../../../../lib/case-choices';
import { CASE_STATE_LABELS, caseStateLabel, stageButtonStates } from '../../../../lib/case-stages';
import { depthCopyFor } from '../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../lib/ccd/depth.server';
import { formatTimestampDate } from '../../../../lib/format-date';
import { getLocale } from '../../../../lib/locale';
import {
  CHECKLISTS_NOT_LOADED,
  noChecklistLines,
  packBadge,
  packCoverageLine,
  packNoticeLine,
} from '../../../../lib/pack-labels';
import {
  type SearchParamsRecord,
  TRAVELLER_LIST_STEP,
  firstParam,
  nextShow,
  parseShow,
} from '../../../../lib/paging';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';
import type { PackOption } from './attach-pack-form';
import { CaseChecklist, CaseExpiringDocuments, caseItemPanes } from './case-checklist';
import { CaseMobileBar } from './case-mobile-bar';
import {
  CAPPED_LISTS,
  type CappedList,
  type CaseSourceRow,
  LIST_STEP,
  REQUIREMENT_STATE_META,
  type RequirementDetailRow,
  SNAPSHOTS_ON_PAGE,
  buildCaseAttention,
  madeJustNow,
  officialLabel,
  welcomeChecklists,
} from './case-model';
import { CaseMoreMenu } from './case-more-menu';
import { CaseRail } from './case-rail';
import { CaseSecondary } from './case-secondary';
import { CaseStatusPanel } from './case-status-panel';
import { CaseWelcome } from './case-welcome';
import { caseWelcomeCopy } from './case-welcome-copy';
import { evidenceDocumentIds, evidenceLifecycleLabels } from './evidence-lifecycle';
import { composeSelectionCandidateKey } from './evidence-selection-key';
import { SnapshotButton } from './mission-buttons';
import { PackagePanel } from './package-panel';

export const metadata: Metadata = { title: 'Case' };

export const dynamic = 'force-dynamic';

/**
 * Why a case with a route has no reviewed checklist to pick (VS-006), or none when one fits, the
 * case names no route, or the check failed. Read only to explain; it never changes what is offered.
 */
async function noChecklistReasons(
  db: Db,
  accountId: string,
  mission: {
    readonly id: string;
    readonly destination: string | null;
    readonly purpose: string | null;
  },
  choices: SelectableChecklists,
): Promise<readonly NoPackReason[]> {
  const route = savedCaseMatchTerms(mission.destination, mission.purpose);
  if (!route || choices.lookupFailed || (choices.fitting?.length ?? 0) > 0) return [];
  try {
    return await whyNoChecklist(db, { accountId, missionId: mission.id, ...route });
  } catch (error) {
    reportServerError('MissionPage', error, { step: 'no checklist reasons' });
    return [];
  }
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
    item: itemShow,
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
    // One "view my own case" proof for the trip checks, gap explanations and lifecycle labels,
    // made on first use and shared (lane Z review: it was made up to three times).
    const makeSelfView = () =>
      requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { missionId: mission.id },
        { purpose: 'self' },
      );
    let selfViewGate: ReturnType<typeof makeSelfView> | undefined;
    const selfView = () => {
      selfViewGate ??= makeSelfView();
      return selfViewGate;
    };
    const [
      readiness,
      requirements,
      packVersionRow,
      snapshots,
      choices,
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
      mission.packVersionId
        ? Promise.resolve(NOTHING_TO_PICK)
        : selectableChecklists(db, { accountId, mission }),
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
        ? selfView()
            .then((gate) => (gate.ok ? computeTripChecks(gate.value) : null))
            .catch(() => null)
        : Promise.resolve([]),
    ]);
    // UMPE P4: the trip package, read through this case's own access proof. A refusal or an
    // error leaves the panel out rather than showing a made-up state.
    // A case without a checklist has nothing to assemble yet; its welcome note says so.
    // UMPE P12: the case's application attempts, read through this case's own access proof. A
    // refusal or an error leaves the card out rather than showing a made-up state.
    // A case with no submission report has no attempts yet, so nothing is read for it.
    const outcomeAttempts =
      submissions.ok && submissions.value.length > 0
        ? await selfView()
            .then((gate) => (gate.ok ? listOutcomeAttempts(gate.value, mission.id) : null))
            .then((result) => (result?.ok ? result.value : null))
            .catch(() => null)
        : null;
    const casePackage = mission.packVersionId
      ? await selfView()
          .then((gate) => (gate.ok ? getCasePackage(gate.value, mission.id) : null))
          .then((result) => (result?.ok ? result.value : null))
          .catch(() => null)
      : null;
    // The traveller's own sentences for checklist items, read through this case's own access proof.
    // Before the table exists, or on a refusal or an error, there are none and no edit controls.
    const checklistEdits = mission.packVersionId
      ? await selfView()
          .then((gate) => (gate.ok ? listCaseChecklistEdits(gate.value, mission.id) : null))
          .then((result) => (result?.ok ? result.value : null))
          .catch(() => null)
      : null;
    const myWordings = new Map(
      (checklistEdits?.rewords ?? []).map((r) => [r.packRequirementId, r.wording] as const),
    );
    const wordingEditable = checklistEdits?.editable === true;
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
    // UMPE G2: rule details (category, format rules, effective date), when each cited source was
    // last checked, and chosen documents that will not last the trip. Each is optional: a failure
    // leaves its part out rather than showing a made-up state.
    const [ruleDetails, sourceChecks, expiryConflicts] = await Promise.all([
      listRequirementDetails(
        db,
        requirements.map((r) => r.id),
      ).catch((error: unknown) => {
        reportServerError('MissionPage', error, { step: 'rule details' });
        return new Map<string, never>();
      }),
      latestSourceChecks(
        db,
        requirements.flatMap((r) => (r.sourceUrl ? [r.sourceUrl] : [])),
      ).catch((error: unknown) => {
        reportServerError('MissionPage', error, { step: 'source checks' });
        return new Map<string, Date>();
      }),
      mission.travelEndDate
        ? selfView()
            .then((gate) => (gate.ok ? caseExpiryConflicts(gate.value) : []))
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    const formatLines: Record<string, readonly string[]> = {};
    for (const r of requirements) {
      if (r.kind !== 'DOCUMENT') continue;
      const lines = requirementFormatLines(
        ruleDetails.get(r.id) ?? NO_FORMAT_RULES,
        r.notes,
        r.maxAgeDays,
      );
      if (lines.length > 0) formatLines[r.id] = lines;
    }
    const versionEffective = packVersionRow?.effectiveDate ?? null;
    const sourcesByHref = new Map<string, CaseSourceRow>();
    for (const r of requirements) {
      const href = safeHttpUrl(r.sourceUrl);
      if (!href || !r.sourceUrl) continue;
      const ownEffective = ruleDetails.get(r.id)?.effectiveSince ?? null;
      const checked = sourceChecks.get(r.sourceUrl) ?? null;
      const seen = sourcesByHref.get(href);
      const later = (a: string | null, b: Date | null) =>
        b && (!a || b.toISOString() > a) ? b.toISOString() : a;
      sourcesByHref.set(href, {
        href,
        name:
          seen?.name ??
          ([r.publisher, r.sourceTitle].filter(Boolean).join(' · ') || r.citation || href),
        checkedAt: later(seen?.checkedAt ?? null, checked),
        // The latest date a rule citing this source says it took effect.
        inEffectSince: later(seen?.inEffectSince ?? null, ownEffective),
      });
    }
    // A source whose rules give no date of their own falls back to the checklist version's.
    const caseSources = [...sourcesByHref.values()].map((source) =>
      source.inEffectSince || !versionEffective
        ? source
        : { ...source, inEffectSince: versionEffective.toISOString() },
    );
    // A starter list is public and not authoritative, as the picker and the badge both require.
    const starterPack =
      isStarterPackKey(pack?.key) && !pack?.authoritative && !pack?.ownerOrganizationId;
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
          ...(r.necessity ? { necessity: r.necessity } : {}),
          ...(r.provenance ? { provenance: r.provenance } : {}),
          ...(r.groupKey ? { groupKey: r.groupKey } : {}),
          ...(r.coveredByAlternative ? { coveredByAlternative: true } : {}),
          // A starter list keeps the agency's own sentence and who it is for, shown as written.
          ...(starterPack ? { fromStarter: true as const } : {}),
          ...(starterPack && row?.notes ? { wording: row.notes } : {}),
          ...(starterPack && row?.interpretation ? { appliesWhen: row.interpretation } : {}),
          // The traveller's own sentence for the item, display only (never read by readiness).
          ...(myWordings.get(r.packRequirementId)
            ? { myWording: myWordings.get(r.packRequirementId) as string }
            : {}),
          category: ruleDetails.get(r.packRequirementId)?.category ?? null,
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
      explanationConfigured && explanationEntries.length > 0 ? await selfView() : null;
    const explanationFeature = explanationGate?.ok
      ? await getAiFeatureState(db, 'ai_explanations', { proof: explanationGate.value })
      : null;
    const requiredHardGaps = requirementDetails.filter(
      (r) =>
        !r.optional &&
        (r.state === 'CRITICAL_GAP' || r.state === 'CONFLICTING' || r.state === 'EXPIRING_STALE'),
    );
    // A group of alternatives is one item to provide, however many alternatives it lists.
    const itemKey = (r: RequirementDetailRow) =>
      r.groupKey ? `group:${r.groupKey}` : r.packRequirementId;
    const requiredHardGapCount = new Set(requiredHardGaps.map(itemKey)).size;
    // The first in checklist order: the Next Step names it.
    const firstHardGap = requiredHardGaps[0];
    const firstHardGapLabel = firstHardGap ? officialLabel(firstHardGap) : null;
    const requiredUnverifiedCount = new Set(
      requirementDetails.filter((r) => !r.optional && r.state === 'UNVERIFIED').map(itemKey),
    ).size;
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
    // Resource lifecycle (lane Z, PROGRAMME 5.3): a chosen document that is archived, replaced
    // or removed says so on the evidence lines. Read through the case's own access proof.
    const evidenceEntries = candidates.ok ? candidates.value : [];
    const evidenceIds = evidenceDocumentIds(evidenceEntries);
    const evidenceGate = evidenceIds.length > 0 ? await selfView() : null;
    const lifecycleNow = new Date();
    const evidenceLifecycle = evidenceLifecycleLabels(
      evidenceEntries,
      evidenceGate?.ok
        ? await getDocumentLifecycles(db, evidenceIds, evidenceGate.value, { now: lifecycleNow })
        : new Map(),
      lifecycleNow,
    );
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
    // VS-006: when reviewed checklists exist for the route but none fits, or none exists, the
    // reason is worked out once and shared by the welcome note and the Requirement Pack card.
    const emptyReasons = mission.packVersionId
      ? []
      : await noChecklistReasons(db, accountId, mission, choices);
    const welcomeNote =
      welcomeAsked && madeJustNow(mission.createdAt)
        ? {
            checklists: mission.packVersionId ? null : welcomeChecklists(choices, emptyReasons),
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
      outcomeAttempts,
      attemptToday: localDate(new Date(), applicant?.timezone ?? 'Asia/Dhaka'),
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
      casePackage,
      formatLines,
      openItem: firstParam(itemShow) ?? null,
      // The address as it came, one value per name, so a no-script link to an item keeps the rest.
      currentQuery: Object.fromEntries(
        Object.entries(query).flatMap(([name, value]) => {
          const first = firstParam(value);
          return first === undefined ? [] : [[name, first] as const];
        }),
      ) as Record<string, string>,
      caseSources,
      expiringDocuments: expiryConflicts.map((c) => ({
        documentId: c.documentId,
        name: c.displayName,
        expiresAt: c.expiresAt.toISOString(),
        neededUntil: c.neededUntil.toISOString(),
      })),
      explanationFeature,
      wordingEditable,
      explanationsByRequirement,
      packInfo: pack
        ? {
            name: pack.name,
            badge: packBadge(pack).label,
            reviewed: packBadge(pack).reviewed,
            coverage: packCoverageLine(pack),
            notice: packNoticeLine(
              packVersionRow
                ? pinnedPackNotice(packVersionRow, {
                    authoritative: pack.authoritative,
                    ownerOrganizationId: pack.ownerOrganizationId ?? null,
                    key: pack.key,
                  })
                : null,
            ),
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
      evidenceLifecycle,
      selectionIdsByCandidate,
      linkedMissions: otherLinked.map((m) => ({
        id: m.id,
        title: m.title,
        applicantName: linkedApplicantNames.get(m.applicantId) ?? 'Traveller',
      })),
      packOptions: choices.options.map(
        (p): PackOption => ({
          packVersionId: p.packVersionId,
          label: `${p.packName} · v${p.version} · ${p.requirementCount} requirement${p.requirementCount === 1 ? '' : 's'}${p.starter ? ' · starter list, not official' : ''}${p.ownedByCaseAgency ? " · your agency's list" : ''}${p.reviewOverdue ? ' · review due' : ''}`,
        }),
      ),
      noChecklistLines: choices.lookupFailed
        ? [CHECKLISTS_NOT_LOADED]
        : noChecklistLines(emptyReasons, {
            destination: mission.destination,
            purpose: mission.purpose,
          }),
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
  const attention = buildCaseAttention({
    isDirty: data.isDirty,
    hasReadiness: Boolean(data.readiness),
    hasChecklist,
    requiredHardGapCount: data.requiredHardGapCount,
    requiredUnverifiedCount: data.requiredUnverifiedCount,
    expiringDocumentCount: data.expiringDocuments.length,
    tripChecksToAct,
    openTasks,
  });
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
  const more: Record<CappedList, ReactNode> = {
    tasks: showMore('tasks'),
    notes: showMore('notes'),
    outcomes: showMore('outcomes'),
    complaints: showMore('complaints'),
    feedback: showMore('feedback'),
  };
  const expandedLists: Record<CappedList, boolean> = {
    tasks: expanded('tasks'),
    notes: expanded('notes'),
    outcomes: expanded('outcomes'),
    complaints: expanded('complaints'),
    feedback: expanded('feedback'),
  };
  // The attention item the Next Step shows: none when the case changed (its alert is the next step).
  const nextStepItem = showNextStep && nextStep ? nextStep : null;

  const explanations = {
    configured: data.explanationConfigured,
    off:
      data.explanationFeature && !data.explanationFeature.available
        ? data.explanationFeature.reason
        : undefined,
    byRequirement: new Map(
      [...data.explanationsByRequirement].map(
        ([id, entry]) => [id, entry?.explanation ?? null] as const,
      ),
    ),
  };
  const itemHref = (id: string) => {
    const next = new URLSearchParams(data.currentQuery);
    next.set('item', id);
    return `?${next.toString()}#readiness`;
  };
  const checklistIds = new Set(data.requirementDetails.map((r) => r.packRequirementId));
  // One panel per checklist item; the package choice of an item sits in its own panel.
  const checklistPanes = hasChecklist
    ? caseItemPanes({
        missionId: mission.id,
        applicantId: data.applicantId,
        rows: data.requirementDetails,
        chosenByRequirement: data.evidenceLifecycle.chosenByRequirement,
        wordingEditable: data.wordingEditable,
        wordingMax: CHECKLIST_WORDING_MAX,
        selfReviewed: data.selfReviewed,
        explanations,
        packageItems: new Map(
          (data.casePackage?.items ?? []).map((item) => [item.packRequirementId, item] as const),
        ),
        packageEditable: Boolean(data.casePackage?.available && data.casePackage?.active),
        formatLines: data.formatLines,
      })
    : [];

  return (
    <section className="section container lift-case">
      {/* The scope wraps the header too, so the header's own buttons can sit at a depth. */}
      <DepthScope family="case" depth={depth}>
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
                  You confirmed this case on {formatTimestampDate(data.liveAcknowledgedAt)}
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral">You have not confirmed this case yet</StatusBadge>
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
              </div>
              {/* Browse and deeper: at Glance the header holds the one job, Add Evidence. */}
              <div className="case-header-wide" {...atLevel('browse')}>
                <Link className="btn btn-secondary" href={newCaseHref}>
                  Start a New Case from This One
                </Link>
                <SnapshotButton missionId={mission.id} />
              </div>
              <CaseMoreMenu
                missionId={mission.id}
                applicantId={data.applicantId}
                canCancel={canCancel}
                canDelete={mission.state === 'CANCELLED'}
                headerActions={{ addEvidenceHref: '#evidence', newCaseHref }}
              />
            </>
          }
        />

        <DepthSwitch family="case" initial={depth} copy={depthCopyFor('case')} notesBehindInfo />

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

        <CaseStatusPanel
          missionId={mission.id}
          missionTitle={mission.title}
          applicantId={data.applicantId}
          state={mission.state}
          stateLabels={CASE_STATE_LABELS}
          nextStageStates={stageStates}
          cancelInMore={canCancel}
          isDirty={data.isDirty}
          changesSinceConfirmed={data.changesSinceConfirmed}
          attention={attention}
          nextStep={nextStepItem}
          nextStepFirstItem={
            nextStepItem?.kind === 'expiry'
              ? (data.expiringDocuments[0]?.name ?? null)
              : data.firstHardGapLabel
          }
          manualMode={mission.manualMode}
          readiness={data.readiness}
          acknowledged={Boolean(data.liveAcknowledgedAt) && !data.isDirty}
          requiredUnverifiedCount={data.requiredUnverifiedCount}
          requiredHardGapCount={data.requiredHardGapCount}
          t={t}
          selfReviewed={data.selfReviewed}
          packOptionCount={data.packOptions.length}
          noChecklistLine={data.noChecklistLines[0] ?? null}
          welcomeShown={Boolean(data.welcomeNote)}
          // With a checklist on the page, #readiness points at the checklist itself.
          progressIsReadinessAnchor={!hasChecklist}
        />

        {/* Each link shows at the level its section shows at, so none points at a hidden block. */}
        <nav className="jump-nav" aria-label="Sections of this case" {...atLevel('browse')}>
          {showTripChecks ? (
            <a href="#trip-checks" {...atLevel('browse')}>
              Dates
            </a>
          ) : null}
          <a href="#readiness">Readiness</a>
          {data.casePackage ? (
            <a href="#trip-package" {...atLevel('browse')}>
              Trip Package
            </a>
          ) : null}
          <a href="#evidence" {...atLevel('everything')}>
            Evidence
          </a>
          <a href="#work" {...atLevel('browse')}>
            Tasks and Letters
          </a>
          <a href="#snapshots" {...atLevel('everything')}>
            Snapshots
          </a>
          <a href="#notes" {...atLevel('browse')}>
            Contributors and Notes
          </a>
          <a href="#outcome" {...atLevel('everything')}>
            Submission and Outcome
          </a>
        </nav>

        {/* One column on a phone, in reading order: the checklist, what the case is about, then
            the rest. Two columns on a wide screen: the checklist and the rest on the left, the
            facts about the case in a rail. */}
        <div className="lift-case-grid case-working-area">
          <ListWithPane
            panes={checklistPanes}
            initial={data.openItem ?? undefined}
            paneLabel="Item Details"
            backLabel="Back to the Checklist"
            backHref={`/app/mission/${mission.id}#readiness`}
          >
            <div className="lift-case-checklist">
              {hasChecklist ? (
                <CaseChecklist
                  applicantId={data.applicantId}
                  rows={data.requirementDetails}
                  packName={data.packInfo?.name ?? null}
                  itemHref={itemHref}
                  openItem={data.openItem}
                />
              ) : null}
              {data.readiness && data.expiringDocuments.length > 0 ? (
                <CaseExpiringDocuments documents={data.expiringDocuments} />
              ) : null}
              {data.casePackage ? (
                <article className="card" id="trip-package" {...atLevel('browse')}>
                  <PackagePanel pkg={data.casePackage} listedIds={checklistIds} />
                </article>
              ) : null}
            </div>
          </ListWithPane>
          <CaseRail
            mission={mission}
            applicantId={data.applicantId}
            packInfo={data.packInfo}
            packOptions={data.packOptions}
            noChecklistLines={data.noChecklistLines}
            primaryAttach={!hasNextStepOrAlert && !data.welcomeNote}
            nextStates={nextStates}
            stageStates={stageStates}
            snapshots={data.snapshots}
            moreSnapshots={data.moreSnapshots}
            linkedMissions={data.linkedMissions}
            tripChecks={{
              view: showTripChecks
                ? 'checks'
                : tripChecksApply(mission.state)
                  ? 'add-dates'
                  : 'none',
              checks: data.tripChecks,
            }}
            sources={data.readiness ? data.caseSources : []}
          />
          <div className="lift-case-secondary">
            <CaseSecondary
              missionId={mission.id}
              missionState={mission.state}
              candidates={data.candidates}
              evidenceLifecycle={data.evidenceLifecycle}
              selectionIdsByCandidate={data.selectionIdsByCandidate}
              tasks={data.tasks}
              finishedTaskTotal={data.taskTotal - data.openTaskCount}
              appointments={data.appointments}
              letters={data.letters}
              contributorRequests={data.contributorRequests}
              notes={data.notes}
              submissions={data.submissions}
              outcomes={data.outcomes}
              evidenceOptions={data.evidenceOptions}
              outcomeAttempts={data.outcomeAttempts}
              attemptToday={data.attemptToday}
              complaints={data.complaints}
              feedback={data.feedback}
              canSubmitFeedback={data.canSubmitFeedback}
              expanded={expandedLists}
              more={more}
              totals={{ openTasks: data.openTaskCount, notes: data.noteTotal }}
            />
          </div>
        </div>
        <CaseMobileBar
          nextStep={nextStepItem}
          progress={
            data.readiness
              ? { done: data.readiness.satisfiedRequired, total: data.readiness.requiredCount }
              : null
          }
        />
      </DepthScope>
    </section>
  );
}
