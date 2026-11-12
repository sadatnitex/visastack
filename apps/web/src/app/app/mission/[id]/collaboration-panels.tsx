'use client';

import { type ReactNode, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../components/form-feedback';
import { useLocale, useT } from '../../../../components/i18n-provider';
import { useLatestOf } from '../../../../components/latest-result';
import { TimeZoneSelect } from '../../../../components/time-zone-select';
import { StatusPill } from '../../../../components/ui-lift/status-pill';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { humanizeCode } from '../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
import { plural } from '../../../../lib/plural';
import {
  CHOSEN_STATUS,
  FRESHNESS_UNKNOWN_STATUS,
  NOT_ELIGIBLE_STATUS,
  type StatusWord,
  TOO_OLD_STATUS,
} from '../../../../lib/status-words';
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
import { hasSeveralToChoose } from './evidence-several';

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
  rowIdPrefix,
  more,
  finishedTotal,
  finishedOpen = false,
}: {
  readonly missionId: string;
  readonly tasks: readonly TaskView[];
  /** WP-SB2: finished tasks across the whole case, when the page shows only the first rows. */
  readonly finishedTotal?: number;
  /** WP-SB2: open the finished list, for example after Show More added rows to it. */
  readonly finishedOpen?: boolean;
  /** WP-SB2: each row gets the id `<rowIdPrefix>-<index>`, so Show More can land on the first new one. */
  readonly rowIdPrefix?: string;
  /** WP-SB2: the Show More control under the list, when the page capped it. */
  readonly more?: ReactNode;
}) {
  const t = useT(appMissionCatalog);
  const locale = useLocale();
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
      <p className="card-kicker">{t('appMission.appMissionIdCollaborationPanels.checklist')}</p>
      <h2 className="card-title">{t('appMission.appMissionIdCollaborationPanels.tasks')}</h2>
      {openOrInProgress.length === 0 ? (
        <p className="card-body">{t('appMission.appMissionIdCollaborationPanels.noOpenTasks')}</p>
      ) : (
        <div className="rows u-mb-100">
          {openOrInProgress.map((task, index) => (
            <form
              action={decideAction}
              key={task.id}
              className="row task-row"
              id={rowIdPrefix ? `${rowIdPrefix}-${index}` : undefined}
            >
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
                    {t('appMission.appMissionIdCollaborationPanels.inProgress')}
                  </span>
                ) : null}
                {task.addedBy ? (
                  <span className="badge badge-neutral task-added-by">
                    {t('appMission.appMissionIdCollaborationPanels.addedByAddedby', {
                      addedBy: task.addedBy,
                    })}
                  </span>
                ) : null}
                {task.dueDate ? (
                  <span className="muted" style={{ fontSize: 'var(--text-caption)' }}>
                    {t('appMission.appMissionIdCollaborationPanels.dueFormatdateonly', {
                      formatDateOnly: formatDateOnly(task.dueDate, locale),
                    })}
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
        <details className="u-mb-100" open={finishedOpen}>
          <summary className="muted" style={{ fontSize: 'var(--text-small)', cursor: 'pointer' }}>
            {t('appMission.appMissionIdCollaborationPanels.pluralDoneOrCancelled', {
              plural: plural(Math.max(finishedTotal ?? 0, decided.length), 'Task'),
            })}
          </summary>
          <div className="rows u-mt-050">
            {decided.map((task, index) => (
              <div
                className="row"
                key={task.id}
                id={rowIdPrefix ? `${rowIdPrefix}-${openOrInProgress.length + index}` : undefined}
              >
                <span className="row-key" style={{ textDecoration: 'line-through' }}>
                  {task.description}
                </span>
                <span className="badge badge-neutral">{humanizeCode(task.status)}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {more}

      <form action={createAction} className="collab-add-form">
        <input type="hidden" name="missionId" value={missionId} />
        <input
          name="description"
          type="text"
          className="input collab-add-wide"
          placeholder={t('appMission.appMissionIdCollaborationPanels.addATask')}
          aria-label={t('appMission.appMissionIdCollaborationPanels.taskDescription')}
          required
        />
        <select
          name="priority"
          className="input"
          defaultValue="NORMAL"
          aria-label={t('appMission.appMissionIdCollaborationPanels.priority')}
        >
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
          aria-label={t('appMission.appMissionIdCollaborationPanels.dueDateOptional')}
        />
        <TimeZoneSelect
          name="dueTimezone"
          label={t('appMission.appMissionIdCollaborationPanels.dueTimeZoneOptional')}
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
  const t = useT(appMissionCatalog);
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
      <p className="card-kicker">{t('appMission.appMissionIdCollaborationPanels.meetings')}</p>
      <h2 className="card-title">{t('appMission.appMissionIdCollaborationPanels.appointments')}</h2>
      {upcoming.length === 0 ? (
        <p className="card-body u-mb-100">
          {t('appMission.appMissionIdCollaborationPanels.noAppointmentsScheduled')}
        </p>
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
                  {t('appMission.appMissionIdCollaborationPanels.addToCalendar')}
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
            {t('appMission.appMissionIdCollaborationPanels.lengthPast', {
              length: past.length,
            })}
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
          placeholder={t('appMission.appMissionIdCollaborationPanels.eGVisaInterviewPrepCall')}
          aria-label={t('appMission.appMissionIdCollaborationPanels.appointmentTitle')}
          required
        />
        <input
          name="localDate"
          type="date"
          className="input"
          aria-label={t('appMission.appMissionIdCollaborationPanels.date')}
          required
        />
        <input
          name="localTime"
          type="time"
          className="input"
          aria-label={t('appMission.appMissionIdCollaborationPanels.time')}
          required
        />
        <TimeZoneSelect name="timezone" className="collab-add-wide" />
        <input
          name="place"
          type="text"
          className="input"
          placeholder={t('appMission.appMissionIdCollaborationPanels.placeOptional')}
          aria-label={t('appMission.appMissionIdCollaborationPanels.place')}
        />
        <input
          name="channel"
          type="text"
          className="input"
          placeholder={t('appMission.appMissionIdCollaborationPanels.channelEGVideoCallOptional')}
          aria-label={t('appMission.appMissionIdCollaborationPanels.channel')}
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
  finishedLine,
}: {
  readonly missionId: string;
  readonly letters: readonly LetterView[];
  readonly canGenerate: boolean;
  /** Set on a finished case: no new version can be made, and this line says why. */
  readonly finishedLine?: string;
}) {
  const t = useT(appMissionCatalog);
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(generateLetterAction, INITIAL);
  return (
    <article className="card">
      <p className="card-kicker">
        {t('appMission.appMissionIdCollaborationPanels.groundedDocuments')}
      </p>
      <h2 className="card-title">{t('appMission.appMissionIdCollaborationPanels.coverLetters')}</h2>
      <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '1rem' }}>
        {t(
          'appMission.appMissionIdCollaborationPanels.generatedStrictlyFromConfirmedEligibleEvidence',
        )}
      </p>
      {letters.length === 0 ? (
        <p className="card-body u-mb-100">
          {t('appMission.appMissionIdCollaborationPanels.noLettersGeneratedYet')}
        </p>
      ) : (
        <div className="rows u-mb-100">
          {letters.map((letter) => (
            <details key={letter.id}>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-small)' }}>
                {t('appMission.appMissionIdCollaborationPanels.versionVersionFormattimestampdate', {
                  version: letter.version,
                  formatTimestampDate: formatTimestampDate(letter.createdAt, locale),
                })}
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
      {finishedLine ? (
        <p className="muted u-fs-085 u-m-0">{finishedLine}</p>
      ) : (
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
      )}
      {!finishedLine && !canGenerate ? (
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginTop: '0.5rem' }}>
          {t('appMission.appMissionIdCollaborationPanels.nothingEligibleToGroundALetter')}
        </p>
      ) : null}
      <FormMessage result={state} />
    </article>
  );
}

export interface CandidateView {
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
    /** Lane Z: "Archived", "Replaced" or "Removed by the traveller on 3 Nov"; null when current. */
    readonly lifecycleLabel?: string | null;
  }>;
  readonly selectedFactIds: readonly string[];
  readonly selectedDocumentIds: readonly string[];
  /** Keyed by `composeSelectionCandidateKey` (evidence-selection-key.ts) - finding #33. */
  readonly selectionIdsByCandidate: Readonly<Record<string, string>>;
}

type EvidenceAction = (formData: FormData) => void;

/** One row's own button: busy only while this row's form is being sent, with words that say what it does. */
function RowSubmit({
  idle,
  busy,
  label,
}: {
  readonly idle: string;
  readonly busy: string;
  readonly label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <SubmitButton
      pending={pending}
      idle={idle}
      busy={busy}
      label={label}
      className="btn btn-secondary u-btn-xs"
    />
  );
}

/** A small status chip beside a file's name, from the one chip vocabulary. */
function FileChip({ status }: { readonly status: StatusWord }) {
  return (
    <span className="lp-choice-chip">
      <StatusPill tone={status.tone}>{status.word}</StatusPill>
    </span>
  );
}

/** One item's files, each with Select or Selected - Remove, drawn with the actions it is given. */
function CandidateRows({
  missionId,
  candidate: c,
  selectAction,
  unselectAction,
  editable = true,
}: {
  readonly missionId: string;
  readonly candidate: CandidateView;
  readonly selectAction: EvidenceAction;
  readonly unselectAction: EvidenceAction;
  /** The case is open. When it is not, the files are listed with the chosen one marked, and no buttons. */
  readonly editable?: boolean;
}) {
  const t = useT(appMissionCatalog);
  const choice = (
    id: string,
    kind: 'fact' | 'document',
    name: string,
    chips: ReactNode,
    selected: boolean,
  ) => {
    const selectionId =
      c.selectionIdsByCandidate[composeSelectionCandidateKey(c.packRequirementId, id)];
    return (
      <div key={id} className="lp-choice">
        <span className="lp-choice-label">
          {name}
          {chips}
        </span>
        {!editable ? (
          selected ? (
            <FileChip status={CHOSEN_STATUS} />
          ) : null
        ) : selected && selectionId ? (
          <form action={unselectAction}>
            <input type="hidden" name="missionId" value={missionId} />
            <input type="hidden" name="selectionId" value={selectionId} />
            <RowSubmit
              idle="Selected - Remove"
              busy="Removing…"
              label={t('appMission.appMissionIdCollaborationPanels.selectedRemoveName', { name })}
            />
          </form>
        ) : (
          <form action={selectAction}>
            <input type="hidden" name="missionId" value={missionId} />
            <input type="hidden" name="packRequirementId" value={c.packRequirementId} />
            <input type="hidden" name={kind === 'fact' ? 'factId' : 'documentId'} value={id} />
            <RowSubmit
              idle="Select"
              busy="Choosing…"
              label={t('appMission.appMissionIdCollaborationPanels.selectName', { name })}
            />
          </form>
        )}
      </div>
    );
  };
  return c.kind === 'FIELD'
    ? c.factCandidates.map((fact) =>
        choice(
          fact.factId,
          'fact',
          `${fact.value || 'This answer'}${fact.repeatingRecordKey ? ` (${fact.repeatingRecordKey})` : ''}`,
          fact.eligible ? null : <FileChip status={NOT_ELIGIBLE_STATUS} />,
          c.selectedFactIds.includes(fact.factId),
        ),
      )
    : c.documentCandidates.map((doc) =>
        choice(
          doc.documentId,
          'document',
          doc.displayName,
          <>
            {doc.eligible ? null : <FileChip status={NOT_ELIGIBLE_STATUS} />}
            {doc.staleness === 'stale' ? <FileChip status={TOO_OLD_STATUS} /> : null}
            {doc.staleness === 'unknown' ? <FileChip status={FRESHNESS_UNKNOWN_STATUS} /> : null}
            {doc.lifecycleLabel ? (
              <span className="lp-choice-chip">
                <StatusPill tone="neutral">{doc.lifecycleLabel}</StatusPill>
              </span>
            ) : null}
          </>,
          c.selectedDocumentIds.includes(doc.documentId),
        ),
      );
}

/**
 * One item's own choice of which file counts, with its own state, so the panel of one item never
 * shares a form result with another (the all-items panel below shares one on purpose).
 */
export function EvidenceItemChoices({
  missionId,
  candidate,
}: {
  readonly missionId: string;
  readonly candidate: CandidateView;
}) {
  const [selectState, selectAction] = useActionState(selectEvidenceAction, INITIAL);
  const [unselectState, unselectAction] = useActionState(unselectEvidenceAction, INITIAL);
  const [status] = useLatestOf({ select: selectState, unselect: unselectState });
  return (
    <div className="rows">
      <CandidateRows
        missionId={missionId}
        candidate={candidate}
        selectAction={selectAction}
        unselectAction={unselectAction}
      />
      <FormMessage result={status} />
    </div>
  );
}

export function EvidenceSelectionPanel({
  missionId,
  candidates,
  editable = true,
}: {
  readonly missionId: string;
  readonly candidates: readonly CandidateView[];
  /** The case is open, so the choice can still change. */
  readonly editable?: boolean;
}) {
  const t = useT(appMissionCatalog);
  const [selectState, selectAction] = useActionState(selectEvidenceAction, INITIAL);
  const [unselectState, unselectAction] = useActionState(unselectEvidenceAction, INITIAL);
  // One line for the panel: selecting and removing answer in the same place.
  const [evidenceStatus] = useLatestOf({ select: selectState, unselect: unselectState });
  const multiCandidate = candidates.filter(hasSeveralToChoose);

  if (multiCandidate.length === 0) return null;

  return (
    <article className="card">
      <p className="card-kicker">{t('appMission.appMissionIdCollaborationPanels.precision')}</p>
      <h2 className="card-title">
        {t('appMission.appMissionIdCollaborationPanels.selectEvidence')}
      </h2>
      <p className="muted lp-choice-intro">
        {t('appMission.appMissionIdCollaborationPanels.moreThanOneInstanceIsOn')}
      </p>
      <div className="rows">
        {multiCandidate.map((c) => (
          <div key={c.packRequirementId} className="lp-choice-group">
            <span className="row-key">{c.label}</span>
            <CandidateRows
              missionId={missionId}
              candidate={c}
              selectAction={selectAction}
              unselectAction={unselectAction}
              editable={editable}
            />
          </div>
        ))}
      </div>
      <FormMessage result={evidenceStatus} />
    </article>
  );
}
