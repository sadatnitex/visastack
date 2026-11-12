'use client';

import { type ComponentProps, type ReactNode, useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { atLevel, revealAt } from '../../../../components/depth';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { useLatestOf } from '../../../../components/latest-result';
import { ReferenceCode } from '../../../../components/reference-code';
import { TimeZoneSelect } from '../../../../components/time-zone-select';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
import { reviewDecisionLabel } from '../../../../lib/labels';
import {
  type ActionState,
  addNoteAction,
  assignMemberAction,
  createAppointmentForOrgAction,
  createTaskForOrgAction,
  decideAppointmentForOrgAction,
  decideTaskForOrgAction,
  recordDecisionAction,
  recordIssuerVerificationAction,
  unassignMemberAction,
  updateTaskForOrgAction,
} from './actions';
import { caseAnchorId } from './case-anchor';
import type { CaseTriageView } from './case-triage';
import { CaseTriageSummary } from './case-triage-summary';
import { NeedsYouText } from './needs-you-text';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * A submit button that is busy only while its own form is sending. A row button that changes its
 * wording while busy must not share one flag across rows: pressing Remove for one member would
 * make every row read "Removing" and drop every row's name.
 */
function RowSubmitButton(props: Omit<ComponentProps<typeof SubmitButton>, 'pending'>) {
  const { pending } = useFormStatus();
  return <SubmitButton pending={pending} {...props} />;
}

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

interface MemberOption {
  readonly accountId: string;
  readonly email: string;
}

interface AssignmentView {
  readonly id: string;
  readonly memberAccountId: string;
  readonly memberEmail: string;
}

interface NoteView {
  readonly id: string;
  readonly body: string;
  readonly authorEmail: string;
  readonly createdAt: string;
  readonly visibility: 'AGENCY_INTERNAL' | 'TRAVELLER_SHARED';
}

interface OrgTaskView {
  readonly id: string;
  readonly description: string;
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  readonly priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  readonly assigneeAccountId: string | null;
  readonly dueDate: string | null;
}

interface OrgAppointmentView {
  readonly id: string;
  readonly title: string;
  readonly localDateTime: string;
  readonly timezone: string;
  readonly place: string | null;
  readonly channel: string | null;
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
}

interface RequirementOption {
  readonly id: string;
  readonly label: string;
}

interface DecisionView {
  readonly id: string;
  readonly packRequirementId: string;
  readonly outcome: 'ACCEPTED' | 'REJECTED';
  readonly reason: string | null;
  readonly createdAt: string;
}

/** EVI-05, tier E3 ("issuer confirmed"): a requirement can carry more than one over time. */
interface IssuerVerificationView {
  readonly id: string;
  readonly packRequirementId: string;
  readonly issuerIdentity: string;
  readonly exactClaim: string;
  readonly response: string;
  readonly validUntil: string;
  readonly expired: boolean;
}

interface MissionCollaborationProps {
  readonly organizationId: string;
  readonly missionId: string;
  readonly applicantId: string;
  readonly title: string;
  /** The case's visible code (ADR 0018), when it has one. */
  readonly referenceCode?: string;
  readonly applicantName: string;
  /** The case's destination as flag and written country, drawn on the server (it is server-only). */
  readonly destinationLabel?: ReactNode;
  readonly members: readonly MemberOption[];
  readonly assignments: readonly AssignmentView[];
  readonly notes: readonly NoteView[];
  readonly tasks: readonly OrgTaskView[];
  readonly appointments: readonly OrgAppointmentView[];
  readonly requirements: readonly RequirementOption[];
  readonly decisions: readonly DecisionView[];
  readonly issuerVerifications: readonly IssuerVerificationView[];
  /** Only an assigned member can record a decision — self-attestation by the applicant is never allowed. */
  readonly viewerAssigned: boolean;
  /** Where the case stands in the E02 groups (WP-V4), already in words. */
  readonly triage?: CaseTriageView;
  /** What on this case waits for the viewer, in words (CCD-6): shown only at Glance. */
  readonly needsYou?: string;
  /** The count of items to review inside `needsYou`, and the request it leads to (friction E4). */
  readonly needsYouReview?: { readonly phrase: string; readonly href: string };
  /** WP-SB5: the end of the notes list (how many show, Show More), placed right under the notes. */
  readonly notesMore?: ReactNode;
  /** Asking this traveller for a document or detail, for an administrator only (the page decides). */
  readonly ask?: ReactNode;
}

export function MissionCollaboration({
  organizationId,
  missionId,
  applicantId,
  title,
  referenceCode,
  applicantName,
  destinationLabel,
  members,
  assignments,
  notes,
  notesMore,
  tasks,
  appointments,
  requirements,
  decisions,
  issuerVerifications,
  viewerAssigned,
  triage,
  needsYou,
  needsYouReview,
  ask,
}: MissionCollaborationProps) {
  const t = useT(appAgencyCatalog);
  const [noteState, noteAction, notePending] = useActionState(addNoteAction, INITIAL);
  const [assignState, assignAction, assignPending] = useActionState(assignMemberAction, INITIAL);
  const [unassignState, unassignAction] = useActionState(unassignMemberAction, INITIAL);
  const [taskCreateState, taskCreateAction, taskCreatePending] = useActionState(
    createTaskForOrgAction,
    INITIAL,
  );
  const [taskDecideState, taskDecideAction, taskDecidePending] = useActionState(
    decideTaskForOrgAction,
    INITIAL,
  );
  const [taskReassignState, taskReassignAction] = useActionState(updateTaskForOrgAction, INITIAL);
  const [apptCreateState, apptCreateAction, apptCreatePending] = useActionState(
    createAppointmentForOrgAction,
    INITIAL,
  );
  const [apptDecideState, apptDecideAction, apptDecidePending] = useActionState(
    decideAppointmentForOrgAction,
    INITIAL,
  );
  const [decisionState, decisionAction, decisionPending] = useActionState(
    recordDecisionAction,
    INITIAL,
  );
  const [issuerState, issuerAction, issuerPending] = useActionState(
    recordIssuerVerificationAction,
    INITIAL,
  );
  // One status line per area (people, tasks, appointments): the latest answer replaces the last.
  // Task and appointment lines sit by the button pressed: below the list for an action on a row,
  // below the form for Add. Both places stay in the page, empty when unused.
  const [peopleStatus] = useLatestOf({ assign: assignState, unassign: unassignState });
  const [taskStatus, taskFrom] = useLatestOf({
    add: taskCreateState,
    decide: taskDecideState,
    reassign: taskReassignState,
  });
  const [appointmentStatus, appointmentFrom] = useLatestOf({
    add: apptCreateState,
    decide: apptDecideState,
  });
  // Each case on the page has its own copy of these forms, so every field id is made per copy.
  const uid = useId();
  const assignedAccountIds = new Set(assignments.map((a) => a.memberAccountId));
  const assignableMembers = members.filter((m) => !assignedAccountIds.has(m.accountId));
  const memberEmailByAccountId = new Map(members.map((m) => [m.accountId, m.email] as const));
  const openTasks = tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const upcomingAppointments = appointments.filter(
    (a) => a.status === 'OPEN' || a.status === 'IN_PROGRESS',
  );

  return (
    // The row shows at Glance; a link to it (from Agency Overview) opens the whole case.
    <div
      id={caseAnchorId(missionId)}
      {...revealAt('everything')}
      style={{
        padding: '0.85rem',
        border: '1px solid var(--hairline-soft)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span className="row-key case-work-title">{title}</span>
        <span className="muted u-fs-085">{applicantName}</span>
      </div>
      {destinationLabel ? <p className="muted u-fs-085">{destinationLabel}</p> : null}
      <ReferenceCode
        code={referenceCode}
        label={t('appAgency.appAgencyOrgidMissionCollaboration.caseReference')}
      />
      {needsYou ? (
        <p className="muted u-fs-085" data-only="glance">
          <NeedsYouText text={needsYou} review={needsYouReview} />
        </p>
      ) : null}

      {triage ? (
        <div {...atLevel('browse')}>
          <CaseTriageSummary view={triage} headingId={`triage-${missionId}`} />
        </div>
      ) : null}

      {ask ? (
        <div id={`ask-${missionId}`} style={{ marginTop: '0.6rem' }} {...atLevel('browse')}>
          {ask}
        </div>
      ) : null}

      <div id={`assigned-${missionId}`} style={{ marginTop: '0.6rem' }} {...atLevel('browse')}>
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          {t.node('appAgency.appAgencyOrgidMissionCollaboration.assigned')}
        </p>
        {assignments.length === 0 ? (
          <p className="muted u-fs-085">
            {t.node('appAgency.appAgencyOrgidMissionCollaboration.nobodyAssignedYet')}
          </p>
        ) : (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            {assignments.map((a) => (
              <form
                action={unassignAction}
                key={a.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="missionId" value={missionId} />
                <input type="hidden" name="memberAccountId" value={a.memberAccountId} />
                <span className="badge badge-neutral">{a.memberEmail}</span>
                <RowSubmitButton
                  idle="Remove"
                  busy="Removing…"
                  label={t('appAgency.appAgencyOrgidMissionCollaboration.removeMemberemail', {
                    memberEmail: a.memberEmail,
                  })}
                  className="btn btn-secondary"
                  style={{ padding: '0.1rem 0.5rem', fontSize: 'var(--text-caption)' }}
                />
              </form>
            ))}
          </div>
        )}
        {assignableMembers.length > 0 ? (
          <form action={assignAction} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="missionId" value={missionId} />
            <select
              name="memberAccountId"
              aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.memberToAssign')}
              className="input"
              required
              defaultValue=""
            >
              <option
                {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.assignAMember')}
                value=""
                disabled
              >
                {t('appAgency.appAgencyOrgidMissionCollaboration.assignAMember')}
              </option>
              {assignableMembers.map((m) => (
                <option key={m.accountId} value={m.accountId}>
                  {m.email}
                </option>
              ))}
            </select>
            <SubmitButton
              pending={assignPending}
              idle="Assign"
              busy="Assigning…"
              className="btn btn-secondary u-btn-sm"
            />
          </form>
        ) : null}
        <FormMessage result={peopleStatus} />
      </div>

      <div id={`tasks-${missionId}`} style={{ marginTop: '0.85rem' }} {...atLevel('everything')}>
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          {t.node('appAgency.appAgencyOrgidMissionCollaboration.tasks')}
        </p>
        {openTasks.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
            {t.node('appAgency.appAgencyOrgidMissionCollaboration.noOpenTasks')}
          </p>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              marginBottom: '0.5rem',
            }}
          >
            {openTasks.map((t) => (
              <div key={t.id} className="u-fs-085">
                <span>{t.description}</span>{' '}
                <span className="badge badge-neutral" style={{ fontSize: 'var(--text-caption)' }}>
                  {PRIORITY_LABELS[t.priority] ?? t.priority}
                </span>{' '}
                <span className="muted u-fs-075">
                  {t.assigneeAccountId
                    ? (memberEmailByAccountId.get(t.assigneeAccountId) ?? 'unknown')
                    : 'unassigned'}
                  {t.dueDate ? `, due ${formatDateOnly(t.dueDate)}` : ''}
                </span>
                <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem' }}>
                  <form action={taskReassignAction} style={{ display: 'flex', gap: '0.3rem' }}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="missionId" value={missionId} />
                    <input type="hidden" name="taskId" value={t.id} />
                    <select
                      name="assigneeAccountId"
                      className="input"
                      defaultValue={t.assigneeAccountId ?? ''}
                      aria-label="Reassign task"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.accountId} value={m.accountId}>
                          {m.email}
                        </option>
                      ))}
                    </select>
                    <RowSubmitButton
                      idle="Reassign"
                      busy="Reassigning…"
                      className="btn btn-secondary"
                      style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--text-caption)' }}
                    />
                  </form>
                  <form action={taskDecideAction} style={{ display: 'flex', gap: '0.3rem' }}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="missionId" value={missionId} />
                    <input type="hidden" name="taskId" value={t.id} />
                    {t.status === 'OPEN' ? (
                      <SubmitButton
                        pending={taskDecidePending}
                        idle="Start"
                        busy="Start"
                        className="btn btn-secondary"
                        style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--text-caption)' }}
                        name="status"
                        value="IN_PROGRESS"
                      />
                    ) : null}
                    <SubmitButton
                      pending={taskDecidePending}
                      idle="Done"
                      busy="Done"
                      className="btn btn-secondary"
                      style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--text-caption)' }}
                      name="status"
                      value="DONE"
                    />
                    <SubmitButton
                      pending={taskDecidePending}
                      idle="Cancel"
                      busy="Cancel"
                      className="btn btn-secondary"
                      style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--text-caption)' }}
                      name="status"
                      value="CANCELLED"
                    />
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
        <FormMessage result={taskFrom === 'add' ? NO_RESULT : taskStatus} />
        <form action={taskCreateAction} className="field-list form-narrow">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="missionId" value={missionId} />
          <div className="form-grid">
            <div className="field-row field-wide">
              <label className="field-label" htmlFor={`${uid}-task-description`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.taskDescription')}
              </label>
              <input
                id={`${uid}-task-description`}
                name="description"
                type="text"
                className="input"
                placeholder={t('appAgency.appAgencyOrgidMissionCollaboration.addATask')}
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.taskDescription9f2652')}
                required
              />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-task-assignee`}>
                {t.node('appAgency.appAgencyOrgidCaseSearchForm.assignee')}
              </label>
              <select
                id={`${uid}-task-assignee`}
                name="assigneeAccountId"
                className="input"
                defaultValue=""
                aria-label={t('appAgency.appAgencyOrgidCaseSearchForm.assignee')}
              >
                <option
                  {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.unassigned')}
                  value=""
                >
                  {t('appAgency.appAgencyOrgidMissionCollaboration.unassigned')}
                </option>
                {members.map((m) => (
                  <option key={m.accountId} value={m.accountId}>
                    {m.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-task-priority`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.priority')}
              </label>
              <select
                id={`${uid}-task-priority`}
                name="priority"
                className="input"
                defaultValue="NORMAL"
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.priority')}
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-task-due`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.dueDateOptional')}
              </label>
              <input
                id={`${uid}-task-due`}
                name="dueDate"
                type="date"
                className="input"
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.dueDateOptional')}
              />
            </div>
          </div>
          <div>
            <SubmitButton
              pending={taskCreatePending}
              idle="Add"
              busy="Adding…"
              className="btn btn-secondary u-btn-sm"
            />
          </div>
        </form>
        <FormMessage result={taskFrom === 'add' ? taskStatus : NO_RESULT} />
      </div>

      <div
        id={`appointments-${missionId}`}
        style={{ marginTop: '0.85rem' }}
        {...atLevel('everything')}
      >
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          {t.node('appAgency.appAgencyOrgidMissionCollaboration.appointments')}
        </p>
        {upcomingAppointments.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
            {t.node('appAgency.appAgencyOrgidMissionCollaboration.noAppointmentsScheduled')}
          </p>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              marginBottom: '0.5rem',
            }}
          >
            {upcomingAppointments.map((a) => (
              <div key={a.id} className="u-fs-085">
                <span>{a.title}</span>{' '}
                <span className="muted u-fs-075">
                  {new Date(a.localDateTime).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  ({a.timezone}){a.place ? ` · ${a.place}` : ''}
                  {a.channel ? ` · ${a.channel}` : ''}
                </span>
                <form
                  action={apptDecideAction}
                  style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem' }}
                >
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="missionId" value={missionId} />
                  <input type="hidden" name="appointmentId" value={a.id} />
                  <SubmitButton
                    pending={apptDecidePending}
                    idle="Done"
                    busy="Done"
                    className="btn btn-secondary"
                    style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--text-caption)' }}
                    name="status"
                    value="DONE"
                  />
                  <SubmitButton
                    pending={apptDecidePending}
                    idle="Cancel"
                    busy="Cancel"
                    className="btn btn-secondary"
                    style={{ padding: '0.15rem 0.5rem', fontSize: 'var(--text-caption)' }}
                    name="status"
                    value="CANCELLED"
                  />
                </form>
              </div>
            ))}
          </div>
        )}
        <FormMessage result={appointmentFrom === 'add' ? NO_RESULT : appointmentStatus} />
        <form action={apptCreateAction} className="field-list form-narrow">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="missionId" value={missionId} />
          <div className="form-grid">
            <div className="field-row field-wide">
              <label className="field-label" htmlFor={`${uid}-appt-title`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.appointmentTitle')}
              </label>
              <input
                id={`${uid}-appt-title`}
                name="title"
                type="text"
                className="input"
                placeholder={t(
                  'appAgency.appAgencyOrgidMissionCollaboration.eGVisaInterviewPrepCall',
                )}
                aria-label={t(
                  'appAgency.appAgencyOrgidMissionCollaboration.appointmentTitle1de530',
                )}
                required
              />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-appt-date`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.date')}
              </label>
              <input
                id={`${uid}-appt-date`}
                name="localDate"
                type="date"
                className="input"
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.date')}
                required
              />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-appt-time`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.time')}
              </label>
              <input
                id={`${uid}-appt-time`}
                name="localTime"
                type="time"
                className="input"
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.time')}
                required
              />
            </div>
            <div className="field-row">
              {/* The list carries its own name ("Time Zone") and its own id, so this caption is
                  only seen, not read out a second time. */}
              <label className="field-label" htmlFor={`${uid}-appt-timezone`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.timeZone')}
              </label>
              <TimeZoneSelect id={`${uid}-appt-timezone`} name="timezone" />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-appt-place`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.place')}
              </label>
              <input
                id={`${uid}-appt-place`}
                name="place"
                type="text"
                className="input"
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.place')}
              />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-appt-channel`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.channel')}
              </label>
              <input
                id={`${uid}-appt-channel`}
                name="channel"
                type="text"
                className="input"
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.channel')}
              />
            </div>
          </div>
          <div>
            <SubmitButton
              pending={apptCreatePending}
              idle="Schedule"
              busy="Scheduling…"
              className="btn btn-secondary u-btn-sm"
            />
          </div>
        </form>
        <FormMessage result={appointmentFrom === 'add' ? appointmentStatus : NO_RESULT} />
      </div>

      <div id={`notes-${missionId}`} style={{ marginTop: '0.85rem' }} {...atLevel('everything')}>
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          {t.node('appAgency.appAgencyOrgidMissionCollaboration.notes')}
        </p>
        {notes.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
            {t.node('appAgency.appAgencyOrgidMissionCollaboration.noNotesYet')}
          </p>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              marginBottom: '0.5rem',
            }}
          >
            {notes.map((n) => (
              <div key={n.id} className="u-fs-085">
                <span
                  className={`badge ${n.visibility === 'AGENCY_INTERNAL' ? 'badge-warning' : 'badge-success'}`}
                  style={{ fontSize: 'var(--text-caption)', marginRight: '0.35rem' }}
                >
                  {n.visibility === 'AGENCY_INTERNAL'
                    ? t.node('appAgency.appAgencyOrgidMissionCollaboration.internal')
                    : t.node('appAgency.appAgencyOrgidMissionCollaboration.sharedWithTraveller')}
                </span>
                <span>{n.body}</span>{' '}
                <span className="muted u-fs-075">
                  - {n.authorEmail}, {formatTimestampDate(n.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
        {notesMore}
        <form action={noteAction} className="field-list form-narrow">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="missionId" value={missionId} />
          <div className="form-grid">
            <div className="field-row field-wide">
              <label className="field-label" htmlFor={`${uid}-note-body`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.caseNote')}
              </label>
              <input
                id={`${uid}-note-body`}
                name="body"
                type="text"
                className="input"
                placeholder={t('appAgency.appAgencyOrgidMissionCollaboration.addACaseNote')}
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.caseNotea939f0')}
                required
              />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${uid}-note-visibility`}>
                {t.node('appAgency.appAgencyOrgidMissionCollaboration.visibility')}
              </label>
              <select
                id={`${uid}-note-visibility`}
                name="visibility"
                className="input"
                required
                defaultValue=""
                aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.noteVisibility')}
              >
                <option
                  {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.visibilityb5de1d')}
                  value=""
                  disabled
                >
                  {t('appAgency.appAgencyOrgidMissionCollaboration.visibilityb5de1d')}
                </option>
                <option
                  {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.internalThisOrgOnly')}
                  value="AGENCY_INTERNAL"
                >
                  {t('appAgency.appAgencyOrgidMissionCollaboration.internalThisOrgOnly')}
                </option>
                <option
                  {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.sharedWithTraveller')}
                  value="TRAVELLER_SHARED"
                >
                  {t('appAgency.appAgencyOrgidMissionCollaboration.sharedWithTraveller')}
                </option>
              </select>
            </div>
          </div>
          <div>
            <SubmitButton
              pending={notePending}
              idle="Add"
              busy="Adding…"
              className="btn btn-secondary u-btn-sm"
            />
          </div>
        </form>
        <FormMessage result={noteState} />
      </div>

      {requirements.length > 0 ? (
        <div
          id={`decisions-${missionId}`}
          style={{ marginTop: '0.85rem' }}
          {...atLevel('everything')}
        >
          <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
            {t.node('appAgency.appAgencyOrgidMissionCollaboration.decisions')}
          </p>
          {decisions.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
              {t.node('appAgency.appAgencyOrgidMissionCollaboration.noDecisionsRecordedYet')}
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                marginBottom: '0.5rem',
              }}
            >
              {decisions.map((d) => (
                <div key={d.id} className="u-fs-085">
                  <span
                    className={`badge ${d.outcome === 'ACCEPTED' ? 'badge-success' : 'badge-danger'}`}
                  >
                    {reviewDecisionLabel(d.outcome)}
                  </span>{' '}
                  <span className="muted u-fs-075">
                    {requirements.find((r) => r.id === d.packRequirementId)?.label ??
                      d.packRequirementId}
                    {d.reason ? ` - ${d.reason}` : ''}, {formatTimestampDate(d.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {viewerAssigned ? (
            <form action={decisionAction} className="field-list form-narrow">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="missionId" value={missionId} />
              <div className="form-grid">
                <div className="field-row">
                  <label className="field-label" htmlFor={`${uid}-decision-requirement`}>
                    {t.node('appAgency.appAgencyOrgidMissionCollaboration.requirement')}
                  </label>
                  <select
                    id={`${uid}-decision-requirement`}
                    name="packRequirementId"
                    aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.requirement')}
                    className="input"
                    required
                    defaultValue=""
                  >
                    <option
                      {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.requirementf6daff')}
                      value=""
                      disabled
                    >
                      {t('appAgency.appAgencyOrgidMissionCollaboration.requirementf6daff')}
                    </option>
                    {requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-row">
                  <label className="field-label" htmlFor={`${uid}-decision-outcome`}>
                    {t.node('appAgency.appAgencyOrgidMissionCollaboration.decision')}
                  </label>
                  <select
                    id={`${uid}-decision-outcome`}
                    name="outcome"
                    aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.decision')}
                    className="input"
                    defaultValue="ACCEPTED"
                  >
                    <option
                      {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.accept')}
                      value="ACCEPTED"
                    >
                      {t('appAgency.appAgencyOrgidMissionCollaboration.accept')}
                    </option>
                    <option
                      {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.reject')}
                      value="REJECTED"
                    >
                      {t('appAgency.appAgencyOrgidMissionCollaboration.reject')}
                    </option>
                  </select>
                </div>
                <div className="field-row">
                  <label className="field-label" htmlFor={`${uid}-decision-reason`}>
                    {t.node('appAgency.appAgencyOrgidMissionCollaboration.reasonOptional')}
                  </label>
                  <input
                    id={`${uid}-decision-reason`}
                    name="reason"
                    type="text"
                    className="input"
                    aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.decisionReason')}
                  />
                </div>
              </div>
              <div>
                <SubmitButton
                  pending={decisionPending}
                  idle="Record"
                  busy="Recording…"
                  className="btn btn-secondary u-btn-sm"
                />
              </div>
            </form>
          ) : (
            <p className="muted" style={{ fontSize: 'var(--text-caption)' }}>
              {t.node('appAgency.appAgencyOrgidMissionCollaboration.onlyAnAssignedMemberCanRecord')}
            </p>
          )}
          <FormMessage result={decisionState} />
        </div>
      ) : null}

      {requirements.length > 0 ? (
        <div
          id={`issuer-confirmations-${missionId}`}
          style={{ marginTop: '0.85rem' }}
          {...atLevel('everything')}
        >
          <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
            {t.node('appAgency.appAgencyOrgidMissionCollaboration.issuerConfirmations')}
          </p>
          {issuerVerifications.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
              {t.node('appAgency.appAgencyOrgidMissionCollaboration.noIssuerConfirmedYetLackOf')}
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                marginBottom: '0.5rem',
              }}
            >
              {issuerVerifications.map((v) => (
                <div key={v.id} className="u-fs-085">
                  <span className={`badge ${v.expired ? 'badge-neutral' : 'badge-success'}`}>
                    {v.expired
                      ? t.node('appAgency.appAgencyOrgidMissionCollaboration.expired')
                      : t.node('appAgency.appAgencyOrgidMissionCollaboration.confirmed')}
                  </span>{' '}
                  <span className="muted u-fs-075">
                    {requirements.find((r) => r.id === v.packRequirementId)?.label ??
                      v.packRequirementId}
                    : {v.issuerIdentity}, "{v.exactClaim}", valid until{' '}
                    {formatTimestampDate(v.validUntil)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <form action={issuerAction} className="field-list form-narrow">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="missionId" value={missionId} />
            <input type="hidden" name="applicantId" value={applicantId} />
            <div className="form-grid">
              <div className="field-row">
                <label className="field-label" htmlFor={`${uid}-issuer-requirement`}>
                  {t.node('appAgency.appAgencyOrgidMissionCollaboration.requirement')}
                </label>
                <select
                  id={`${uid}-issuer-requirement`}
                  name="packRequirementId"
                  className="input"
                  required
                  defaultValue=""
                  aria-label={t(
                    'appAgency.appAgencyOrgidMissionCollaboration.requirementThisConfirmationCovers',
                  )}
                >
                  <option
                    {...t.lang('appAgency.appAgencyOrgidMissionCollaboration.requirementf6daff')}
                    value=""
                    disabled
                  >
                    {t('appAgency.appAgencyOrgidMissionCollaboration.requirementf6daff')}
                  </option>
                  {requirements.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <label className="field-label" htmlFor={`${uid}-issuer-identity`}>
                  {t.node('appAgency.appAgencyOrgidMissionCollaboration.issuer')}
                </label>
                <input
                  id={`${uid}-issuer-identity`}
                  name="issuerIdentity"
                  type="text"
                  className="input"
                  placeholder={t('appAgency.appAgencyOrgidMissionCollaboration.eGHmPassportOffice')}
                  aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.issuerIdentity')}
                  required
                />
              </div>
              <div className="field-row">
                <label className="field-label" htmlFor={`${uid}-issuer-contact`}>
                  {t.node('appAgency.appAgencyOrgidMissionCollaboration.contactMethod')}
                </label>
                <input
                  id={`${uid}-issuer-contact`}
                  name="contactMethod"
                  type="text"
                  className="input"
                  placeholder={t('appAgency.appAgencyOrgidMissionCollaboration.eGPhone44')}
                  aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.contactMethoda30e73')}
                  required
                />
              </div>
              <div className="field-row">
                <label className="field-label" htmlFor={`${uid}-issuer-claim`}>
                  {t.node('appAgency.appAgencyOrgidMissionCollaboration.exactClaim')}
                </label>
                <input
                  id={`${uid}-issuer-claim`}
                  name="exactClaim"
                  type="text"
                  className="input"
                  placeholder={t(
                    'appAgency.appAgencyOrgidMissionCollaboration.exactClaimConfirmed',
                  )}
                  aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.exactClaim9528fc')}
                  required
                />
              </div>
              <div className="field-row">
                <label className="field-label" htmlFor={`${uid}-issuer-response`}>
                  {t.node('appAgency.appAgencyOrgidMissionCollaboration.issuerResponse')}
                </label>
                <input
                  id={`${uid}-issuer-response`}
                  name="response"
                  type="text"
                  className="input"
                  placeholder={t('appAgency.appAgencyOrgidMissionCollaboration.issuerSResponse')}
                  aria-label={t(
                    'appAgency.appAgencyOrgidMissionCollaboration.issuerResponseff74b8',
                  )}
                  required
                />
              </div>
              <div className="field-row">
                <label className="field-label" htmlFor={`${uid}-issuer-valid-until`}>
                  {t.node('appAgency.appAgencyOrgidMissionCollaboration.validUntil')}
                </label>
                <input
                  id={`${uid}-issuer-valid-until`}
                  name="validUntil"
                  type="date"
                  className="input"
                  aria-label={t('appAgency.appAgencyOrgidMissionCollaboration.validUntil4852df')}
                  required
                />
              </div>
            </div>
            <div>
              <SubmitButton
                pending={issuerPending}
                idle="Record Confirmation"
                busy="Recording…"
                className="btn btn-secondary u-btn-sm"
              />
            </div>
          </form>
          <p className="muted" style={{ fontSize: 'var(--text-caption)', marginTop: '0.35rem' }}>
            {t.node(
              'appAgency.appAgencyOrgidMissionCollaboration.requiresEvidenceAlreadySelectedForThat',
            )}
          </p>
          <FormMessage result={issuerState} />
        </div>
      ) : null}
    </div>
  );
}
