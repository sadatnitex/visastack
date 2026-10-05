'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import {
  type ActionState,
  createAppointmentAction,
  createTaskAction,
  decideAppointmentAction,
  decideTaskAction,
  generateLetterAction,
  selectEvidenceAction,
  unselectEvidenceAction,
} from './actions';
import { composeSelectionCandidateKey } from './evidence-selection-key';

const INITIAL: ActionState = { ok: true, message: '' };

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

interface TaskView {
  readonly id: string;
  readonly description: string;
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  readonly priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  readonly dueDate: string | null;
  readonly dueTimezone: string | null;
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
  const openOrInProgress = tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const decided = tasks.filter((t) => t.status === 'DONE' || t.status === 'CANCELLED');

  return (
    <article className="card">
      <p className="card-kicker">Checklist</p>
      <h2 className="card-title">Tasks</h2>
      {openOrInProgress.length === 0 ? (
        <p className="card-body">No open tasks.</p>
      ) : (
        <div className="rows" style={{ marginBottom: '1rem' }}>
          {openOrInProgress.map((task) => (
            <form
              action={decideAction}
              key={task.id}
              className="row"
              style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}
            >
              <input type="hidden" name="missionId" value={missionId} />
              <input type="hidden" name="taskId" value={task.id} />
              <span
                className="row-key"
                style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
              >
                {task.description}
                <span
                  className={`badge ${task.priority === 'URGENT' || task.priority === 'HIGH' ? 'badge-warning' : 'badge-neutral'}`}
                  style={{ fontSize: '0.65rem' }}
                >
                  {PRIORITY_LABELS[task.priority] ?? task.priority}
                </span>
                {task.status === 'IN_PROGRESS' ? (
                  <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>
                    In progress
                  </span>
                ) : null}
                {task.dueDate ? (
                  <span className="muted" style={{ fontSize: '0.7rem' }}>
                    due {new Date(task.dueDate).toLocaleDateString()}
                    {task.dueTimezone ? ` (${task.dueTimezone})` : ''}
                  </span>
                ) : null}
              </span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {task.status === 'OPEN' ? (
                  <SubmitButton
                    pending={decidePending}
                    idle="Start"
                    busy="Start"
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }}
                    name="status"
                    value="IN_PROGRESS"
                  />
                ) : null}
                <SubmitButton
                  pending={decidePending}
                  idle="Done"
                  busy="Done"
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }}
                  name="status"
                  value="DONE"
                />
                <SubmitButton
                  pending={decidePending}
                  idle="Cancel"
                  busy="Cancel"
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }}
                  name="status"
                  value="CANCELLED"
                />
              </div>
            </form>
          ))}
        </div>
      )}
      <FormMessage result={decideState} />

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

      <form
        action={createAction}
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input type="hidden" name="missionId" value={missionId} />
        <input
          name="description"
          type="text"
          className="input"
          placeholder="Add a task…"
          aria-label="Task description"
          required
          style={{ flex: 1, minWidth: '10rem' }}
        />
        <select name="priority" className="input" defaultValue="NORMAL" aria-label="Priority">
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="dueDate"
          type="date"
          className="input"
          aria-label="Due date (optional)"
          style={{ maxWidth: '9rem' }}
        />
        <input
          name="dueTimezone"
          type="text"
          className="input"
          placeholder="Timezone, e.g. Asia/Dhaka"
          aria-label="Due timezone (optional)"
          style={{ maxWidth: '10rem' }}
        />
        <SubmitButton
          pending={createPending}
          idle="Add"
          busy="Adding…"
          className="btn btn-secondary"
        />
      </form>
      <FormMessage result={createState} />
    </article>
  );
}

interface AppointmentView {
  readonly id: string;
  readonly title: string;
  readonly localDateTime: string;
  readonly timezone: string;
  readonly place: string | null;
  readonly channel: string | null;
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
}

