'use client';

import { useActionState } from 'react';
import { type ActionState, respondEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function RespondButtons({
  applicantId,
  requestId,
}: {
  readonly applicantId: string;
  readonly requestId: string;
}) {
  const [state, formAction, pending] = useActionState(respondEvidenceAction, INITIAL);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <form action={formAction}>
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="FULFILLED" />
          <button
            type="submit"
            className="btn btn-primary"
            style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
            disabled={pending}
          >
            Fulfil
          </button>
        </form>
        <form action={formAction}>
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="DECLINED" />
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
            disabled={pending}
          >
            Decline
          </button>
        </form>
      </div>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
