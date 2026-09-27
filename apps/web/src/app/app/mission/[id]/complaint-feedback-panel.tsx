'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  fileComplaintAction,
  submitFeedbackAction,
  withdrawComplaintAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const STATUS_TONES: Record<string, string> = {
  OPEN: 'badge-warning',
  IN_PROGRESS: 'badge-warning',
  RESOLVED: 'badge-success',
  CLOSED: 'badge-neutral',
};

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['RESOLVED', 'CLOSED']);

export interface ComplaintEventView {
  readonly id: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ComplaintView {
  readonly id: string;
  readonly description: string;
  readonly status: string;
  readonly resolution: string | null;
  readonly createdAt: string;
  readonly events: readonly ComplaintEventView[];
}

/** TRU-04 §9 - a case complaint with an owner/status/history/resolution workflow. Never visible to the agency being reviewed. */
export function ComplaintPanel({
  missionId,
  complaints,
}: {
  readonly missionId: string;
  readonly complaints: readonly ComplaintView[];
}) {
  const [fileState, fileAction, filePending] = useActionState(fileComplaintAction, INITIAL);
  const [withdrawState, withdrawAction, withdrawPending] = useActionState(
    withdrawComplaintAction,
    INITIAL,
  );

  return (
    <article className="card">
      <p className="card-kicker">Oversight</p>
      <h2 className="card-title">Case complaint</h2>
      <p className="card-body" style={{ marginBottom: '1rem' }}>
        Reviewed only by authorized quality staff - the agency working this case never sees a
        complaint filed against it.
      </p>
      {complaints.length > 0 ? (
        <div className="rows" style={{ marginBottom: '1.25rem' }}>
          {complaints.map((c) => (
            <div
              className="row"
              key={c.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className="row-key">{new Date(c.createdAt).toLocaleDateString()}</span>
                <span className={`badge ${STATUS_TONES[c.status] ?? 'badge-neutral'}`}>
                  {c.status}
                </span>
              </div>
              <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                {c.description}
              </p>
              {c.resolution ? (
                <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                  Resolution: {c.resolution}
                </p>
              ) : null}
              {c.events.length > 0 ? (
                <div style={{ marginTop: '0.25rem' }}>
                  {c.events.map((e) => (
                    <p key={e.id} className="muted" style={{ fontSize: '0.72rem', margin: 0 }}>
                      {e.fromStatus ? `${e.fromStatus} → ${e.toStatus}` : `Filed (${e.toStatus})`} ·{' '}
                      {new Date(e.createdAt).toLocaleDateString()}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  ))}
                </div>
              ) : null}
              {!TERMINAL_STATUSES.has(c.status) ? (
                <form action={withdrawAction}>
                  <input type="hidden" name="missionId" value={missionId} />
                  <input type="hidden" name="complaintId" value={c.id} />
                  <button type="submit" className="btn btn-secondary" disabled={withdrawPending}>
                    {withdrawPending ? 'Withdrawing…' : 'Withdraw'}
                  </button>
                </form>
              ) : null}
            </div>
          ))}
          {withdrawState.message ? (
            <p className={`field-msg ${withdrawState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
              {withdrawState.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <form action={fileAction} className="field-list">
        <input type="hidden" name="missionId" value={missionId} />
        <div className="field-row">
          <label className="field-label" htmlFor="complaint-description">
            File a new complaint
          </label>
          <textarea
            id="complaint-description"
            name="description"
            className="input"
            rows={3}
            placeholder="Describe the issue with how this case was handled"
          />
        </div>
        <div>
          <button type="submit" className="btn btn-secondary" disabled={filePending}>
            {filePending ? 'Filing…' : 'File complaint'}
          </button>
          {fileState.message ? (
            <p className={`field-msg ${fileState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
              {fileState.message}
            </p>
          ) : null}
        </div>
      </form>
    </article>
  );
}

export interface FeedbackView {
  readonly id: string;
  readonly comments: string;
  readonly createdAt: string;
}

/** TRU-04 §9 - private post-case feedback, readable only by the submitter and QUALITY_ADMIN staff. No rating/score (no public review/ranking in V1). */
export function FeedbackPanel({
  missionId,
  feedback,
  canSubmit,
}: {
  readonly missionId: string;
  readonly feedback: readonly FeedbackView[];
  readonly canSubmit: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitFeedbackAction, INITIAL);

  return (
    <article className="card">
      <p className="card-kicker">Oversight</p>
      <h2 className="card-title">Private feedback</h2>
      <p className="card-body" style={{ marginBottom: '1rem' }}>
        Only you and authorized quality staff ever see this - never the agency, and never published
        as a public review or ranking.
      </p>
      {feedback.length > 0 ? (
        <div className="rows" style={{ marginBottom: '1.25rem' }}>
          {feedback.map((f) => (
            <div
              className="row"
              key={f.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
            >
              <span style={{ fontSize: '0.9rem' }}>{f.comments}</span>
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                {new Date(f.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {canSubmit ? (
        <form action={formAction} className="field-list">
          <input type="hidden" name="missionId" value={missionId} />
          <div className="field-row">
            <label className="field-label" htmlFor="feedback-comments">
              Share feedback on how this case was handled
            </label>
            <textarea id="feedback-comments" name="comments" className="input" rows={3} />
          </div>
          <div>
            <button type="submit" className="btn btn-secondary" disabled={pending}>
              {pending ? 'Submitting…' : 'Submit feedback'}
            </button>
            {state.message ? (
              <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Feedback becomes available once this case is closed or cancelled.
        </p>
      )}
    </article>
  );
}
