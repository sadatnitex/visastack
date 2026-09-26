import { createTranslator } from '@visastack/i18n';
import {
  type OverallReadinessState,
  type RequirementResultState,
  computeReadiness,
  getApplicant,
  getEvidenceCandidates,
  getLiveAcknowledgement,
  getMissionForOwner,
  getPack,
  getPackVersion,
  isFactStatusEligible,
  legalTransitions,
  listAccessForApplicant,
  listAppointments,
  listContributorRequests,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissionsByItineraryRef,
  listNotesForOwner,
  listPublishedPackVersions,
  listRequirements,
  listSelectedEvidence,
  listTasks,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale } from '../../../../lib/locale';
import { profileField } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';
import { AttachPackForm, type PackOption } from './attach-pack-form';
import {
  AppointmentsPanel,
  EvidenceSelectionPanel,
  LettersPanel,
  TasksPanel,
} from './collaboration-panels';
import { ContributorRequestsPanel } from './contributor-requests-panel';
import { composeSelectionCandidateKey } from './evidence-selection-key';
import {
  CaseDetailsForm,
  ItineraryForm,
  SnapshotButton,
  TransitionButtons,
} from './mission-buttons';

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  INTAKE: 'Intake',
  IN_REVIEW: 'In review',
  AWAITING_APPLICANT: 'Awaiting applicant',
  SUBMISSION_READY: 'Submission ready',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In progress',
  READY_FOR_REVIEW: 'Ready for review',
  UNDER_REVIEW: 'Under review',
  READY_TO_EXPORT: 'Ready to export',
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
  READY_FOR_APPLICANT_REVIEW: { label: 'Ready for review', tone: 'badge-success' },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'badge-warning' },
  NEEDS_ACTION: { label: 'Needs action', tone: 'badge-danger' },
  MANUAL_ONLY: { label: 'Manual · not automatically assessed', tone: 'badge-neutral' },
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
    next: 'Required to move this case forward.',
    order: 0,
  },
  CONFLICTING: {
    label: 'Conflicting values',
    tone: 'badge-danger',
    next: 'Multiple conflicting values are on file. Resolve this on the profile before it can count.',
    order: 1,
  },
  EXPIRING_STALE: {
    label: 'Evidence too old',
    tone: 'badge-danger',
    next: "The evidence on file is outside this route's freshness window. Upload a current version.",
    order: 2,
  },
  UNVERIFIED: {
    label: 'Unverified',
    tone: 'badge-warning',
    next: 'Whether this applies depends on other case details not yet confirmed.',
    order: 3,
  },
  ATTENTION: {
    label: 'Optional · not provided',
    tone: 'badge-neutral',
    next: 'Optional for this case.',
    order: 4,
  },
  SATISFIED: { label: 'On file', tone: 'badge-success', next: '', order: 5 },
  NOT_APPLICABLE: {
    label: 'Not applicable',
    tone: 'badge-neutral',
    next: 'Does not apply to this case.',
    order: 6,
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
    ]);
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
    const selfReviewed =
      access.ok &&
      !access.value.some((g) => g.recipientOrganizationId !== null && g.status === 'ACTIVE');
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
    return {
      mission,
      applicantName: applicant?.displayName ?? 'Applicant',
      applicantId: mission.applicantId,
      liveAcknowledgedAt: liveAcknowledgement?.createdAt.toISOString() ?? null,
      readiness: readinessValue,
      requirementDetails,
      requiredHardGapCount,
      requiredUnverifiedCount,
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

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link
          href={`/app/applicant/${data.applicantId}/missions`}
          className="muted"
          style={{ fontSize: '0.9rem' }}
        >
          ← {data.applicantName} · Missions
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Mission</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {mission.title}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {mission.destination ? `${mission.destination} · ` : ''}
            {STATE_LABELS[mission.state] ?? mission.state}
            {' · '}
            {data.liveAcknowledgedAt
              ? `Acknowledged ${new Date(data.liveAcknowledgedAt).toLocaleDateString()}`
              : 'Not yet acknowledged'}
          </p>
        </div>
        <SnapshotButton missionId={mission.id} />
      </div>

      {mission.manualMode ? (
        <div className="notice notice-warn" style={{ marginBottom: '1.5rem' }}>
          <strong>Manual mode.</strong> No automated requirement pack covers this route yet.
          Readiness is not tracked automatically here - you are responsible for confirming what this
          case needs yourself. This is never claimed as an official readiness assessment, on this
          page or in any exported snapshot.
        </div>
      ) : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Requirements</p>
          <h2 className="card-title">Requirement pack</h2>
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
                <span className="card-body" style={{ margin: 0 }}>
                  {data.packInfo.name}
                </span>
                <span
                  className={`badge ${data.packInfo.authoritative ? 'badge-success' : 'badge-neutral'}`}
                >
                  {data.packInfo.authoritative
                    ? 'Official requirement pack'
                    : 'Agency custom checklist'}
                </span>
              </div>
              {data.packInfo.jurisdiction || data.packInfo.route ? (
                <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                  {[data.packInfo.jurisdiction, data.packInfo.route].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {data.packInfo.effectiveDate ? (
                <p className="muted" style={{ fontSize: '0.8rem', margin: '0.35rem 0 0' }}>
                  In effect since {new Date(data.packInfo.effectiveDate).toLocaleDateString()}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="card-body" style={{ marginBottom: '1rem' }}>
                Attach a published requirement pack to compute readiness.
              </p>
              <AttachPackForm missionId={mission.id} options={data.packOptions} />
            </>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Case</p>
          <h2 className="card-title">Case details</h2>
          <CaseDetailsForm
            missionId={mission.id}
            jurisdiction={mission.jurisdiction}
            serviceCategory={mission.serviceCategory}
            travelStartDate={mission.travelStartDate}
            travelEndDate={mission.travelEndDate}
            targetDeadline={mission.targetDeadline}
            manualMode={mission.manualMode}
          />
        </article>

        <article className="card">
          <p className="card-kicker">Family trip</p>
          <h2 className="card-title">Itinerary reference</h2>
          <p className="card-body" style={{ marginBottom: '1rem' }}>
            An optional label linking this case to another family member's, purely for display.
            Access and permissions stay entirely separate per case.
          </p>
          <ItineraryForm missionId={mission.id} itineraryRef={mission.itineraryRef} />
          {data.linkedMissions.length > 0 ? (
            <div className="rows" style={{ marginTop: '1rem' }}>
              {data.linkedMissions.map((m) => (
                <Link className="row row-link" key={m.id} href={`/app/mission/${m.id}`}>
                  <span className="row-key">{m.applicantName}</span>
                  <span className="muted">{m.title}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </article>

        <article className="card">
          <p className="card-kicker">Completeness</p>
          <h2 className="card-title">Readiness</h2>
          {data.selfReviewed ? (
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <span className="badge badge-neutral">Self-reviewed</span> No agency currently has
              access to this case, so you are the only one assessing it.
            </p>
          ) : null}
          {data.readiness ? (
            <>
              <div className="rows" style={{ marginBottom: '1rem' }}>
                <div className="row">
                  <span className="row-key">Required satisfied</span>
                  <span className="row-val">
                    {data.readiness.satisfiedRequired} / {data.readiness.requiredCount}
                  </span>
                </div>
                <div className="row">
                  <span className="row-key">Status</span>
                  <span className={`badge ${OVERALL_STATE_META[data.readiness.overallState].tone}`}>
                    {OVERALL_STATE_META[data.readiness.overallState].label}
                  </span>
                </div>
              </div>
              <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                {data.readiness.overallState === 'READY_FOR_APPLICANT_REVIEW'
                  ? t('mission.readiness.ready')
                  : data.readiness.overallState === 'NEEDS_REVIEW'
                    ? t('mission.readiness.needsReview', { count: data.requiredUnverifiedCount })
                    : data.readiness.overallState === 'MANUAL_ONLY'
                      ? t('mission.readiness.manualOnly')
                      : t('mission.readiness.missing', { count: data.requiredHardGapCount })}
              </p>
              {data.requirementDetails.length > 0 ? (
                <>
                  <p className="card-kicker" style={{ marginBottom: '0.5rem' }}>
                    Every requirement
                  </p>
                  <div className="rows">
                    {data.requirementDetails.map((r) => {
                      const meta = REQUIREMENT_STATE_META[r.state];
                      const label =
                        r.kind === 'FIELD' ? (profileField(r.key)?.label ?? r.key) : r.key;
                      const sourceLine = [r.publisher, r.sourceTitle].filter(Boolean).join(' · ');
                      return (
                        <div
                          className="row"
                          key={r.packRequirementId}
                          style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}
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
                            <span className="muted" style={{ fontSize: '0.8rem' }}>
                              {meta.next}
                              {r.state === 'CONFLICTING' ? (
                                <>
                                  {' '}
                                  <Link href={`/app/applicant/${data.applicantId}/profile`}>
                                    Resolve on profile →
                                  </Link>
                                </>
                              ) : null}
                              {r.state === 'CRITICAL_GAP' || r.state === 'EXPIRING_STALE' ? (
                                <>
                                  {' '}
                                  <a href="#evidence">Provide evidence ↓</a>
                                </>
                              ) : null}
                            </span>
                          ) : null}
                          {r.citation ? (
                            <span className="muted" style={{ fontSize: '0.75rem' }}>
                              Cite: {sourceLine || r.citation}
                              {r.observedDate
                                ? ` · as of ${new Date(r.observedDate).toLocaleDateString()}`
                                : ''}
                              {r.sourceUrl ? (
                                <>
                                  {' · '}
                                  <a href={r.sourceUrl} target="_blank" rel="noreferrer">
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
                              Source currently unreachable - under review
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: '1rem' }}>
                Readiness is completeness only - never an approval likelihood.
              </p>
            </>
          ) : (
            <p className="card-body">Attach a requirement pack to see readiness.</p>
          )}
        </article>
      </div>

      <div className="grid" style={{ marginTop: '1.5rem' }}>
        <article className="card">
          <p className="card-kicker">Workflow</p>
          <h2 className="card-title">Advance the mission</h2>
          {nextStates.length === 0 ? (
            <p className="card-body">This mission is in a terminal state.</p>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              <TransitionButtons missionId={mission.id} nextStates={nextStates} />
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">History</p>
          <h2 className="card-title">Snapshots</h2>
          {data.snapshots.length === 0 ? (
            <p className="card-body">
              No snapshots yet. Capture one to freeze this mission's evidence and checksum.
            </p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
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
                          Application packet
                        </span>
                      ) : null}
                    </span>
                    <span className="row-val" title={snap.checksum} style={{ fontSize: '0.75rem' }}>
                      {snap.checksum.slice(0, 12)}…
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </article>
      </div>

      <div className="grid" id="evidence" style={{ marginTop: '1.5rem' }}>
        <EvidenceSelectionPanel
          missionId={mission.id}
          candidates={data.candidates.map((c) => ({
            packRequirementId: c.packRequirementId,
            kind: c.kind,
            label: c.kind === 'FIELD' ? (profileField(c.key)?.label ?? c.key) : c.key,
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

      <div className="grid" style={{ marginTop: '1.5rem' }}>
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

      <div className="grid" style={{ marginTop: '1.5rem' }}>
        <article className="card">
          <p className="card-kicker">Delegate</p>
          <h2 className="card-title">Ask a contributor</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Ask a sponsor or family member - who never gets a wallet, profile, or case view of any
            kind - for exactly one named document. They see only what you type below before deciding
            whether to upload.
          </p>
          <ContributorRequestsPanel missionId={mission.id} requests={data.contributorRequests} />
        </article>

        <article className="card">
          <p className="card-kicker">Collaboration</p>
          <h2 className="card-title">Notes from your agency</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Notes an agency working this case has chosen to share with you. An agency's own internal
            notes are never shown here.
          </p>
          {data.notes.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              No notes shared with you yet.
            </p>
          ) : (
            <div className="rows">
              {data.notes.map((n) => (
                <div
                  className="row"
                  key={n.id}
                  style={{ flexDirection: 'column', alignItems: 'flex-start' }}
                >
                  <span style={{ fontSize: '0.9rem' }}>{n.body}</span>
                  <span className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                    {n.authorEmail ?? 'Unknown'}, {new Date(n.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
