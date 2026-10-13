'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { formatTimestampDate } from '../../../../lib/format-date';
import { complaintStatusLabel } from '../../../../lib/labels';
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
      <p className="card-body u-mb-100">
        Reviewed only by authorized quality staff - the agency working this case never sees a
        complaint filed against it.
      </p>
      {complaints.length > 0 ? (
        <div className="rows u-mb-125">
          {complaints.map((c) => (
            <div
              className="row"
              key={c.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className="row-key">{formatTimestampDate(c.createdAt)}</span>
                <span className={`badge ${STATUS_TONES[c.status] ?? 'badge-neutral'}`}>
                  {complaintStatusLabel(c.status)}
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
                      {formatTimestampDate(e.createdAt)}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  ))}
                </div>
              ) : null}
              {!TERMINAL_STATUSES.has(c.status) ? (
                <form action={withdrawAction}>
                  <input type="hidden" name="missionId" value={missionId} />
                  <input type="hidden" name="complaintId" value={c.id} />
                  <SubmitButton
                    pending={withdrawPending}
                    idle="Withdraw"
                    busy="Withdrawing…"
                    className="btn btn-secondary"
                  />
                </form>
              ) : null}
            </div>
          ))}
          <FormMessage result={withdrawState} />
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
          <SubmitButton
            pending={filePending}
            idle="File complaint"
            busy="Filing…"
            className="btn btn-secondary"
          />
          <FormMessage result={fileState} />
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
      <p className="card-body u-mb-100">
        Only you and authorized quality staff ever see this - never the agency, and never published
        as a public review or ranking.
      </p>
      {feedback.length > 0 ? (
        <div className="rows u-mb-125">
          {feedback.map((f) => (
            <div
              className="row"
              key={f.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
            >
              <span className="u-fs-090">{f.comments}</span>
              <span className="muted u-fs-075">{formatTimestampDate(f.createdAt)}</span>
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
            <SubmitButton
              pending={pending}
              idle="Submit feedback"
              busy="Submitting…"
              className="btn btn-secondary"
            />
            <FormMessage result={state} />
          </div>
        </form>
      ) : (
        <p className="muted u-fs-085">
          Feedback becomes available once this case is closed or cancelled.
        </p>
      )}
    </article>
  );
}
