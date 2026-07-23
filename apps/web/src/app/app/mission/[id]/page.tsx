import type { MissionState } from '@visastack/core';
import {
  computeReadiness,
  getApplicant,
  getMissionForOwner,
  legalTransitions,
  listMissionSnapshots,
  listPublishedPackVersions,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { profileField } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';
import { snapshotMissionAction, transitionMissionAction } from './actions';
import { AttachPackForm, type PackOption } from './attach-pack-form';

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

const DESTRUCTIVE: ReadonlySet<MissionState> = new Set(['CANCELLED']);

export default async function MissionPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const owned = await getMissionForOwner(db, accountId, id);
    if (!owned.ok) return null;
    const mission = owned.value;
    const applicant = await getApplicant(db, mission.applicantId);
    const [readiness, snapshots, packs] = await Promise.all([
      mission.packVersionId ? computeReadiness(db, mission.id) : Promise.resolve(null),
      listMissionSnapshots(db, accountId, mission.id),
      listPublishedPackVersions(db),
    ]);
    return {
      mission,
      applicantName: applicant?.displayName ?? 'Applicant',
      applicantId: mission.applicantId,
      readiness: readiness?.ok ? readiness.value : null,
      snapshots: snapshots.ok ? snapshots.value : [],
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
        <form action={snapshotMissionAction}>
          <input type="hidden" name="missionId" value={mission.id} />
          <button type="submit" className="btn btn-secondary">
            Snapshot
          </button>
        </form>
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
                          <span className="badge badge-neutral">
                            {m.kind === 'FIELD' ? 'Field' : 'Document'}
                            {m.optional ? ' · optional' : ''}
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
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {nextStates.map((to) => (
                <form action={transitionMissionAction} key={to}>
                  <input type="hidden" name="missionId" value={mission.id} />
                  <input type="hidden" name="to" value={to} />
                  <button
                    type="submit"
                    className={`btn ${DESTRUCTIVE.has(to) ? 'btn-danger' : 'btn-secondary'}`}
                  >
                    {STATE_LABELS[to] ?? to}
                  </button>
                </form>
              ))}
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
              {data.snapshots.map((snap) => (
                <div className="row" key={snap.id}>
                  <span className="row-key">Version {snap.version}</span>
                  <span className="row-val" title={snap.checksum} style={{ fontSize: '0.75rem' }}>
                    {snap.checksum.slice(0, 12)}…
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
