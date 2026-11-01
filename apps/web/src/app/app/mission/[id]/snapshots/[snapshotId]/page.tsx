import {
  type RequirementResultState,
  getMissionForOwner,
  getMissionSnapshot,
  listAcknowledgementsForMission,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CollapsibleGroups } from '../../../../../../components/collapsible-group';
import { type RowNoun, ShowMore } from '../../../../../../components/show-more';
import { PageHeader } from '../../../../../../components/ui';
import { documentTypeLabel } from '../../../../../../lib/labels';
import { fieldLabel } from '../../../../../../lib/master-profile';
import {
  type SearchParamsRecord,
  firstParam,
  nextShow,
  parseShow,
} from '../../../../../../lib/paging';
import { withSession } from '../../../../../../lib/session';
import { AcknowledgementPanel } from './acknowledgement-panel';
import {
  type LegacyFactsShape,
  type SnapshotFactEntry,
  normalizeSnapshotFacts,
} from './snapshot-facts';

export const metadata: Metadata = { title: 'Case Snapshot' };

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
  CONFLICTING: { label: 'Two Values', tone: 'badge-danger' },
  EXPIRING_STALE: { label: 'Out of Date', tone: 'badge-danger' },
  UNVERIFIED: { label: 'To Confirm', tone: 'badge-warning' },
  ATTENTION: { label: 'Optional', tone: 'badge-neutral' },
  SATISFIED: { label: 'On File', tone: 'badge-success' },
  NOT_APPLICABLE: { label: 'Not Applicable', tone: 'badge-neutral' },
};

/** The three parts of a snapshot; each is also its own `?<key>=` row count in the address. */
const GROUP_KEYS = ['requirements', 'facts', 'documents'] as const;
type GroupKey = (typeof GROUP_KEYS)[number];
/** Which part to open, from `?open=` (set by that part's Show More). */
const OPEN_KEY = 'open';

/**
 * WP-SB11: an open part shows 8 rows, then Show More inside the part adds 8 more. A requirement
 * row with a long name and citation is about 120 px tall on a phone, so 8 keep the open snapshot
 * within two screens. The snapshot is one stored record already read in full, so this only limits
 * what is drawn; the ceiling is the part's own length, so every row stays reachable.
 */
const SNAPSHOT_ROW_STEP = 8;

function rowWindow(query: SearchParamsRecord, key: GroupKey, total: number) {
  const sizes = {
    step: SNAPSHOT_ROW_STEP,
    max: Math.max(SNAPSHOT_ROW_STEP, Math.ceil(total / SNAPSHOT_ROW_STEP) * SNAPSHOT_ROW_STEP),
  };
  const shown = Math.min(total, parseShow(query[key], sizes));
  const next = shown < total ? nextShow(shown, sizes) : null;
  return { shown, next };
}

