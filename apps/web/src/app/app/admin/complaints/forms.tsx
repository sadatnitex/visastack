'use client';

import { useActionState, useId } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import {
  type ActionState,
  assignComplaintOwnerAction,
  updateComplaintStatusAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function AssignComplaintForm({ complaintId }: { readonly complaintId: string }) {
  const [state, formAction, pending] = useActionState(assignComplaintOwnerAction, INITIAL);
  const ownerId = `${useId()}-owner`;
  return (
    <form action={formAction} className="field-list form-compact">
      <input type="hidden" name="complaintId" value={complaintId} />
      <div className="field-row">
        <label className="field-label" htmlFor={ownerId}>
          Assignee Email
        </label>
        <input
          id={ownerId}
          name="ownerEmail"
          type="email"
          required
          className="input"
          placeholder="person@example.com"
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Assign"
          busy="Assigning…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

const NEXT_STATUSES: Record<string, readonly string[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
};

export function UpdateComplaintStatusForm({
  complaintId,
  currentStatus,
}: {
  readonly complaintId: string;
  readonly currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(updateComplaintStatusAction, INITIAL);
  const id = useId();
  const options = NEXT_STATUSES[currentStatus] ?? [];
  if (options.length === 0) return null;
  return (
    <form action={formAction} className="field-list form-compact">
      <input type="hidden" name="complaintId" value={complaintId} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor={`${id}-status`}>
            Move To
          </label>
          <select id={`${id}-status`} name="status" className="input" defaultValue="" required>
            <option value="" disabled>
              Choose a status…
            </option>
            {options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${id}-resolution`}>
            Resolution (If Resolving)
          </label>
          <input id={`${id}-resolution`} name="resolution" type="text" className="input" />
        </div>
        <div className="field-row field-wide">
          <label className="field-label" htmlFor={`${id}-note`}>
            Note (Optional)
          </label>
          <input id={`${id}-note`} name="note" type="text" className="input" />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Update"
          busy="Updating…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
