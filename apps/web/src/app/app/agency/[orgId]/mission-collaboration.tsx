'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
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

const INITIAL: ActionState = { ok: true, message: '' };

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
  readonly applicantName: string;
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
}

export function MissionCollaboration({
  organizationId,
  missionId,
  applicantId,
  title,
  applicantName,
  members,
  assignments,
  notes,
  tasks,
  appointments,
  requirements,
  decisions,
  issuerVerifications,
  viewerAssigned,
}: MissionCollaborationProps) {
  const [noteState, noteAction, notePending] = useActionState(addNoteAction, INITIAL);
  const [assignState, assignAction, assignPending] = useActionState(assignMemberAction, INITIAL);
  const [unassignState, unassignAction, unassignPending] = useActionState(
    unassignMemberAction,
    INITIAL,
  );
  const [taskCreateState, taskCreateAction, taskCreatePending] = useActionState(
    createTaskForOrgAction,
    INITIAL,
  );
  const [taskDecideState, taskDecideAction, taskDecidePending] = useActionState(
    decideTaskForOrgAction,
    INITIAL,
  );
  const [taskReassignState, taskReassignAction, taskReassignPending] = useActionState(
    updateTaskForOrgAction,
    INITIAL,
  );
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
  const assignedAccountIds = new Set(assignments.map((a) => a.memberAccountId));
  const assignableMembers = members.filter((m) => !assignedAccountIds.has(m.accountId));
  const memberEmailByAccountId = new Map(members.map((m) => [m.accountId, m.email] as const));
  const openTasks = tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const upcomingAppointments = appointments.filter(
    (a) => a.status === 'OPEN' || a.status === 'IN_PROGRESS',
  );

  return (
    <div
      id={`mission-${missionId}`}
      style={{
        padding: '0.85rem',
        border: '1px solid var(--hairline-soft)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span className="row-key">{title}</span>
        <span className="muted u-fs-085">{applicantName}</span>
      </div>

      <div style={{ marginTop: '0.6rem' }}>
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          Assigned
        </p>
        {assignments.length === 0 ? (
          <p className="muted u-fs-085">Nobody assigned yet.</p>
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
                <SubmitButton
                  pending={unassignPending}
                  idle="×"
                  busy="×"
                  className="btn btn-secondary"
                  style={{ padding: '0.1rem 0.5rem', fontSize: 'var(--text-caption)' }}
                  title="Unassign"
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
              aria-label="Member to assign"
              className="input"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Assign a member…
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
        <FormMessage result={assignState} />
        <FormMessage result={unassignState} />
      </div>

      <div style={{ marginTop: '0.85rem' }}>
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          Tasks
        </p>
        {openTasks.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
            No open tasks.
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
                    <SubmitButton
                      pending={taskReassignPending}
                      idle="Reassign"
                      busy="Reassign"
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
        <form
          action={taskCreateAction}
          style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="missionId" value={missionId} />
          <input
            name="description"
            type="text"
            className="input"
            placeholder="Add a task…"
            aria-label="Task description"
            required
            style={{ flex: 1, minWidth: '9rem' }}
          />
          <select name="assigneeAccountId" className="input" defaultValue="" aria-label="Assignee">
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.accountId} value={m.accountId}>
                {m.email}
              </option>
            ))}
          </select>
          <select name="priority" className="input" defaultValue="NORMAL" aria-label="Priority">
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="dueDate" type="date" className="input" aria-label="Due Date (Optional)" />
          <SubmitButton
            pending={taskCreatePending}
            idle="Add"
            busy="Adding…"
            className="btn btn-secondary u-btn-sm"
          />
        </form>
        <FormMessage result={taskCreateState} />
        <FormMessage result={taskDecideState} />
        <FormMessage result={taskReassignState} />
      </div>

      <div style={{ marginTop: '0.85rem' }}>
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          Appointments
        </p>
        {upcomingAppointments.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
            No appointments scheduled.
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
        <form
          action={apptCreateAction}
          style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="missionId" value={missionId} />
          <input
            name="title"
            type="text"
            className="input"
            placeholder="e.g. Visa interview prep call"
            aria-label="Appointment title"
            required
            style={{ flex: 1, minWidth: '9rem' }}
          />
          <input name="localDate" type="date" className="input" aria-label="Date" required />
          <input name="localTime" type="time" className="input" aria-label="Time" required />
          <input
            name="timezone"
            type="text"
            className="input"
            placeholder="Timezone"
            aria-label="Timezone"
            required
            style={{ maxWidth: '9rem' }}
          />
          <input
            name="place"
            type="text"
            className="input"
            placeholder="Place"
            aria-label="Place"
          />
          <input
            name="channel"
            type="text"
            className="input"
            placeholder="Channel"
            aria-label="Channel"
          />
          <SubmitButton
            pending={apptCreatePending}
            idle="Schedule"
            busy="Scheduling…"
            className="btn btn-secondary u-btn-sm"
          />
        </form>
        <FormMessage result={apptCreateState} />
        <FormMessage result={apptDecideState} />
      </div>

      <div style={{ marginTop: '0.85rem' }}>
        <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
          Notes
        </p>
        {notes.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
            No notes yet.
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
                  {n.visibility === 'AGENCY_INTERNAL' ? 'Internal' : 'Shared with Traveller'}
                </span>
                <span>{n.body}</span>{' '}
                <span className="muted u-fs-075">
                  - {n.authorEmail}, {formatTimestampDate(n.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
        <form action={noteAction} style={{ display: 'flex', gap: '0.5rem' }}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="missionId" value={missionId} />
          <input
            name="body"
            type="text"
            className="input"
            placeholder="Add a case note…"
            aria-label="Case note"
            required
          />
          <select
            name="visibility"
            className="input"
            required
            defaultValue=""
            aria-label="Note visibility"
            style={{ maxWidth: '11rem' }}
          >
            <option value="" disabled>
              Visibility…
            </option>
            <option value="AGENCY_INTERNAL">Internal (This Org Only)</option>
            <option value="TRAVELLER_SHARED">Shared with Traveller</option>
          </select>
          <SubmitButton
            pending={notePending}
            idle="Add"
            busy="Adding…"
            className="btn btn-secondary u-btn-sm"
          />
        </form>
        <FormMessage result={noteState} />
      </div>

      {requirements.length > 0 ? (
        <div style={{ marginTop: '0.85rem' }}>
          <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
            Decisions
          </p>
          {decisions.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
              No decisions recorded yet.
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
            <form
              action={decisionAction}
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="missionId" value={missionId} />
              <select
                name="packRequirementId"
                aria-label="Requirement"
                className="input"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Requirement…
                </option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select
                name="outcome"
                aria-label="Decision"
                className="input"
                defaultValue="ACCEPTED"
              >
                <option value="ACCEPTED">Accept</option>
                <option value="REJECTED">Reject</option>
              </select>
              <input
                name="reason"
                type="text"
                className="input"
                placeholder="Reason (Optional)"
                aria-label="Decision reason"
              />
              <SubmitButton
                pending={decisionPending}
                idle="Record"
                busy="Recording…"
                className="btn btn-secondary u-btn-sm"
              />
            </form>
          ) : (
            <p className="muted" style={{ fontSize: 'var(--text-caption)' }}>
              Only an assigned member can record a decision.
            </p>
          )}
          <FormMessage result={decisionState} />
        </div>
      ) : null}

      {requirements.length > 0 ? (
        <div style={{ marginTop: '0.85rem' }}>
          <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.35rem' }}>
            Issuer confirmations (EVI-05)
          </p>
          {issuerVerifications.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
              No issuer confirmed yet. Lack of this is not a readiness failure on its own.
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
                    {v.expired ? 'Expired' : 'Confirmed'}
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
          <form action={issuerAction} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="missionId" value={missionId} />
            <input type="hidden" name="applicantId" value={applicantId} />
            <select
              name="packRequirementId"
              className="input"
              required
              defaultValue=""
              aria-label="Requirement this confirmation covers"
            >
              <option value="" disabled>
                Requirement…
              </option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <input
              name="issuerIdentity"
              type="text"
              className="input"
              placeholder="Issuer (e.g. HM Passport Office)"
              aria-label="Issuer identity"
              required
            />
            <input
              name="contactMethod"
              type="text"
              className="input"
              placeholder="Contact method (e.g. phone: +44...)"
              aria-label="Contact method"
              required
            />
            <input
              name="exactClaim"
              type="text"
              className="input"
              placeholder="Exact claim confirmed"
              aria-label="Exact claim"
              required
            />
            <input
              name="response"
              type="text"
              className="input"
              placeholder="Issuer's response"
              aria-label="Issuer response"
              required
            />
            <input
              name="validUntil"
              type="date"
              className="input"
              aria-label="Valid until"
              required
            />
            <SubmitButton
              pending={issuerPending}
              idle="Record Confirmation"
              busy="Recording…"
              className="btn btn-secondary u-btn-sm"
            />
          </form>
          <p className="muted" style={{ fontSize: 'var(--text-caption)', marginTop: '0.35rem' }}>
            Requires evidence already selected for that requirement; a staff checkbox alone is never
            accepted as confirmation.
          </p>
          <FormMessage result={issuerState} />
        </div>
      ) : null}
    </div>
  );
}
