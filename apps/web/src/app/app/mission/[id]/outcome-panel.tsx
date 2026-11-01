'use client';

import { type ReactNode, useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { formatDateOnly } from '../../../../lib/format-date';
import { type ActionState, recordOutcomeAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const DECISION_LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  REFUSED: 'Refused',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  OTHER: 'Other',
};

const DECISION_TONES: Record<string, string> = {
  APPROVED: 'badge-success',
  REFUSED: 'badge-danger',
  WITHDRAWN: 'badge-neutral',
  CANCELLED: 'badge-neutral',
  OTHER: 'badge-neutral',
};

export interface OutcomeView {
  readonly id: string;
  readonly decision: string;
  readonly decisionDate: string;
  readonly officialWording: string | null;
  readonly agencyInterpretation: string | null;
  readonly createdAt: string;
}

export interface EvidenceOption {
  readonly documentId: string;
  readonly displayName: string;
}

/** TRU-04 §8 - a real-world case decision, recorded as a fact independent of the mission's own workflow state (an appeal can keep a case open after a refusal). */
export function OutcomePanel({
  missionId,
  outcomes,
  evidenceOptions,
  rowIdPrefix,
  more,
}: {
  readonly missionId: string;
  readonly outcomes: readonly OutcomeView[];
  readonly evidenceOptions: readonly EvidenceOption[];
  /** WP-SB2: each row gets the id `<rowIdPrefix>-<index>`, so Show More can land on the first new one. */
  readonly rowIdPrefix?: string;
  /** WP-SB2: the Show More control under the list, when the page capped it. */
  readonly more?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(recordOutcomeAction, INITIAL);

  return (
    <article className="card">
      <p className="card-kicker">Decision</p>
      <h2 className="card-title">Case Outcome</h2>
      <p className="card-body u-mb-100">
        The official wording and your own reading of a decision are kept separate - this is never
        blended into a single summary, and recording an outcome never changes this case's workflow
        state on its own.
      </p>
      {outcomes.length > 0 ? (
        <div className="rows u-mb-125">
          {outcomes.map((o, index) => (
            <div
              className="row"
              key={o.id}
              id={rowIdPrefix ? `${rowIdPrefix}-${index}` : undefined}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className="row-key">{formatDateOnly(o.decisionDate)}</span>
                <span className={`badge ${DECISION_TONES[o.decision] ?? 'badge-neutral'}`}>
                  {DECISION_LABELS[o.decision] ?? o.decision}
                </span>
              </div>
              {o.officialWording ? (
                <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
                  Official: {o.officialWording}
                </p>
              ) : null}
              {o.agencyInterpretation ? (
                <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
                  Interpretation: {o.agencyInterpretation}
                </p>
              ) : null}
            </div>
          ))}
          {more}
        </div>
      ) : (
        <p className="card-body u-mb-125">No outcome recorded yet.</p>
      )}
      <form action={formAction} className="field-list">
        <input type="hidden" name="missionId" value={missionId} />
        <div className="field-row">
          <label className="field-label" htmlFor="decision">
            Decision
          </label>
          <select id="decision" name="decision" className="input" defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(DECISION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="decisionDate">
            Decision Date
          </label>
          <input id="decisionDate" name="decisionDate" type="date" className="input" required />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="officialWording">
            Official Wording (Optional)
          </label>
          <textarea
            id="officialWording"
            name="officialWording"
            className="input"
            rows={2}
            placeholder="Exact wording from the decision letter, unedited"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="agencyInterpretation">
            Your Interpretation (Optional)
          </label>
          <textarea
            id="agencyInterpretation"
            name="agencyInterpretation"
            className="input"
            rows={2}
            placeholder="Kept separate from the wording above"
          />
        </div>
        {evidenceOptions.length > 0 ? (
          <div className="field-row">
            <label className="field-label" htmlFor="evidenceDocumentId">
              Evidence (Optional)
            </label>
            <select
              id="evidenceDocumentId"
              name="evidenceDocumentId"
              className="input"
              defaultValue=""
            >
              <option value="">None</option>
              {evidenceOptions.map((d) => (
                <option key={d.documentId} value={d.documentId}>
                  {d.displayName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <SubmitButton
            pending={pending}
            idle="Record Outcome"
            busy="Recording…"
            className="btn btn-secondary"
          />
          <FormMessage result={state} />
        </div>
      </form>
    </article>
  );
}
