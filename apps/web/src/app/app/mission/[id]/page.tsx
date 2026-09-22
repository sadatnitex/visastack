import { createTranslator } from '@visastack/i18n';
import {
  computeReadiness,
  getApplicant,
  getEvidenceCandidates,
  getMissionForOwner,
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
    ] = await Promise.all([
      mission.packVersionId ? computeReadiness(db, mission.id) : Promise.resolve(null),
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
    ]);
    // Commercial V1 Part 4 §13: "An independent traveller may self-review:
    // label it self-reviewed." No organisation currently holding an ACTIVE,
    // accepted grant on this applicant means there is no external reviewer
    // in the picture at all, so the traveller's own assessment is the only
    // one that exists; this is never inferred from the mission's own state.
    const selfReviewed =
      access.ok &&
      !access.value.some((g) => g.recipientOrganizationId !== null && g.status === 'ACTIVE');
    // Composite key (finding #33, post-programme defect register) — see
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
      readiness: readiness?.ok ? readiness.value : null,
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
          {mission.packVersionId ? (
            <p className="card-body">A published pack is attached to this mission.</p>
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
                  <span
                    className={`badge ${data.readiness.ready ? 'badge-success' : 'badge-warning'}`}
                  >
                    {data.readiness.ready ? 'Complete' : 'Incomplete'}
                  </span>
                </div>
              </div>
              <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                {data.readiness.ready
                  ? t('mission.readiness.ready')
                  : t('mission.readiness.missing', {
                      count: data.readiness.requiredCount - data.readiness.satisfiedRequired,
                    })}
              </p>
              {data.readiness.missing.length > 0 ? (
                <>
                  <p className="card-kicker" style={{ marginBottom: '0.5rem' }}>
                    Missing
                  </p>
                  <div className="rows">
                    {data.readiness.missing.map((m) => {
                      const label =
                        m.kind === 'FIELD' ? (profileField(m.key)?.label ?? m.key) : m.key;
                      return (
                        <div className="row" key={`${m.kind}-${m.key}`}>
                          <span className="row-key">{label || '(unnamed)'}</span>
                          <span
                            className={`badge ${m.reason === 'unresolved_conflict' ? 'badge-danger' : 'badge-neutral'}`}
                          >
                            {m.reason === 'unresolved_conflict'
                              ? 'Needs attention · disputed value'
                              : `${m.kind === 'FIELD' ? 'Field' : 'Document'}${m.optional ? ' · optional' : ''}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: '1rem' }}>
                Readiness is completeness only — never an approval likelihood.
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

      <div className="grid" style={{ marginTop: '1.5rem' }}>
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
