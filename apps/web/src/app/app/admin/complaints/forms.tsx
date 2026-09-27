'use client';

import { useActionState } from 'react';
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
        placeholder="assign to email"
        style={{ maxWidth: '14rem' }}
      />
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {pending ? 'Assigning…' : 'Assign'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
        placeholder="resolution (if resolving)"
      />
      <input name="note" type="text" className="input" placeholder="note (optional)" />
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {pending ? 'Updating…' : 'Update'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
