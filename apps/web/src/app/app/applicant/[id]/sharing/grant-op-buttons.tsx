'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { type ActionState, updateGrantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const CONFIRM_LABEL: Partial<Record<string, string>> = { revoke: 'Yes, Revoke Access' };

/** Operations that ask first, with the question shown inside the page (never a browser pop-up). */
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
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    if (state.ok && state.refreshPath) window.location.assign(state.refreshPath);
  }, [state]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {ops.map(({ op, label, variant }) => {
          const question = CONFIRM_MESSAGE[op];
          return (
            <form action={formAction} key={op}>
              <input type="hidden" name="applicantId" value={applicantId} />
              <input type="hidden" name="grantId" value={grantId} />
              <input type="hidden" name="op" value={op} />
              {question && confirming === op ? (
                <div className="notice" role="alert">
                  <p className="u-m-0">{question}</p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <SubmitButton
                      pending={pending}
                      idle={CONFIRM_LABEL[op] ?? label}
                      busy={label}
                      className={`btn ${variant} u-btn-sm`}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary u-btn-sm"
                      onClick={() => setConfirming(null)}
                    >
                      Keep Access
                    </button>
                  </div>
                </div>
              ) : question ? (
                <button
                  type="button"
                  className={`btn ${variant} u-btn-sm`}
                  onClick={() => setConfirming(op)}
                >
                  {label}
                </button>
              ) : (
                <SubmitButton
                  pending={pending}
                  idle={label}
                  busy={label}
                  className={`btn ${variant} u-btn-sm`}
                />
              )}
            </form>
          );
        })}
      </div>
      <FormMessage result={state} />
    </div>
  );
}
