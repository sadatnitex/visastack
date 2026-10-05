'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
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
}: {
  readonly missionId: string;
  readonly outcomes: readonly OutcomeView[];
  readonly evidenceOptions: readonly EvidenceOption[];
}) {
  const [state, formAction, pending] = useActionState(recordOutcomeAction, INITIAL);

  return (
    <article className="card">
      <p className="card-kicker">Decision</p>
      <h2 className="card-title">Case outcome</h2>
      <p className="card-body" style={{ marginBottom: '1rem' }}>
        The official wording and your own reading of a decision are kept separate - this is never
        blended into a single summary, and recording an outcome never changes this case's workflow
        state on its own.
      </p>
      {outcomes.length > 0 ? (
        <div className="rows" style={{ marginBottom: '1.25rem' }}>
          {outcomes.map((o) => (
            <div
              className="row"
              key={o.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className="row-key">{new Date(o.decisionDate).toLocaleDateString()}</span>
                <span className={`badge ${DECISION_TONES[o.decision] ?? 'badge-neutral'}`}>
                  {DECISION_LABELS[o.decision] ?? o.decision}
                </span>
              </div>
              {o.officialWording ? (
                <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                  Official: {o.officialWording}
                </p>
              ) : null}
              {o.agencyInterpretation ? (
                <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                  Interpretation: {o.agencyInterpretation}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="card-body" style={{ marginBottom: '1.25rem' }}>
          No outcome recorded yet.
        </p>
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
            Decision date
          </label>
          <input id="decisionDate" name="decisionDate" type="date" className="input" required />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="officialWording">
            Official wording (optional)
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
            Your interpretation (optional)
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
              Evidence (optional)
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
            idle="Record outcome"
            busy="Recording…"
            className="btn btn-secondary"
          />
          <FormMessage result={state} />
        </div>
      </form>
    </article>
  );
}
