import { createTranslator } from '@visastack/i18n';
import {
  computeReadiness,
  getApplicant,
  getEvidenceCandidates,
  getMissionForOwner,
  isFactStatusEligible,
  legalTransitions,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissionsByItineraryRef,
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
import { EvidenceSelectionPanel, LettersPanel, TasksPanel } from './collaboration-panels';
import { composeSelectionCandidateKey } from './evidence-selection-key';
import { ItineraryForm, SnapshotButton, TransitionButtons } from './mission-buttons';

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
    const [readiness, snapshots, packs, tasks, letters, selections, candidates, linkedMissions] =
      await Promise.all([
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
      ]);
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
      tasks: tasks.ok ? tasks.value : [],
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
    </section>
  );
}
