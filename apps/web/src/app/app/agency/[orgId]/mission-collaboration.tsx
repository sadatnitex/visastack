'use client';

import { useActionState } from 'react';
import { type ActionState, addNoteAction, assignMemberAction } from './actions';

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
}

interface MissionCollaborationProps {
  readonly organizationId: string;
  readonly missionId: string;
  readonly title: string;
  readonly applicantName: string;
  readonly members: readonly MemberOption[];
  readonly assignments: readonly AssignmentView[];
  readonly notes: readonly NoteView[];
}

export function MissionCollaboration({
  organizationId,
  missionId,
  title,
  applicantName,
  members,
  assignments,
  notes,
}: MissionCollaborationProps) {
  const [noteState, noteAction, notePending] = useActionState(addNoteAction, INITIAL);
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
          <form action={assignMemberAction} style={{ display: 'flex', gap: '0.5rem' }}>
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
            >
              Assign
            </button>
          </form>
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
            required
          />
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
    </div>
  );
}
