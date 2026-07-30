'use client';

import type { MissionState } from '@visastack/core';
import { useActionState } from 'react';
import { type ActionState, snapshotMissionAction, transitionMissionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function SnapshotButton({ missionId }: { readonly missionId: string }) {
  const [state, formAction, pending] = useActionState(snapshotMissionAction, INITIAL);
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}
    >
      <form action={formAction}>
        <input type="hidden" name="missionId" value={missionId} />
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Capturing…' : 'Snapshot'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'In progress',
  READY_FOR_REVIEW: 'Ready for review',
  UNDER_REVIEW: 'Under review',
  READY_TO_EXPORT: 'Ready to export',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

const DESTRUCTIVE: ReadonlySet<string> = new Set(['CANCELLED']);

export function TransitionButtons({
  missionId,
  nextStates,
}: {
  readonly missionId: string;
  readonly nextStates: readonly MissionState[];
}) {
  const [state, formAction, pending] = useActionState(transitionMissionAction, INITIAL);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        {nextStates.map((to) => (
          <form
            action={formAction}
            key={to}
            onSubmit={(e) => {
              if (
                DESTRUCTIVE.has(to) &&
                !window.confirm(
                  `Move this mission to ${STATE_LABELS[to] ?? to}? This can't be undone.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="missionId" value={missionId} />
            <input type="hidden" name="to" value={to} />
            <button
              type="submit"
              className={`btn ${DESTRUCTIVE.has(to) ? 'btn-danger' : 'btn-secondary'}`}
              disabled={pending}
            >
              {STATE_LABELS[to] ?? to}
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
