import {
  type RequirementResultState,
  getMissionForOwner,
  getMissionSnapshot,
  listAcknowledgementsForMission,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { profileField } from '../../../../../../lib/profile-fields';
import { withSession } from '../../../../../../lib/session';
import { AcknowledgementPanel } from './acknowledgement-panel';
import {
  type LegacyFactsShape,
  type SnapshotFactEntry,
  normalizeSnapshotFacts,
} from './snapshot-facts';

export const dynamic = 'force-dynamic';

/**
 * The shape `snapshotMission` (packages/services/src/missions.ts) actually
 * writes into the jsonb `content` column. Not schema-enforced — this mirrors
 * the current writer, not a contract the database checks. Every fact and
 * document instance is captured by its exact id, in an array — never
 * collapsed into a key->value slot, so a repeating field's multiple
 * instances (master directive §7 "PR 10") are never overwritten.
 * `SnapshotFactEntry`/`LegacyFactsShape` live in `./snapshot-facts` (see
 * that module's own doc comment for why).
 */
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
  readonly facts: readonly SnapshotFactEntry[] | LegacyFactsShape;
  readonly documents: readonly SnapshotDocumentEntry[];
  readonly requirementMapping: ReadonlyArray<{
    readonly kind: 'FIELD' | 'DOCUMENT';
    readonly key: string;
    readonly citation: string;
    readonly optional: boolean;
    readonly satisfied: boolean;
    /** RUL-04 (Part 6 §5). Absent on any snapshot captured before that chunk landed - `satisfied` alone is the fallback for those, never a crash on old data. */
    readonly resultState?: RequirementResultState;
    readonly facts?: ReadonlyArray<{ readonly value: string | null; readonly eligible: boolean }>;
    readonly documents?: ReadonlyArray<{
      readonly displayName: string;
      readonly eligible: boolean;
    }>;
  }>;
  readonly readiness: { readonly ready: boolean } | null;
  /** Directive Part 7 §1 ("repair snapshot scope"). Absent on any snapshot captured before that fix landed - treated as unknown/legacy below, never assumed correctly scoped. */
  readonly evidenceScope?: 'case_selected' | 'all_applicant_evidence';
}

// A snapshot taken once the mission has reached this stage of the reviewer
// workflow is the application packet (Build Spec §4.5's "pack production"),
// not just a working evidence capture. Includes CAS-07's canonical
// late-stage states alongside the legacy ones -- the same "this is the
// exportable/final content" moment, whichever vocabulary the mission uses.
const PACKET_STATES: ReadonlySet<string> = new Set([
  'READY_TO_EXPORT',
  'LOCKED',
  'CLOSED',
  'SUBMISSION_READY',
  'SUBMITTED',
]);

// RUL-04 (Part 6 §5) labels, matching the live mission page's own map. A
// snapshot is a frozen historical view, never actionable, so unlike the live
// page this carries no "next action" links.
const RESULT_STATE_LABELS: Record<RequirementResultState, { label: string; tone: string }> = {
  CRITICAL_GAP: { label: 'Missing', tone: 'badge-danger' },
  CONFLICTING: { label: 'Conflicting values', tone: 'badge-danger' },
  EXPIRING_STALE: { label: 'Evidence too old', tone: 'badge-danger' },
  UNVERIFIED: { label: 'Unverified', tone: 'badge-warning' },
  ATTENTION: { label: 'Optional · not provided', tone: 'badge-neutral' },
  SATISFIED: { label: 'On file', tone: 'badge-success' },
  NOT_APPLICABLE: { label: 'Not applicable', tone: 'badge-neutral' },
};

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
    const acknowledgements = await listAcknowledgementsForMission(db, accountId, id);
    return {
      mission: owned.value,
      snapshot: snapshot.value,
      acknowledgements: acknowledgements.ok ? acknowledgements.value : [],
    };
  });

  if (!data) notFound();
  const { mission, snapshot, acknowledgements } = data;
  const acknowledgementHistory = acknowledgements
    .filter((a) => a.snapshotId === snapshot.id)
    .map((a) => ({
      id: a.id,
      decision: a.decision,
      reason: a.reason,
      createdAt: a.createdAt,
      invalidatedAt: a.invalidatedAt,
    }));
  const content = snapshot.content as SnapshotContent;
  const isPacket = PACKET_STATES.has(content.state);
  const facts = normalizeSnapshotFacts(content.facts);

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

      {content.evidenceScope === 'all_applicant_evidence' ? (
        <div className="notice notice-warn" style={{ marginBottom: '1.5rem' }}>
          <strong>Not narrowed to this case.</strong> This mission had no automated requirement pack
          attached when captured, so there is no case-specific selection to disclose from - the
          facts and documents below are this applicant's full record, not limited to this case.
        </div>
      ) : content.evidenceScope === undefined ? (
        <div className="notice notice-warn" style={{ marginBottom: '1.5rem' }}>
          <strong>Captured before case-scoped disclosure existed.</strong> This snapshot may include
          evidence unrelated to this case - later snapshots are narrowed to what this case actually
          uses.
        </div>
      ) : null}

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
                    {m.resultState ? (
                      <span className={`badge ${RESULT_STATE_LABELS[m.resultState].tone}`}>
                        {RESULT_STATE_LABELS[m.resultState].label}
                      </span>
                    ) : (
                      <span className={`badge ${m.satisfied ? 'badge-success' : 'badge-warning'}`}>
                        {m.satisfied ? 'Satisfied' : 'Not satisfied'}
                      </span>
                    )}
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
          {facts.length === 0 ? (
            <p className="card-body">No facts recorded.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {facts.map((fact) => (
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

      <div style={{ marginTop: '1.5rem' }}>
        <AcknowledgementPanel
          missionId={mission.id}
          snapshotId={snapshot.id}
          checksum={snapshot.checksum}
          history={acknowledgementHistory}
        />
      </div>
    </section>
  );
}
