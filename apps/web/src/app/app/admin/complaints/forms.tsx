'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import {
  type ActionState,
  assignComplaintOwnerAction,
  updateComplaintStatusAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function AssignComplaintForm({ complaintId }: { readonly complaintId: string }) {
  const [state, formAction, pending] = useActionState(assignComplaintOwnerAction, INITIAL);
  return (
    <form
      action={formAction}
      style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <input type="hidden" name="complaintId" value={complaintId} />
      <input
        name="ownerEmail"
        type="email"
        required
        className="input"
        aria-label="Email of the person to assign to"
        placeholder="assign to email"
        style={{ maxWidth: '14rem' }}
      />
      <SubmitButton
        pending={pending}
        idle="Assign"
        busy="Assigning…"
        className="btn btn-secondary"
      />
      <FormMessage result={state} />
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
  const options = NEXT_STATUSES[currentStatus] ?? [];
  if (options.length === 0) return null;
  return (
    <form
      action={formAction}
      style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <input type="hidden" name="complaintId" value={complaintId} />
      <select
        name="status"
        aria-label="Move the complaint to"
        className="input"
        defaultValue=""
        required
        style={{ maxWidth: '10rem' }}
      >
        <option value="" disabled>
          Move to…
        </option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        name="resolution"
        type="text"
        className="input"
        aria-label="Resolution (if resolving)"
        placeholder="resolution (if resolving)"
      />
      <input
        name="note"
        type="text"
        className="input"
        aria-label="Note (optional)"
        placeholder="note (optional)"
      />
      <SubmitButton
        pending={pending}
        idle="Update"
        busy="Updating…"
        className="btn btn-secondary"
      />
      <FormMessage result={state} />
    </form>
  );
}
