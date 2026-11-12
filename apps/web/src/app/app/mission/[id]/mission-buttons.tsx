'use client';

import type { MissionState } from '@visastack/core';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appMissionCatalog } from '../../../../i18n/app-mission';
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
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState(updateCaseDetailsAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="missionId" value={missionId} />
      <div className="field-row">
        <label className="field-label" htmlFor="jurisdiction">
          {t.node('appMission.appMissionIdMissionButtons.embassyOrVisaCentre')}
        </label>
        <input
          id="jurisdiction"
          name="jurisdiction"
          type="text"
          defaultValue={jurisdiction ?? ''}
          className="input"
          placeholder={t('appMission.appMissionIdMissionButtons.eGUsEmbassyDhaka')}
          aria-describedby="jurisdiction-help"
        />
        <p id="jurisdiction-help" className="muted u-fs-085">
          {t.node('appMission.appMissionIdMissionButtons.whereYouApplyNotTheCountry')}
        </p>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="serviceCategory">
          {t.node('appMission.appMissionIdMissionButtons.serviceCategory')}
        </label>
        <input
          id="serviceCategory"
          name="serviceCategory"
          type="text"
          defaultValue={serviceCategory ?? ''}
          className="input"
          placeholder={t('appMission.appMissionIdMissionButtons.eGTouristStudentWork')}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="travelStartDate">
          {t.node('appMission.appMissionIdMissionButtons.travelDates')}
        </label>
        <div className="lift-date-pair">
          <input
            id="travelStartDate"
            name="travelStartDate"
            type="date"
            defaultValue={travelStartDate ? travelStartDate.toISOString().slice(0, 10) : ''}
            className="input"
            aria-label={t('appMission.appMissionIdMissionButtons.travelStartDate')}
          />
          <input
            id="travelEndDate"
            name="travelEndDate"
            type="date"
            defaultValue={travelEndDate ? travelEndDate.toISOString().slice(0, 10) : ''}
            className="input"
            aria-label={t('appMission.appMissionIdMissionButtons.travelEndDate')}
          />
        </div>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="targetDeadline">
          {t.node('appMission.appMissionIdMissionButtons.targetDeadline')}
        </label>
        <input
          id="targetDeadline"
          name="targetDeadline"
          type="date"
          defaultValue={targetDeadline ? targetDeadline.toISOString().slice(0, 10) : ''}
          className="input"
        />
      </div>
      <label className="lift-form-check">
        <input type="checkbox" name="manualMode" value="true" defaultChecked={manualMode} />
        {t.node('appMission.appMissionIdMissionButtons.noAutomatedRequirementPackCoversThis')}
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
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState(setItineraryRefAction, INITIAL);
  return (
    <form action={formAction} className="lift-stack-form">
      <input type="hidden" name="missionId" value={missionId} />
      <input
        name="itineraryRef"
        type="text"
        defaultValue={itineraryRef ?? ''}
        className="input"
        aria-label={t('appMission.appMissionIdCaseRail.itineraryReference')}
        placeholder={t('appMission.appMissionIdMissionButtons.eGSmithFamilyEurope2026')}
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
      className={`lift-snapshot-stack ${align === 'start' ? 'lift-align-start' : 'lift-align-end'}`}
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
    <div className="lift-stage-stack">
      <div className="lift-stage-buttons">
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
