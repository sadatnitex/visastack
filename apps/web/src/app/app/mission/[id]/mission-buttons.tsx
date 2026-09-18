'use client';

import type { MissionState } from '@visastack/core';
import { useActionState } from 'react';
import {
  type ActionState,
  setItineraryRefAction,
  snapshotMissionAction,
  transitionMissionAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Set or clear this mission's itinerary reference (IAM-04's "family trip" link, display only, never an access change). */
export function ItineraryForm({
  missionId,
  itineraryRef,
}: {
  readonly missionId: string;
  readonly itineraryRef: string | null;
}) {
  const [state, formAction, pending] = useActionState(setItineraryRefAction, INITIAL);
  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <input type="hidden" name="missionId" value={missionId} />
      <input
        name="itineraryRef"
        type="text"
        defaultValue={itineraryRef ?? ''}
        className="input"
        placeholder="e.g. Smith Family Europe 2026"
      />
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Saving…' : itineraryRef ? 'Update' : 'Link'}
        </button>
        {state.message ? (
          <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

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