/** Commercial V1 Part 4 §11: a scheduled meeting, distinct from a checklist task -- local date/time, timezone, place/channel, and a real add-to-calendar download. */
export function AppointmentsPanel({
  missionId,
  appointments,
}: {
  readonly missionId: string;
  readonly appointments: readonly AppointmentView[];
}) {
  const [createState, createAction, createPending] = useActionState(
    createAppointmentAction,
    INITIAL,
  );
  const [decideState, decideAction, decidePending] = useActionState(
    decideAppointmentAction,
    INITIAL,
  );
  const upcoming = appointments.filter((a) => a.status === 'OPEN' || a.status === 'IN_PROGRESS');
  const past = appointments.filter((a) => a.status === 'DONE' || a.status === 'CANCELLED');

  return (
    <article className="card">
      <p className="card-kicker">Meetings</p>
      <h2 className="card-title">Appointments</h2>
      {upcoming.length === 0 ? (
        <p className="card-body" style={{ marginBottom: '1rem' }}>
          No appointments scheduled.
        </p>
      ) : (
        <div className="rows" style={{ marginBottom: '1rem' }}>
          {upcoming.map((appt) => (
            <div
              key={appt.id}
              className="row"
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}
            >
              <span className="row-key">{appt.title}</span>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {new Date(appt.localDateTime).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}{' '}
                ({appt.timezone}){appt.place ? ` · ${appt.place}` : ''}
                {appt.channel ? ` · ${appt.channel}` : ''}
              </span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <a
                  href={`/app/mission/${missionId}/appointments/${appt.id}/ics`}
                  className="btn btn-secondary"
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', textDecoration: 'none' }}
                >
                  Add to calendar
                </a>
                <form action={decideAction} style={{ display: 'flex', gap: '0.4rem' }}>
                  <input type="hidden" name="missionId" value={missionId} />
                  <input type="hidden" name="appointmentId" value={appt.id} />
                  <SubmitButton
                    pending={decidePending}
                    idle="Done"
                    busy="Done"
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                    name="status"
                    value="DONE"
                  />
                  <SubmitButton
                    pending={decidePending}
                    idle="Cancel"
                    busy="Cancel"
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                    name="status"
                    value="CANCELLED"
                  />
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
      <FormMessage result={decideState} />

      {past.length > 0 ? (
        <details style={{ marginBottom: '1rem' }}>
          <summary className="muted" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>
            {past.length} past
          </summary>
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {past.map((appt) => (
              <div className="row" key={appt.id}>
                <span className="row-key" style={{ textDecoration: 'line-through' }}>
                  {appt.title}
                </span>
                <span className="badge badge-neutral">{appt.status}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <form
        action={createAction}
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input type="hidden" name="missionId" value={missionId} />
        <input
          name="title"
          type="text"
          className="input"
          placeholder="e.g. Visa interview prep call"
          aria-label="Appointment title"
          required
          style={{ flex: 1, minWidth: '10rem' }}
        />
        <input name="localDate" type="date" className="input" aria-label="Date" required />
        <input name="localTime" type="time" className="input" aria-label="Time" required />
        <input
          name="timezone"
          type="text"
          className="input"
          placeholder="Timezone, e.g. Asia/Dhaka"
          aria-label="Timezone"
          required
          style={{ maxWidth: '10rem' }}
        />
        <input
          name="place"
          type="text"
          className="input"
          placeholder="Place (optional)"
          aria-label="Place"
        />
        <input
          name="channel"
          type="text"
          className="input"
          placeholder="Channel, e.g. video call (optional)"
          aria-label="Channel"
        />
        <SubmitButton
          pending={createPending}
          idle="Schedule"
          busy="Scheduling…"
          className="btn btn-secondary"
        />
      </form>
      <FormMessage result={createState} />
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
        Generated strictly from confirmed, eligible evidence - nothing is invented. Not AI-written;
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
        <SubmitButton
          pending={pending}
          unavailable={!canGenerate}
          idle="Generate new version"
          busy="Generating…"
          className="btn btn-secondary"
        />
      </form>
      {!canGenerate ? (
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
          Nothing eligible to ground a letter in yet.
        </p>
      ) : null}
      <FormMessage result={state} />
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
    /** NTF-01: this candidate's freshness against the requirement's route-specific rule, if any. */
    readonly staleness: 'not_applicable' | 'unknown' | 'fresh' | 'stale';
  }>;
  readonly selectedFactIds: readonly string[];
  readonly selectedDocumentIds: readonly string[];
  /** Keyed by `composeSelectionCandidateKey` (evidence-selection-key.ts) - finding #33. */
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
        More than one instance is on file for these requirements - pick exactly which one backs
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
                          <SubmitButton
                            pending={unselectPending}
                            idle="Selected - remove"
                            busy="Selected - remove"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          />
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
                          <SubmitButton
                            pending={selectPending}
                            idle="Select"
                            busy="Select"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          />
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
                        {doc.staleness === 'stale' ? (
                          <span className="badge badge-danger" style={{ marginLeft: '0.4rem' }}>
                            too old for this route
                          </span>
                        ) : null}
                        {doc.staleness === 'unknown' ? (
                          <span className="badge badge-neutral" style={{ marginLeft: '0.4rem' }}>
                            freshness unknown
                          </span>
                        ) : null}
                      </span>
                      {selected && selectionId ? (
                        <form action={unselectAction}>
                          <input type="hidden" name="missionId" value={missionId} />
                          <input type="hidden" name="selectionId" value={selectionId} />
                          <SubmitButton
                            pending={unselectPending}
                            idle="Selected - remove"
                            busy="Selected - remove"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          />
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
                          <SubmitButton
                            pending={selectPending}
                            idle="Select"
                            busy="Select"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          />
                        </form>
                      )}
                    </div>
                  );
                })}
          </div>
        ))}
      </div>
      <FormMessage result={selectState} />
      <FormMessage result={unselectState} />
    </article>
  );
}
