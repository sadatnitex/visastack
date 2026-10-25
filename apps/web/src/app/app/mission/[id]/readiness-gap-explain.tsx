'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, explainReadinessGapAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * AI-assisted explanation of an already-determined readiness gap (Part 8
 * AI-01 item 5). Shows the most recent explanation already on file (a
 * server-fetched prop, possibly from an EARLIER call on this or any other
 * mission hitting the identical requirement+state+citation -- the cache is
 * global, per `ai_explanation_runs`'s own doc comment) plus a button to
 * generate or refresh one. Unlike `AiProposalReview`, there is nothing to
 * approve or reject: an explanation is read-only advisory text, never a
 * write to any record.
 */
export function ExplainGapButton({
  missionId,
  packRequirementId,
  explanation,
}: {
  readonly missionId: string;
  readonly packRequirementId: string;
  readonly explanation: string | null;
}) {
  const [state, formAction, pending] = useActionState(explainReadinessGapAction, INITIAL);

  return (
    <div style={{ marginTop: '0.3rem' }}>
      {explanation ? (
        <p className="muted" style={{ fontSize: 'var(--text-small)', fontStyle: 'italic' }}>
          {explanation}
        </p>
      ) : null}
      <form action={formAction} style={{ display: 'inline' }}>
        <input type="hidden" name="missionId" value={missionId} />
        <input type="hidden" name="packRequirementId" value={packRequirementId} />
        <SubmitButton
          pending={pending}
          idle={explanation ? 'Refresh Explanation' : 'Explain This with AI'}
          busy="Asking AI…"
          className="btn btn-secondary u-btn-xs"
        />
      </form>
      <FormMessage result={state} style={{ fontSize: 'var(--text-caption)' }} />
    </div>
  );
}
