'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { saveWordingAction } from './edits-actions';

const INITIAL = { ok: true, message: '' };

/**
 * One checklist item's wording, in the traveller's own words. The official sentence stays on the
 * row, and nothing here changes what the case needs. The words show only to the traveller.
 */
export function WordingEditor({
  missionId,
  packRequirementId,
  current,
}: {
  readonly missionId: string;
  readonly packRequirementId: string;
  /** The traveller's sentence now, or empty when the original is showing. */
  readonly current: string;
}) {
  const [state, action, pending] = useActionState(saveWordingAction, INITIAL);
  const [backState, backAction, backPending] = useActionState(saveWordingAction, INITIAL);
  const id = `wording-${packRequirementId}`;
  return (
    <details className="lift-check-edit">
      <summary>Edit Wording</summary>
      <form action={action} className="field-list">
        <input type="hidden" name="missionId" value={missionId} />
        <input type="hidden" name="packRequirementId" value={packRequirementId} />
        <div className="field-row">
          <label className="field-label" htmlFor={id}>
            Your Wording
          </label>
          <textarea
            id={id}
            name="wording"
            className="input"
            rows={2}
            maxLength={400}
            defaultValue={current}
          />
        </div>
        <SubmitButton
          pending={pending}
          idle="Save Wording"
          busy="Saving"
          className="btn btn-secondary"
        />
        <FormMessage result={state} pending={pending} pendingText="Saving" />
      </form>
      {current ? (
        <form action={backAction}>
          <input type="hidden" name="missionId" value={missionId} />
          <input type="hidden" name="packRequirementId" value={packRequirementId} />
          <input type="hidden" name="intent" value="original" />
          <SubmitButton
            pending={backPending}
            idle="Back to Original Wording"
            busy="Restoring"
            className="btn btn-secondary"
          />
          <FormMessage result={backState} pending={backPending} pendingText="Restoring" />
        </form>
      ) : null}
    </details>
  );
}
