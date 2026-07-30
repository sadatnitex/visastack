'use client';

import { useActionState } from 'react';
import { type ActionState, updateGrantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const CONFIRM_MESSAGE: Partial<Record<string, string>> = {
  revoke: 'Revoke this access? The recipient will lose it on their next request.',
};

export function GrantOpButtons({
  applicantId,
  grantId,
  ops,
}: {
  readonly applicantId: string;
  readonly grantId: string;
  readonly ops: ReadonlyArray<{
    readonly op: 'pause' | 'resume' | 'revoke';
    readonly label: string;
    readonly variant: string;
  }>;
}) {
  const [state, formAction, pending] = useActionState(updateGrantAction, INITIAL);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {ops.map(({ op, label, variant }) => (
          <form
            action={formAction}
            key={op}
            onSubmit={(e) => {
              const confirmMessage = CONFIRM_MESSAGE[op];
              if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
            }}
          >
            <input type="hidden" name="applicantId" value={applicantId} />
            <input type="hidden" name="grantId" value={grantId} />
            <input type="hidden" name="op" value={op} />
            <button
              type="submit"
              className={`btn ${variant}`}
              style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
              disabled={pending}
            >
              {label}
            </button>
          </form>
        ))}
      </div>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
