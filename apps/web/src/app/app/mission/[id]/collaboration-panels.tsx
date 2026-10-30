'use client';

import { useActionState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../components/form-feedback';
import { useLatestOf } from '../../../../components/latest-result';
import { TimeZoneSelect } from '../../../../components/time-zone-select';
import { humanizeCode } from '../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
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
  /** The AI app that added this reminder (S21); only the person sees these. */
  readonly addedBy?: string | null;
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
  // One status line for the whole task area: the latest answer replaces the one before, and it
  // sits by the button that was pressed (below the list for Start/Done/Cancel, below the form
  // for Add). Both places stay in the page, empty when unused, so screen readers announce it.
  const [status, statusFrom] = useLatestOf({ add: createState, list: decideState });
  const openOrInProgress = tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const decided = tasks.filter((t) => t.status === 'DONE' || t.status === 'CANCELLED');

  return (
    <article className="card">
      <p className="card-kicker">Checklist</p>
      <h2 className="card-title">Tasks</h2>
      {openOrInProgress.length === 0 ? (
        <p className="card-body">No open tasks.</p>
      ) : (
        <div className="rows u-mb-100">
          {openOrInProgress.map((task) => (
            <form action={decideAction} key={task.id} className="row task-row">
              <input type="hidden" name="missionId" value={missionId} />
              <input type="hidden" name="taskId" value={task.id} />
              <span className="row-key">
                {task.description}
                <span
                  className={`badge ${task.priority === 'URGENT' || task.priority === 'HIGH' ? 'badge-warning' : 'badge-neutral'}`}
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  {PRIORITY_LABELS[task.priority] ?? task.priority}
                </span>
                {task.status === 'IN_PROGRESS' ? (
                  <span className="badge badge-neutral" style={{ fontSize: 'var(--text-caption)' }}>
                    In Progress
                  </span>
                ) : null}
                {task.addedBy ? (
                  <span className="badge badge-neutral task-added-by">Added by {task.addedBy}</span>
                ) : null}
                {task.dueDate ? (
                  <span className="muted" style={{ fontSize: 'var(--text-caption)' }}>
                    due {formatDateOnly(task.dueDate)}
                    {task.dueTimezone ? ` (${task.dueTimezone})` : ''}
                  </span>
                ) : null}
              </span>
              <div className="task-row-actions">
                {task.status === 'OPEN' ? (
                  <SubmitButton
                    pending={decidePending}
                    idle="Start"
                    busy="Start"
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.7rem', fontSize: 'var(--text-caption)' }}
                    name="status"
                    value="IN_PROGRESS"
                  />
                ) : null}
                <SubmitButton
                  pending={decidePending}
                  idle="Done"
                  busy="Done"
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.7rem', fontSize: 'var(--text-caption)' }}
                  name="status"
                  value="DONE"
                />
                <SubmitButton
                  pending={decidePending}
                  idle="Cancel"
                  busy="Cancel"
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.7rem', fontSize: 'var(--text-caption)' }}
                  name="status"
                  value="CANCELLED"
                />
              </div>
            </form>
          ))}
        </div>
      )}
      <FormMessage result={statusFrom === 'list' ? status : NO_RESULT} />
      {decided.length > 0 ? (
        <details className="u-mb-100">
          <summary className="muted" style={{ fontSize: 'var(--text-small)', cursor: 'pointer' }}>
            {decided.length} completed/cancelled
          </summary>
          <div className="rows u-mt-050">
            {decided.map((task) => (
              <div className="row" key={task.id}>
                <span className="row-key" style={{ textDecoration: 'line-through' }}>
                  {task.description}
                </span>
                <span className="badge badge-neutral">{humanizeCode(task.status)}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <form action={createAction} className="collab-add-form">
        <input type="hidden" name="missionId" value={missionId} />
        <input
          name="description"
          type="text"
          className="input collab-add-wide"
          placeholder="Add a task…"
          aria-label="Task description"
          required
        />
        <select name="priority" className="input" defaultValue="NORMAL" aria-label="Priority">
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input name="dueDate" type="date" className="input" aria-label="Due Date (Optional)" />
        <TimeZoneSelect
          name="dueTimezone"
          label="Due Time Zone (Optional)"
          required={false}
          className="collab-add-wide"
        />
        <SubmitButton
          pending={createPending}
          idle="Add"
          busy="Adding…"
          className="btn btn-secondary"
        />
      </form>
      <FormMessage result={statusFrom === 'add' ? status : NO_RESULT} />
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
  // One status line for the whole appointments area, placed as for tasks.
  const [status, statusFrom] = useLatestOf({ add: createState, list: decideState });
  const upcoming = appointments.filter((a) => a.status === 'OPEN' || a.status === 'IN_PROGRESS');
  const past = appointments.filter((a) => a.status === 'DONE' || a.status === 'CANCELLED');

  return (
    <article className="card">
      <p className="card-kicker">Meetings</p>
      <h2 className="card-title">Appointments</h2>
      {upcoming.length === 0 ? (
        <p className="card-body u-mb-100">No appointments scheduled.</p>
      ) : (
        <div className="rows u-mb-100">
          {upcoming.map((appt) => (
            <div
              key={appt.id}
              className="row"
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}
            >
              <span className="row-key">{appt.title}</span>
              <span className="muted u-fs-085">
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
                  style={{
                    padding: '0.2rem 0.6rem',
                    fontSize: 'var(--text-caption)',
                    textDecoration: 'none',
                  }}
                >
                  Add to Calendar
                </a>
                <form action={decideAction} style={{ display: 'flex', gap: '0.4rem' }}>
                  <input type="hidden" name="missionId" value={missionId} />
                  <input type="hidden" name="appointmentId" value={appt.id} />
                  <SubmitButton
                    pending={decidePending}
                    idle="Done"
                    busy="Done"
                    className="btn btn-secondary u-btn-xs"
                    name="status"
                    value="DONE"
                  />
                  <SubmitButton
                    pending={decidePending}
                    idle="Cancel"
                    busy="Cancel"
                    className="btn btn-secondary u-btn-xs"
                    name="status"
                    value="CANCELLED"
                  />
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
      <FormMessage result={statusFrom === 'list' ? status : NO_RESULT} />
      {past.length > 0 ? (
        <details className="u-mb-100">
          <summary className="muted" style={{ fontSize: 'var(--text-small)', cursor: 'pointer' }}>
            {past.length} past
          </summary>
          <div className="rows u-mt-050">
            {past.map((appt) => (
              <div className="row" key={appt.id}>
                <span className="row-key" style={{ textDecoration: 'line-through' }}>
                  {appt.title}
                </span>
                <span className="badge badge-neutral">{humanizeCode(appt.status)}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <form action={createAction} className="collab-add-form">
        <input type="hidden" name="missionId" value={missionId} />
        <input
          name="title"
          type="text"
          className="input collab-add-wide"
          placeholder="e.g. Visa interview prep call"
          aria-label="Appointment title"
          required
        />
        <input name="localDate" type="date" className="input" aria-label="Date" required />
        <input name="localTime" type="time" className="input" aria-label="Time" required />
        <TimeZoneSelect name="timezone" className="collab-add-wide" />
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
      <FormMessage result={statusFrom === 'add' ? status : NO_RESULT} />
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
      <p className="card-kicker">Grounded Documents</p>
      <h2 className="card-title">Cover Letters</h2>
      <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '1rem' }}>
        Generated strictly from confirmed, eligible evidence - nothing is invented. Not AI-written;
        deterministic and versioned.
      </p>
      {letters.length === 0 ? (
        <p className="card-body u-mb-100">No letters generated yet.</p>
      ) : (
        <div className="rows u-mb-100">
          {letters.map((letter) => (
            <details key={letter.id}>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-small)' }}>
                Version {letter.version} · {formatTimestampDate(letter.createdAt)}
              </summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 'var(--text-small)',
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
          idle="Generate New Version"
          busy="Generating…"
          className="btn btn-secondary"
        />
      </form>
      {!canGenerate ? (
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginTop: '0.5rem' }}>
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
  // One line for the panel: selecting and removing answer in the same place.
  const [evidenceStatus] = useLatestOf({ select: selectState, unselect: unselectState });
  const multiCandidate = candidates.filter(
    (c) => c.factCandidates.length + c.documentCandidates.length > 1,
  );

  if (multiCandidate.length === 0) return null;

  return (
    <article className="card">
      <p className="card-kicker">Precision</p>
      <h2 className="card-title">Select Evidence</h2>
      <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '1rem' }}>
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
                      <span style={{ fontSize: 'var(--text-small)', flex: 1 }}>
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
                            idle="Selected - Remove"
                            busy="Selected - Remove"
                            className="btn btn-secondary u-btn-xs"
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
                            className="btn btn-secondary u-btn-xs"
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
                      <span style={{ fontSize: 'var(--text-small)', flex: 1 }}>
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
                            idle="Selected - Remove"
                            busy="Selected - Remove"
                            className="btn btn-secondary u-btn-xs"
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
                            className="btn btn-secondary u-btn-xs"
                          />
                        </form>
                      )}
                    </div>
                  );
                })}
          </div>
        ))}
      </div>
      <FormMessage result={evidenceStatus} />
    </article>
  );
}
