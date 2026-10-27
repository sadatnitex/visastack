'use client';

import type { MissionState } from '@visastack/core';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { CASE_STATE_LABELS } from '../../../../lib/case-stages';
import {
  type ActionState,
  setItineraryRefAction,
  snapshotMissionAction,
  transitionMissionAction,
  updateCaseDetailsAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** CAS-01 case-creation fields, editable after the fact (mission owner only). */
export function CaseDetailsForm({
  missionId,
  jurisdiction,
  serviceCategory,
  travelStartDate,
  travelEndDate,
  targetDeadline,
  manualMode,
}: {
  readonly missionId: string;
  readonly jurisdiction: string | null;
  readonly serviceCategory: string | null;
  readonly travelStartDate: Date | null;
  readonly travelEndDate: Date | null;
  readonly targetDeadline: Date | null;
  readonly manualMode: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateCaseDetailsAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="missionId" value={missionId} />
      <div className="field-row">
        <label className="field-label" htmlFor="jurisdiction">
          Jurisdiction / consular post
        </label>
        <input
          id="jurisdiction"
          name="jurisdiction"
          type="text"
          defaultValue={jurisdiction ?? ''}
          className="input"
          placeholder="e.g. US Embassy Dhaka"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="serviceCategory">
          Service Category
        </label>
        <input
          id="serviceCategory"
          name="serviceCategory"
          type="text"
          defaultValue={serviceCategory ?? ''}
          className="input"
          placeholder="e.g. Tourist, Student, Work"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="travelStartDate">
          Travel Dates
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            id="travelStartDate"
            name="travelStartDate"
            type="date"
            defaultValue={travelStartDate ? travelStartDate.toISOString().slice(0, 10) : ''}
            className="input"
            aria-label="Travel start date"
          />
          <input
            id="travelEndDate"
            name="travelEndDate"
            type="date"
            defaultValue={travelEndDate ? travelEndDate.toISOString().slice(0, 10) : ''}
            className="input"
            aria-label="Travel end date"
          />
        </div>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="targetDeadline">
          Target Deadline
        </label>
        <input
          id="targetDeadline"
          name="targetDeadline"
          type="date"
          defaultValue={targetDeadline ? targetDeadline.toISOString().slice(0, 10) : ''}
          className="input"
        />
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: 'var(--text-small)',
        }}
      >
        <input type="checkbox" name="manualMode" value="true" defaultChecked={manualMode} />
        No automated requirement pack covers this route (manual mode)
      </label>
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Case Details"
          busy="Saving…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

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
        aria-label="Itinerary Reference"
        placeholder="e.g. Smith Family Europe 2026"
      />
      <div>
        <SubmitButton
          pending={pending}
          idle={itineraryRef ? 'Update' : 'Link'}
          busy="Saving…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

/**
 * The case snapshot action. The defaults are the page header's button; the
 * changed-case alert (WP-X1) passes a clearer name, the primary style and
 * start alignment. Same action either way.
 */
export function SnapshotButton({
  missionId,
  label = 'Snapshot',
  primary = false,
  align = 'end',
}: {
  readonly missionId: string;
  readonly label?: string;
  readonly primary?: boolean;
  readonly align?: 'start' | 'end';
}) {
  const [state, formAction, pending] = useActionState(snapshotMissionAction, INITIAL);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'start' ? 'flex-start' : 'flex-end',
        gap: '0.3rem',
      }}
    >
      <form action={formAction}>
        <input type="hidden" name="missionId" value={missionId} />
        <SubmitButton
          pending={pending}
          idle={label}
          busy="Capturing…"
          className={primary ? 'btn btn-primary' : 'btn btn-secondary'}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/**
 * The stage buttons, one for each stage the page passes (`stageButtonStates`). Cancelling is not
 * one of them: it is final, so it lives in the page's More menu behind a confirmation question
 * (case-more-menu.tsx), never beside the stages.
 */
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
          <form action={formAction} key={to}>
            <input type="hidden" name="missionId" value={missionId} />
            <input type="hidden" name="to" value={to} />
            <SubmitButton
              pending={pending}
              idle={CASE_STATE_LABELS[to]}
              busy={CASE_STATE_LABELS[to]}
              className="btn btn-secondary"
            />
          </form>
        ))}
      </div>
      <FormMessage result={state} />
    </div>
  );
}
