import { getMissionForOwner, getMissionSnapshot } from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { profileField } from '../../../../../../lib/profile-fields';
import { withSession } from '../../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * The shape `snapshotMission` (packages/services/src/missions.ts) actually
 * writes into the jsonb `content` column. Not schema-enforced — this mirrors
 * the current writer, not a contract the database checks. Every fact and
 * document instance is captured by its exact id, in an array — never
 * collapsed into a key->value slot, so a repeating field's multiple
 * instances (master directive §7 "PR 10") are never overwritten.
 */
interface SnapshotFactEntry {
  readonly fieldKey: string;
  readonly factId: string;
  readonly factVersionId: string | null;
  readonly repeatingRecordKey: string | null;
  readonly value: string | null;
  readonly status: string;
  readonly evidenceLinkIds: readonly string[];
}
interface SnapshotDocumentEntry {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly docType: string | null;
  readonly displayName: string;
  readonly sha256: string | null;
  readonly eligible: boolean;
}
interface SnapshotContent {
  readonly missionId: string;
  readonly state: string;
  readonly packVersion: { readonly id: string; readonly version: number } | null;
  readonly facts: readonly SnapshotFactEntry[];
  readonly documents: readonly SnapshotDocumentEntry[];
  readonly requirementMapping: ReadonlyArray<{
    readonly kind: 'FIELD' | 'DOCUMENT';
    readonly key: string;
    readonly citation: string;
    readonly optional: boolean;
    readonly satisfied: boolean;
    readonly facts?: ReadonlyArray<{ readonly value: string | null; readonly eligible: boolean }>;
    readonly documents?: ReadonlyArray<{
      readonly displayName: string;
      readonly eligible: boolean;
    }>;
  }>;
  readonly readiness: { readonly ready: boolean } | null;
}

// A snapshot taken once the mission has reached this stage of the reviewer
// workflow is the application packet (Build Spec §4.5's "pack production"),
// not just a working evidence capture.
const PACKET_STATES: ReadonlySet<string> = new Set(['READY_TO_EXPORT', 'LOCKED', 'CLOSED']);

export default async function MissionSnapshotPage({
  params,
}: {
  readonly params: Promise<{ id: string; snapshotId: string }>;
}) {
  const { id, snapshotId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const owned = await getMissionForOwner(db, accountId, id);
    if (!owned.ok) return null;
    const snapshot = await getMissionSnapshot(db, accountId, id, snapshotId);
    if (!snapshot.ok) return null;
    return { mission: owned.value, snapshot: snapshot.value };
  });

  if (!data) notFound();
  const { mission, snapshot } = data;
  const content = snapshot.content as SnapshotContent;
  const isPacket = PACKET_STATES.has(content.state);

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href={`/app/mission/${mission.id}`} className="muted" style={{ fontSize: '0.9rem' }}>
          ← {mission.title}
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">{isPacket ? 'Application packet' : 'Working snapshot'}</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Version {snapshot.version}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
            Captured while {content.state} · checksum {snapshot.checksum}
          </p>
        </div>
        <a
          className="btn btn-secondary"
          href={`/app/mission/${mission.id}/snapshots/${snapshot.id}/download`}
        >
          Download JSON
        </a>
      </div>

      {content.requirementMapping.length > 0 ? (
        <article className="card" style={{ marginBottom: '1.5rem' }}>
          <p className="card-kicker">Requirement mapping</p>
          <h2 className="card-title">What satisfies each requirement</h2>
          <p className="muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
            Each pack requirement resolved to the specific evidence backing it, as of this snapshot.
          </p>
          <div className="rows">
            {content.requirementMapping.map((m) => {
              const label = m.kind === 'FIELD' ? (profileField(m.key)?.label ?? m.key) : m.key;
              return (
                <div
                  className="row"
                  key={`${m.kind}-${m.key}`}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span className="row-key">
                      {label}
                      {m.optional ? ' · optional' : ''}
                    </span>
                    <span className={`badge ${m.satisfied ? 'badge-success' : 'badge-warning'}`}>
                      {m.satisfied ? 'Satisfied' : 'Not satisfied'}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
                    {m.citation}
                  </p>
                  {m.kind === 'FIELD' && m.facts && m.facts.length > 0 ? (
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>
                      {m.facts
                        .filter((f) => f.eligible)
                        .map((f) => f.value)
                        .join(', ') || '(no eligible value)'}
                    </p>
                  ) : null}
                  {m.kind === 'DOCUMENT' && m.documents && m.documents.length > 0 ? (
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>
                      {m.documents
                        .filter((d) => d.eligible)
                        .map((d) => d.displayName)
                        .join(', ') || '(no eligible document)'}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>
      ) : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Profile</p>
          <h2 className="card-title">Facts at this snapshot</h2>
          {content.facts.length === 0 ? (
            <p className="card-body">No facts recorded.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {content.facts.map((fact) => (
                <div className="row" key={fact.factId}>
                  <span className="row-key">
                    {profileField(fact.fieldKey)?.label ?? fact.fieldKey}
                    {fact.repeatingRecordKey ? ` · ${fact.repeatingRecordKey}` : ''}
                  </span>
                  <span>{fact.value}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Document Vault</p>
          <h2 className="card-title">Documents at this snapshot</h2>
          {content.documents.length === 0 ? (
            <p className="card-body">No documents recorded.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {content.documents.map((doc) => (
                <div className="row" key={doc.documentVersionId}>
                  <span className="row-key">{doc.displayName}</span>
                  {doc.docType ? <span className="badge badge-neutral">{doc.docType}</span> : null}
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
