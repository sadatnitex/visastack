'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  addNoteAction,
  assignMemberAction,
  recordDecisionAction,
  recordIssuerVerificationAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

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
  requirements,
  decisions,
  issuerVerifications,
  viewerAssigned,
}: MissionCollaborationProps) {
  const [noteState, noteAction, notePending] = useActionState(addNoteAction, INITIAL);
  const [assignState, assignAction, assignPending] = useActionState(assignMemberAction, INITIAL);
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

  return (
    <div
      style={{
        padding: '0.85rem',
        border: '1px solid var(--hairline-soft)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span className="row-key">{title}</span>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {applicantName}
        </span>
      </div>

      <div style={{ marginTop: '0.6rem' }}>
        <p className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.35rem' }}>
          Assigned
        </p>
        {assignments.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Nobody assigned yet.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            {assignments.map((a) => (
              <span key={a.id} className="badge badge-neutral">
                {a.memberEmail}
              </span>
            ))}
          </div>
        )}
        {assignableMembers.length > 0 ? (
          <form action={assignAction} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="missionId" value={missionId} />
            <select name="memberAccountId" className="input" required defaultValue="">
              <option value="" disabled>
                Assign a member…
              </option>
              {assignableMembers.map((m) => (
                <option key={m.accountId} value={m.accountId}>
                  {m.email}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
              disabled={assignPending}
            >
              {assignPending ? 'Assigning…' : 'Assign'}
            </button>
          </form>
        ) : null}
        {assignState.message ? (
          <p className={`field-msg ${assignState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {assignState.message}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: '0.85rem' }}>
        <p className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.35rem' }}>
          Notes
        </p>
        {notes.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
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
              <div key={n.id} style={{ fontSize: '0.85rem' }}>
                <span
                  className={`badge ${n.visibility === 'AGENCY_INTERNAL' ? 'badge-warning' : 'badge-success'}`}
                  style={{ fontSize: '0.65rem', marginRight: '0.35rem' }}
                >
                  {n.visibility === 'AGENCY_INTERNAL' ? 'Internal' : 'Shared with traveller'}
                </span>
                <span>{n.body}</span>{' '}
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  — {n.authorEmail}, {new Date(n.createdAt).toLocaleDateString()}
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
            <option value="AGENCY_INTERNAL">Internal (this org only)</option>
            <option value="TRAVELLER_SHARED">Shared with traveller</option>
          </select>
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
            disabled={notePending}
          >
            {notePending ? 'Adding…' : 'Add'}
          </button>
        </form>
        {noteState.message ? (
          <p className={`field-msg ${noteState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {noteState.message}
          </p>
        ) : null}
      </div>

      {requirements.length > 0 ? (
        <div style={{ marginTop: '0.85rem' }}>
          <p className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.35rem' }}>
            Decisions
          </p>
          {decisions.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
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
                <div key={d.id} style={{ fontSize: '0.85rem' }}>
                  <span
                    className={`badge ${d.outcome === 'ACCEPTED' ? 'badge-success' : 'badge-danger'}`}
                  >
                    {d.outcome}
                  </span>{' '}
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {requirements.find((r) => r.id === d.packRequirementId)?.label ??
                      d.packRequirementId}
                    {d.reason ? ` — ${d.reason}` : ''}, {new Date(d.createdAt).toLocaleDateString()}
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
              <select name="packRequirementId" className="input" required defaultValue="">
                <option value="" disabled>
                  Requirement…
                </option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select name="outcome" className="input" defaultValue="ACCEPTED">
                <option value="ACCEPTED">Accept</option>
                <option value="REJECTED">Reject</option>
              </select>
              <input
                name="reason"
                type="text"
                className="input"
                placeholder="Reason (optional)"
                aria-label="Decision reason"
              />
              <button
                type="submit"
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
                disabled={decisionPending}
              >
                {decisionPending ? 'Recording…' : 'Record'}
              </button>
            </form>
          ) : (
            <p className="muted" style={{ fontSize: '0.78rem' }}>
              Only an assigned member can record a decision.
            </p>
          )}
          {decisionState.message ? (
            <p className={`field-msg ${decisionState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
              {decisionState.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {requirements.length > 0 ? (
        <div style={{ marginTop: '0.85rem' }}>
          <p className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.35rem' }}>
            Issuer confirmations (EVI-05)
          </p>
          {issuerVerifications.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
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
                <div key={v.id} style={{ fontSize: '0.85rem' }}>
                  <span className={`badge ${v.expired ? 'badge-neutral' : 'badge-success'}`}>
                    {v.expired ? 'Expired' : 'Confirmed'}
                  </span>{' '}
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {requirements.find((r) => r.id === v.packRequirementId)?.label ??
                      v.packRequirementId}
                    : {v.issuerIdentity}, "{v.exactClaim}", valid until{' '}
                    {new Date(v.validUntil).toLocaleDateString()}
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
            <button
              type="submit"
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
              disabled={issuerPending}
            >
              {issuerPending ? 'Recording…' : 'Record confirmation'}
            </button>
          </form>
          <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.35rem' }}>
            Requires evidence already selected for that requirement; a staff checkbox alone is never
            accepted as confirmation.
          </p>
          {issuerState.message ? (
            <p className={`field-msg ${issuerState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
              {issuerState.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