export default async function MissionSnapshotPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string; snapshotId: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const { id, snapshotId } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};

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
  const pathname = `/app/mission/${mission.id}/snapshots/${snapshot.id}`;
  const openParam = firstParam(query[OPEN_KEY]);
  const openKey = GROUP_KEYS.find((key) => key === openParam);
  /** The first `shown` rows of one part, each with an id, and Show More below them. */
  const capped = <T,>(
    key: GroupKey,
    items: readonly T[],
    noun: RowNoun,
    draw: (item: T, rowId: string) => ReactNode,
  ) => {
    const { shown, next } = rowWindow(query, key, items.length);
    const rowId = (n: number) => `snapshot-${key}-row-${n}`;
    return (
      <>
        <div className="rows u-mt-050">
          {items.slice(0, shown).map((item, n) => draw(item, rowId(n)))}
        </div>
        <ShowMore
          id={`snapshot-${key}-more`}
          landOn={rowId(shown)}
          pathname={pathname}
          searchParams={query}
          next={next === null ? null : { [key]: next, [OPEN_KEY]: key }}
          shown={shown}
          total={items.length}
          noun={noun}
        />
      </>
    );
  };

  return (
    <section className="section container">
      <PageHeader
        back={{ href: `/app/mission/${mission.id}`, label: mission.title }}
        eyebrow={isPacket ? 'Application Packet' : 'Working Snapshot'}
        title={`Version ${snapshot.version}`}
        description={`Captured while ${content.state} · checksum ${snapshot.checksum}`}
        actions={
          <a
            className="btn btn-secondary"
            href={`/app/mission/${mission.id}/snapshots/${snapshot.id}/download`}
          >
            Download JSON
          </a>
        }
      />

      {content.evidenceScope === 'all_applicant_evidence' ? (
        <div className="notice notice-warn u-mb-150">
          <strong>Not narrowed to this case.</strong> This case had no automated requirement pack
          attached when captured, so there is no case-specific selection to disclose from - the
          facts and documents below are this traveller's full record, not limited to this case.
        </div>
      ) : content.evidenceScope === undefined ? (
        <div className="notice notice-warn u-mb-150">
          <strong>Captured before case-scoped disclosure existed.</strong> This snapshot may include
          evidence unrelated to this case - later snapshots are narrowed to what this case actually
          uses.
        </div>
      ) : null}

      {/* WP-SB2: the three long parts of a snapshot open and close, each with its count; the
          first one starts open (or the one whose Show More was used). WP-SB11: 8 rows a part,
          then Show More inside it. */}
      <div className="u-mb-150">
        <CollapsibleGroups
          idPrefix="snapshot"
          {...(openKey ? { openKey } : {})}
          groups={[
            ...(content.requirementMapping.length > 0
              ? [
                  {
                    key: 'requirements',
                    title: 'What Satisfies Each Requirement',
                    count: content.requirementMapping.length,
                    content: (
                      <>
                        <p
                          className="muted"
                          style={{ fontSize: 'var(--text-small)', marginBottom: '1rem' }}
                        >
                          Each pack requirement resolved to the specific evidence backing it, as of
                          this snapshot.
                        </p>
                        {capped(
                          'requirements',
                          content.requirementMapping,
                          { one: 'requirement', other: 'requirements' },
                          (m, rowId) => {
                            const label = m.kind === 'FIELD' ? (fieldLabel(m.key) ?? m.key) : m.key;
                            return (
                              <div
                                className="row"
                                key={`${m.kind}-${m.key}`}
                                id={rowId}
                                style={{
                                  flexDirection: 'column',
                                  alignItems: 'stretch',
                                  gap: '0.35rem',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: '0.75rem',
                                  }}
                                >
                                  <span className="row-key">
                                    {label}
                                    {m.optional ? ' · optional' : ''}
                                  </span>
                                  {m.resultState ? (
                                    <span
                                      className={`badge ${RESULT_STATE_LABELS[m.resultState].tone}`}
                                    >
                                      {RESULT_STATE_LABELS[m.resultState].label}
                                    </span>
                                  ) : (
                                    <span
                                      className={`badge ${m.satisfied ? 'badge-success' : 'badge-warning'}`}
                                    >
                                      {m.satisfied ? 'Satisfied' : 'Not Satisfied'}
                                    </span>
                                  )}
                                </div>
                                <p className="muted u-fs-075-m0">{m.citation}</p>
                                {m.kind === 'FIELD' && m.facts && m.facts.length > 0 ? (
                                  <p style={{ margin: 0, fontSize: 'var(--text-small)' }}>
                                    {m.facts
                                      .filter((f) => f.eligible)
                                      .map((f) => f.value)
                                      .join(', ') || '(no eligible value)'}
                                  </p>
                                ) : null}
                                {m.kind === 'DOCUMENT' && m.documents && m.documents.length > 0 ? (
                                  <p style={{ margin: 0, fontSize: 'var(--text-small)' }}>
                                    {m.documents
                                      .filter((d) => d.eligible)
                                      .map((d) => d.displayName)
                                      .join(', ') || '(no eligible document)'}
                                  </p>
                                ) : null}
                              </div>
                            );
                          },
                        )}
                      </>
                    ),
                  },
                ]
              : []),
            {
              key: 'facts',
              title: 'Facts at This Snapshot',
              count: facts.length,
              content: (
                <>
                  {facts.length === 0 ? (
                    <p className="card-body">No facts recorded.</p>
                  ) : (
                    capped('facts', facts, { one: 'fact', other: 'facts' }, (fact, rowId) => (
                      <div className="row" key={fact.factId} id={rowId}>
                        <span className="row-key">
                          {fieldLabel(fact.fieldKey) ?? fact.fieldKey}
                          {fact.repeatingRecordKey ? ` · ${fact.repeatingRecordKey}` : ''}
                        </span>
                        <span>{fact.value}</span>
                      </div>
                    ))
                  )}
                </>
              ),
            },
            {
              key: 'documents',
              title: 'Documents at This Snapshot',
              count: content.documents.length,
              content: (
                <>
                  {content.documents.length === 0 ? (
                    <p className="card-body">No documents recorded.</p>
                  ) : (
                    capped(
                      'documents',
                      content.documents,
                      { one: 'document', other: 'documents' },
                      (doc, rowId) => (
                        <div className="row" key={doc.documentVersionId} id={rowId}>
                          <span className="row-key">{doc.displayName}</span>
                          {doc.docType ? (
                            <span className="badge badge-neutral">
                              {documentTypeLabel(doc.docType)}
                            </span>
                          ) : null}
                        </div>
                      ),
                    )
                  )}
                </>
              ),
            },
          ]}
        />
      </div>

      <div className="u-mt-150">
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
