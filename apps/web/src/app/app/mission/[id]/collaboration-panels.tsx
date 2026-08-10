'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  createTaskAction,
  decideTaskAction,
  generateLetterAction,
  selectEvidenceAction,
  unselectEvidenceAction,
} from './actions';
import { composeSelectionCandidateKey } from './evidence-selection-key';

const INITIAL: ActionState = { ok: true, message: '' };

interface TaskView {
  readonly id: string;
  readonly description: string;
  readonly status: 'OPEN' | 'DONE' | 'CANCELLED';
}

export function TasksPanel({
  missionId,
  tasks,
}: {
  readonly missionId: string;
  readonly tasks: readonly TaskView[];
}) {
  const [createState, createAction, createPending] = useActionState(createTaskAction, INITIAL);
  const [decideState, decideAction, decidePending] = useActionState(decideTaskAction, INITIAL);
  const open = tasks.filter((t) => t.status === 'OPEN');
  const decided = tasks.filter((t) => t.status !== 'OPEN');

  return (
    <article className="card">
      <p className="card-kicker">Checklist</p>
      <h2 className="card-title">Tasks</h2>
      {open.length === 0 ? (
        <p className="card-body">No open tasks.</p>
      ) : (
        <div className="rows" style={{ marginBottom: '1rem' }}>
          {open.map((task) => (
            <form
              action={decideAction}
              key={task.id}
              className="row"
              style={{ alignItems: 'center' }}
            >
              <input type="hidden" name="missionId" value={missionId} />
              <input type="hidden" name="taskId" value={task.id} />
              <span className="row-key">{task.description}</span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  type="submit"
                  name="status"
                  value="DONE"
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }}
                  disabled={decidePending}
                >
                  Done
                </button>
                <button
                  type="submit"
                  name="status"
                  value="CANCELLED"
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }}
                  disabled={decidePending}
                >
                  Cancel
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
      {decideState.message ? (
        <p className={`field-msg ${decideState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {decideState.message}
        </p>
      ) : null}

      {decided.length > 0 ? (
        <details style={{ marginBottom: '1rem' }}>
          <summary className="muted" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>
            {decided.length} completed/cancelled
          </summary>
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {decided.map((task) => (
              <div className="row" key={task.id}>
                <span className="row-key" style={{ textDecoration: 'line-through' }}>
                  {task.description}
                </span>
                <span className="badge badge-neutral">{task.status}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <form action={createAction} style={{ display: 'flex', gap: '0.5rem' }}>
        <input type="hidden" name="missionId" value={missionId} />
        <input
          name="description"
          type="text"
          className="input"
          placeholder="Add a task…"
          aria-label="Task description"
          required
        />
        <button type="submit" className="btn btn-secondary" disabled={createPending}>
          {createPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {createState.message ? (
        <p className={`field-msg ${createState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {createState.message}
        </p>
      ) : null}
    </article>
  );
}

interface LetterView {
  readonly id: string;
  readonly version: number;
  readonly content: string;
  readonly createdAt: string;
}

export function LettersPanel({
  missionId,
  letters,
  canGenerate,
}: {
  readonly missionId: string;
  readonly letters: readonly LetterView[];
  readonly canGenerate: boolean;
}) {
  const [state, formAction, pending] = useActionState(generateLetterAction, INITIAL);
  return (
    <article className="card">
      <p className="card-kicker">Grounded documents</p>
      <h2 className="card-title">Cover letters</h2>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
        Generated strictly from confirmed, eligible evidence — nothing is invented. Not AI-written;
        deterministic and versioned.
      </p>
      {letters.length === 0 ? (
        <p className="card-body" style={{ marginBottom: '1rem' }}>
          No letters generated yet.
        </p>
      ) : (
        <div className="rows" style={{ marginBottom: '1rem' }}>
          {letters.map((letter) => (
            <details key={letter.id}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                Version {letter.version} · {new Date(letter.createdAt).toLocaleDateString()}
              </summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.8rem',
                  marginTop: '0.5rem',
                  fontFamily: 'inherit',
                }}
              >
                {letter.content}
              </pre>
            </details>
          ))}
        </div>
      )}
      <form action={formAction}>
        <input type="hidden" name="missionId" value={missionId} />
        <button type="submit" className="btn btn-secondary" disabled={pending || !canGenerate}>
          {pending ? 'Generating…' : 'Generate new version'}
        </button>
      </form>
      {!canGenerate ? (
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
          Nothing eligible to ground a letter in yet.
        </p>
      ) : null}
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </article>
  );
}

interface CandidateView {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly label: string;
  readonly citation: string;
  readonly factCandidates: ReadonlyArray<{
    readonly factId: string;
    readonly value: string | null;
    readonly repeatingRecordKey: string | null;
    readonly eligible: boolean;
  }>;
  readonly documentCandidates: ReadonlyArray<{
    readonly documentId: string;
    readonly displayName: string;
    readonly eligible: boolean;
  }>;
  readonly selectedFactIds: readonly string[];
  readonly selectedDocumentIds: readonly string[];
  /** Keyed by `composeSelectionCandidateKey` (evidence-selection-key.ts) — finding #33. */
  readonly selectionIdsByCandidate: Readonly<Record<string, string>>;
}

export function EvidenceSelectionPanel({
  missionId,
  candidates,
}: {
  readonly missionId: string;
  readonly candidates: readonly CandidateView[];
}) {
  const [selectState, selectAction, selectPending] = useActionState(selectEvidenceAction, INITIAL);
  const [unselectState, unselectAction, unselectPending] = useActionState(
    unselectEvidenceAction,
    INITIAL,
  );
  const multiCandidate = candidates.filter(
    (c) => c.factCandidates.length + c.documentCandidates.length > 1,
  );

  if (multiCandidate.length === 0) return null;

  return (
    <article className="card">
      <p className="card-kicker">Precision</p>
      <h2 className="card-title">Select evidence</h2>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
        More than one instance is on file for these requirements — pick exactly which one backs
        each. Until you select, any eligible instance may count.
      </p>
      <div className="rows">
        {multiCandidate.map((c) => (
          <div
            key={c.packRequirementId}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
          >
            <span className="row-key">{c.label}</span>
            {c.kind === 'FIELD'
              ? c.factCandidates.map((fact) => {
                  const selected = c.selectedFactIds.includes(fact.factId);
                  const selectionId =
                    c.selectionIdsByCandidate[
                      composeSelectionCandidateKey(c.packRequirementId, fact.factId)
                    ];
                  return (
                    <div
                      key={fact.factId}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <span style={{ fontSize: '0.85rem', flex: 1 }}>
                        {fact.value}
                        {fact.repeatingRecordKey ? ` (${fact.repeatingRecordKey})` : ''}
                        {!fact.eligible ? (
                          <span className="badge badge-danger" style={{ marginLeft: '0.4rem' }}>
                            not eligible
                          </span>
                        ) : null}
                      </span>
                      {selected && selectionId ? (
                        <form action={unselectAction}>
                          <input type="hidden" name="missionId" value={missionId} />
                          <input type="hidden" name="selectionId" value={selectionId} />
                          <button
                            type="submit"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                            disabled={unselectPending}
                          >
                            Selected — remove
                          </button>
                        </form>
                      ) : (
                        <form action={selectAction}>
                          <input type="hidden" name="missionId" value={missionId} />
                          <input
                            type="hidden"
                            name="packRequirementId"
                            value={c.packRequirementId}
                          />
                          <input type="hidden" name="factId" value={fact.factId} />
                          <button
                            type="submit"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                            disabled={selectPending}
                          >
                            Select
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })
              : c.documentCandidates.map((doc) => {
                  const selected = c.selectedDocumentIds.includes(doc.documentId);
                  const selectionId =
                    c.selectionIdsByCandidate[
                      composeSelectionCandidateKey(c.packRequirementId, doc.documentId)
                    ];
                  return (
                    <div
                      key={doc.documentId}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <span style={{ fontSize: '0.85rem', flex: 1 }}>
                        {doc.displayName}
                        {!doc.eligible ? (
                          <span className="badge badge-danger" style={{ marginLeft: '0.4rem' }}>
                            not eligible
                          </span>
                        ) : null}
                      </span>
                      {selected && selectionId ? (
                        <form action={unselectAction}>
                          <input type="hidden" name="missionId" value={missionId} />
                          <input type="hidden" name="selectionId" value={selectionId} />
                          <button
                            type="submit"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                            disabled={unselectPending}
                          >
                            Selected — remove
                          </button>
                        </form>
                      ) : (
                        <form action={selectAction}>
                          <input type="hidden" name="missionId" value={missionId} />
                          <input
                            type="hidden"
                            name="packRequirementId"
                            value={c.packRequirementId}
                          />
                          <input type="hidden" name="documentId" value={doc.documentId} />
                          <button
                            type="submit"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                            disabled={selectPending}
                          >
                            Select
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
          </div>
        ))}
      </div>
      {selectState.message ? (
        <p className={`field-msg ${selectState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {selectState.message}
        </p>
      ) : null}
      {unselectState.message ? (
        <p className={`field-msg ${unselectState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {unselectState.message}
        </p>
      ) : null}
    </article>
  );
}
