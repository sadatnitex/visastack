'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import {
  confirmPackageHandoffAction,
  markPackageChangeReviewedAction,
  recordPackageChoiceAction,
} from './package-actions';

/** One option of the "What to Use" list: a copy (`d:<id>` or `f:<id>`) and its plain name. */
export interface PackageChoiceOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Choose what one checklist item uses: an exact copy, Leave Missing, Leave Out (only for an
 * item that can never hold the case back, with a reason), or back to the suggested copy.
 */
export function PackageItemChoiceForm({
  missionId,
  packRequirementId,
  itemName,
  options,
  current,
  canExclude,
  hasChoice,
}: {
  readonly missionId: string;
  readonly packRequirementId: string;
  /** The item's plain name, so each form on the page says which item it is for. */
  readonly itemName: string;
  readonly options: readonly PackageChoiceOption[];
  readonly current: string;
  readonly canExclude: boolean;
  readonly hasChoice: boolean;
}) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    recordPackageChoiceAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const reasonHint = `${id}-reason-hint`;
  // Controlled, so the list shows what is saved (the page's `current`), never a stale default.
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  // The reason box is hidden only once the page's script is running: without it the box stays in
  // view, so Leave Out can still be completed.
  const [scripted, setScripted] = useState(false);
  useEffect(() => setScripted(true), []);
  return (
    <form ref={form} action={formAction} className="package-choice-form">
      <input type="hidden" name="missionId" value={missionId} />
      <input type="hidden" name="packRequirementId" value={packRequirementId} />
      <label className="label" htmlFor={`${id}-choice`}>
        {t.node('appMission.appMissionIdPackageForms.whatToUseForItemname', { itemName })}
      </label>
      <select
        id={`${id}-choice`}
        name="choice"
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        {...fieldProblem(state, 'choice', messageId)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option
          {...t.lang('appMission.appMissionIdPackageForms.leaveMissingForNow')}
          value="missing"
        >
          {t('appMission.appMissionIdPackageForms.leaveMissingForNow')}
        </option>
        {canExclude ? (
          <option
            {...t.lang('appMission.appMissionIdPackageForms.leaveOutOfThisPackage')}
            value="exclude"
          >
            {t('appMission.appMissionIdPackageForms.leaveOutOfThisPackage')}
          </option>
        ) : null}
        {hasChoice ? (
          <option
            {...t.lang('appMission.appMissionIdPackageForms.goBackToTheSuggestedCopy')}
            value="clear"
          >
            {t('appMission.appMissionIdPackageForms.goBackToTheSuggestedCopy')}
          </option>
        ) : null}
      </select>
      {canExclude ? (
        // The reason is asked only once Leave Out is picked. The box stays in the page, hidden,
        // so a typed reason is never lost by looking at another choice and coming back.
        <div hidden={scripted && value !== 'exclude'} className="package-reason">
          <label className="label" htmlFor={`${id}-reason`}>
            {t.node('appMission.appMissionIdPackageForms.reasonForLeavingOut')}
          </label>
          <input
            id={`${id}-reason`}
            name="reason"
            className="input"
            maxLength={500}
            {...fieldProblem(state, 'reason', messageId, reasonHint)}
          />
          <p id={reasonHint} className="muted u-fs-085 u-m-0">
            {t.node('appMission.appMissionIdPackageForms.neededOnlyWhenYouLeaveThis')}
          </p>
        </div>
      ) : null}
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Choice"
          busy="Saving…"
          className="btn btn-secondary"
          label={t('appMission.appMissionIdPackageForms.saveChoiceForItemname', { itemName })}
        />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

/** The person has looked at the "something changed" note; the same situation then stays quiet. */
export function PackageChangeReviewedForm({ missionId }: { readonly missionId: string }) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    markPackageChangeReviewedAction,
    NO_RESULT,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="missionId" value={missionId} />
      <SubmitButton
        pending={pending}
        idle="I Have Reviewed This"
        busy="Saving…"
        className="btn btn-secondary"
      />
      <FormMessage result={state} />
    </form>
  );
}

/**
 * The traveller confirms the exact package as Prepared for Handoff, after reading the steps
 * outside VisaStack. It sends nothing to anyone and is not a submission.
 */
export function PackageHandoffForm({ missionId }: { readonly missionId: string }) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    confirmPackageHandoffAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <form ref={form} action={formAction} className="package-handoff-form">
      <input type="hidden" name="missionId" value={missionId} />
      <label className="package-check">
        <input
          type="checkbox"
          name="outsideStepsSeen"
          value="yes"
          {...fieldProblem(state, 'outsideStepsSeen', messageId)}
        />
        <span>{t.node('appMission.appMissionIdPackageForms.iHaveReadTheStepsOutside')}</span>
      </label>
      <div>
        <SubmitButton
          pending={pending}
          idle="Mark as Prepared for Handoff"
          busy="Saving…"
          className="btn btn-primary"
        />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}
