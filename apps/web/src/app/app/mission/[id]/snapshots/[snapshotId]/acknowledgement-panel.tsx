'use client';

import { useActionState } from 'react';
import { type ActionState, decideAcknowledgementAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export interface AcknowledgementHistoryEntry {
  readonly id: string;
  readonly decision: 'ACKNOWLEDGED' | 'REJECTED' | 'CORRECTION_REQUESTED';
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly invalidatedAt: Date | null;
}

const DECISION_LABELS: Record<AcknowledgementHistoryEntry['decision'], string> = {
  ACKNOWLEDGED: 'Acknowledged',
  REJECTED: 'Rejected',
  CORRECTION_REQUESTED: 'Correction requested',
};

const DECISION_TONES: Record<AcknowledgementHistoryEntry['decision'], string> = {
  ACKNOWLEDGED: 'badge-success',
  REJECTED: 'badge-danger',
  CORRECTION_REQUESTED: 'badge-warning',
};

/**
 * TRU-02 (master directive Part 7 §3): the applicant's own decision on THIS
 * prepared file. `expectedSnapshotChecksum` is a hidden field carrying the
 * checksum as displayed on this exact page load -- `decideAcknowledgement`
 * (packages/services) re-checks it server-side against the snapshot's own
 * current value, so this page cannot silently act on stale content.
 *
 * One shared form, three submit buttons (`name="decision"`, a distinct
 * `value` each) -- plain HTML: only the clicked button's name/value pair is
 * included in the submitted FormData, no client-side branching needed,
 * matching this codebase's "plain form, no client JS" preference elsewhere
 * (e.g. `case-search-form.tsx`).
 */
export function AcknowledgementPanel({
  missionId,
  snapshotId,
  checksum,
  history,
}: {
  readonly missionId: string;
  readonly snapshotId: string;
  readonly checksum: string;
  /** Every past decision recorded against THIS specific snapshot, newest first. */
  readonly history: readonly AcknowledgementHistoryEntry[];
}) {
  const [state, formAction, pending] = useActionState(decideAcknowledgementAction, INITIAL);
  const live = history.find((entry) => entry.decision === 'ACKNOWLEDGED' && !entry.invalidatedAt);

  return (
    <article className="card" style={{ marginBottom: '1.5rem' }}>
      <p className="card-kicker">Applicant-acknowledged prepared file</p>
      <h2 className="card-title">Review and decide</h2>
      <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
        This page is the exact evidence bundle, selected facts, and rule context this decision
        applies to. Acknowledging it does not mean it has been submitted, officially verified, or
        approved by anyone -- only that you have reviewed this exact content.
      </p>

      {live ? (
        <div className="notice notice-ok" style={{ marginBottom: '1rem' }}>
          <strong>Acknowledged</strong> on {live.createdAt.toLocaleString()}. This is still the live
          acknowledgement for this case.
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="rows" style={{ marginBottom: '1rem' }}>
          {history.map((entry) => (
            <div
              className="row"
              key={entry.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.25rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className={`badge ${DECISION_TONES[entry.decision]}`}>
                  {DECISION_LABELS[entry.decision]}
                </span>
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  {entry.createdAt.toLocaleString()}
                </span>
              </div>
              {entry.reason ? (
                <p style={{ margin: 0, fontSize: '0.85rem' }}>{entry.reason}</p>
              ) : null}
              {entry.invalidatedAt ? (
                <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
                  Historical -- the case changed after this decision, on{' '}
                  {entry.invalidatedAt.toLocaleString()}. A new decision is needed.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <form action={formAction} className="field-list">
        <input type="hidden" name="missionId" value={missionId} />
        <input type="hidden" name="snapshotId" value={snapshotId} />
        <input type="hidden" name="expectedSnapshotChecksum" value={checksum} />
        <div className="field-row">
          <label className="field-label" htmlFor="reason">
            Reason (required to reject or request a correction)
          </label>
          <textarea
            id="reason"
            name="reason"
            className="input"
            rows={3}
            placeholder="What needs to change, or why you're rejecting this?"
          />
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="submit"
            name="decision"
            value="ACKNOWLEDGED"
            className="btn btn-primary"
            disabled={pending}
          >
            {pending ? 'Recording…' : 'Acknowledge'}
          </button>
          <button
            type="submit"
            name="decision"
            value="CORRECTION_REQUESTED"
            className="btn btn-secondary"
            disabled={pending}
          >
            Request correction
          </button>
          <button
            type="submit"
            name="decision"
            value="REJECTED"
            className="btn btn-danger"
            disabled={pending}
          >
            Reject
          </button>
        </div>
        {state.message ? (
          <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {state.message}
          </p>
        ) : null}
      </form>
    </article>
  );
}
