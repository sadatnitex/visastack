'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { formatTimestamp } from '../../../../lib/format-date';
import { type ActionState, recordSubmissionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const CHANNEL_LABELS: Record<string, string> = {
  EMBASSY_PORTAL: 'Embassy / consulate portal',
  EMAIL: 'Email',
  IN_PERSON: 'In person',
  COURIER: 'Courier',
  VISA_APPLICATION_CENTER: 'Visa application centre',
  OTHER: 'Other',
};

export interface SubmissionView {
  readonly id: string;
  readonly channel: string;
  readonly externalReportDescription: string;
  readonly externalReference: string | null;
  readonly submittedAt: string;
}

/** TRU-04 §7 - a report that the live-acknowledged snapshot was actually submitted externally. This is the only path that ever moves a mission to SUBMITTED, so it only appears once the case has reached SUBMISSION_READY. */
export function SubmissionReportPanel({
  missionId,
  submissions,
  eligible,
}: {
  readonly missionId: string;
  readonly submissions: readonly SubmissionView[];
  readonly eligible: boolean;
}) {
  const [state, formAction, pending] = useActionState(recordSubmissionAction, INITIAL);

  return (
    <article className="card">
      <p className="card-kicker">Filing</p>
      <h2 className="card-title">Submission report</h2>
      {submissions.length > 0 ? (
        <div className="rows u-mb-125">
          {submissions.map((s) => (
            <div
              className="row"
              key={s.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className="row-key">{formatTimestamp(s.submittedAt)}</span>
                <span className="badge badge-neutral">
                  {CHANNEL_LABELS[s.channel] ?? s.channel}
                </span>
              </div>
              <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                {s.externalReportDescription}
                {s.externalReference ? ` · Ref: ${s.externalReference}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="card-body u-mb-125">No submission reported yet.</p>
      )}
      {eligible ? (
        <form action={formAction} className="field-list">
          <input type="hidden" name="missionId" value={missionId} />
          <div className="field-row">
            <label className="field-label" htmlFor="channel">
              How was it submitted?
            </label>
            <select id="channel" name="channel" className="input" defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="externalReportDescription">
              Description
            </label>
            <textarea
              id="externalReportDescription"
              name="externalReportDescription"
              className="input"
              rows={2}
              placeholder="What was actually filed, and where"
              required
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="externalReference">
              Reference number (optional)
            </label>
            <input
              id="externalReference"
              name="externalReference"
              type="text"
              className="input"
              placeholder="e.g. tracking or receipt number"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="submittedAt">
              Submitted on (optional - defaults to now)
            </label>
            <input id="submittedAt" name="submittedAt" type="datetime-local" className="input" />
          </div>
          <div>
            <SubmitButton
              pending={pending}
              idle="Report submission"
              busy="Recording…"
              className="btn btn-secondary"
            />
            <FormMessage result={state} />
          </div>
        </form>
      ) : (
        <p className="muted u-fs-085">
          This case must reach "Submission ready" (with a live acknowledgement) before a submission
          can be reported.
        </p>
      )}
    </article>
  );
}
