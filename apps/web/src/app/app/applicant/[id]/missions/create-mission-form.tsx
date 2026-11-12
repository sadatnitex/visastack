'use client';

import { type ReactNode, useActionState, useId, useRef } from 'react';
import { CountryField } from '../../../../../components/country-field';
import {
  FormMessage,
  SubmitButton,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import { useT } from '../../../../../components/i18n-provider';
import { StickyActionBar } from '../../../../../components/sticky-action-bar';
import { Disclosure } from '../../../../../components/ui';
import { AboutDisclosure } from '../../../../../components/ui-lift';
import { applicantMissionsCatalog } from '../../../../../i18n/applicant-missions';
import type { CaseCountryOption, CasePurposeGroup } from '../../../../../lib/case-choices';
import { CASE_DATE_FIELDS } from '../../../../../lib/form-dates';
import { usePartTypedDateCheck } from '../../../../../lib/use-part-typed-date-check';
import { createMissionAction } from './actions';
import {
  type ActionState,
  CASE_DETAIL_FIELDS,
  type CaseFormField,
  TITLE_MAX,
} from './case-form-fields';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * Start a Case: three questions first (a name, the country from the list the app holds, and the
 * purpose from the approved list), the rest under one fold-out. The server checks every answer
 * and says beside each field what to fix; focus goes to the first one. A matching checklist is
 * linked by the server once the case exists, and the case opens at the top with a welcome note.
 */
export function CreateMissionForm({
  applicantId,
  countries,
  purposes,
  openDetails = false,
}: {
  readonly applicantId: string;
  readonly countries: readonly CaseCountryOption[];
  readonly purposes: readonly CasePurposeGroup[];
  /** Start with the optional details open (the Everything level of the Cases page shows all of it). */
  readonly openDetails?: boolean;
}) {
  const t = useT(applicantMissionsCatalog);
  const [state, formAction, pending] = useActionState(createMissionAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();
  const messageId = `${baseId}-message`;
  useFocusInvalidField(formRef, state);
  // A part-typed date sends nothing, so the page stops the form and says so beside the box.
  const dateCheck = usePartTypedDateCheck(CASE_DATE_FIELDS);

  const errors: Readonly<Partial<Record<CaseFormField, string>>> = {
    ...(state.fieldErrors ?? {}),
    ...dateCheck.errors,
  };
  const values = state.values ?? {};
  const detailsHaveProblem = [...CASE_DETAIL_FIELDS].some((name) => errors[name] !== undefined);

  /** The attributes and message that tie one field to its own problem. */
  const problem = (name: CaseFormField, hintId?: string) => {
    const error = errors[name];
    const errorId = `${baseId}-${name}-error`;
    const describedBy = [error ? errorId : null, hintId ?? null].filter(Boolean).join(' ');
    return {
      control: {
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      },
      message: error ? (
        <p id={errorId} className="field-msg field-msg-err case-field-error">
          {error}
        </p>
      ) : null,
    };
  };

  const field = (
    name: CaseFormField,
    label: ReactNode,
    input: (id: string, control: ReturnType<typeof problem>['control']) => ReactNode,
    hint?: string,
  ) => {
    const id = `${baseId}-${name}`;
    const hintId = hint ? `${id}-hint` : undefined;
    const { control, message } = problem(name, hintId);
    return (
      <div className="field-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="field-hint">
            {hint}
          </p>
        ) : null}
        {input(id, control)}
        {message}
      </div>
    );
  };

  const dateRange = { start: problem('travelStartDate'), end: problem('travelEndDate') };

  return (
    // Drawn afresh after each refused attempt, so every box shows what was sent.
    <form
      key={state.attempt ?? 0}
      ref={formRef}
      action={formAction}
      onSubmit={dateCheck.onSubmit}
      className="field-list lc-steps"
      noValidate
    >
      <input type="hidden" name="applicantId" value={applicantId} />
      {field('title', 'What is this case for?', (id, control) => (
        <input
          id={id}
          name="title"
          type="text"
          required
          maxLength={TITLE_MAX}
          autoComplete="off"
          className="input"
          placeholder={t(
            'applicantMissions.appApplicantIdMissionsCreateMissionForm.eGUkStudentVisaAutumn',
          )}
          defaultValue={values.title ?? ''}
          {...control}
        />
      ))}
      {field(
        'destination',
        'Where are you going?',
        (id, control) => (
          <CountryField
            id={id}
            countries={countries}
            defaultValue={values.destination ?? ''}
            placeholder={t('applicantMissions.appApplicantIdMissionsCreateMissionForm.notSureYet')}
            problem={control}
          />
        ),
        'Type a country, or leave it empty if unsure.',
      )}
      {field('purpose', 'What is the trip for?', (id, control) => (
        <select
          id={id}
          name="purpose"
          className="input"
          defaultValue={values.purpose ?? ''}
          {...control}
        >
          <option value="">
            {t('applicantMissions.appApplicantIdMissionsCreateMissionForm.notSureYet')}
          </option>
          {purposes.map((group) => (
            <optgroup key={group.family} label={group.label}>
              {group.options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ))}
      <AboutDisclosure
        summary={t('applicantMissions.appApplicantIdMissionsCreateMissionForm.aboutChecklists')}
      >
        <p className="muted u-fs-085 u-m-0">
          {t('applicantMissions.appApplicantIdMissionsCreateMissionForm.withACountryAndAPurpose')}
        </p>
      </AboutDisclosure>
      <Disclosure
        title={t(
          'applicantMissions.appApplicantIdMissionsCreateMissionForm.addMoreDetailsOptional',
        )}
        hint={t(
          'applicantMissions.appApplicantIdMissionsCreateMissionForm.familyTripLabelEmbassyDatesAnd',
        )}
        {...(detailsHaveProblem || openDetails ? { open: true } : {})}
      >
        {field('itineraryRef', 'Family Trip Label (Optional)', (id, control) => (
          <input
            id={id}
            name="itineraryRef"
            type="text"
            className="input"
            placeholder={t(
              'applicantMissions.appApplicantIdMissionsCreateMissionForm.eGSmithFamilyEurope2026',
            )}
            defaultValue={values.itineraryRef ?? ''}
            {...control}
          />
        ))}
        {field('jurisdiction', 'Embassy or Visa Centre (Optional)', (id, control) => (
          <input
            id={id}
            name="jurisdiction"
            type="text"
            className="input"
            placeholder={t(
              'applicantMissions.appApplicantIdMissionsCreateMissionForm.eGUsEmbassyDhaka',
            )}
            defaultValue={values.jurisdiction ?? ''}
            {...control}
          />
        ))}
        {field('serviceCategory', 'Service Category (Optional)', (id, control) => (
          <input
            id={id}
            name="serviceCategory"
            type="text"
            className="input"
            placeholder={t(
              'applicantMissions.appApplicantIdMissionsCreateMissionForm.eGTouristStudentWork',
            )}
            defaultValue={values.serviceCategory ?? ''}
            {...control}
          />
        ))}
        <fieldset className="fieldset case-date-range">
          <legend className="field-label">
            {t('applicantMissions.appApplicantIdMissionsCreateMissionForm.travelDatesOptional')}
          </legend>
          <div className="case-date-pair">
            <div>
              <label className="field-label" htmlFor={`${baseId}-travelStartDate`}>
                {t('applicantMissions.appApplicantIdMissionsCreateMissionForm.startDate')}
              </label>
              <input
                id={`${baseId}-travelStartDate`}
                name="travelStartDate"
                type="date"
                className="input"
                defaultValue={values.travelStartDate ?? ''}
                {...dateRange.start.control}
              />
              {dateRange.start.message}
            </div>
            <div>
              <label className="field-label" htmlFor={`${baseId}-travelEndDate`}>
                {t('applicantMissions.appApplicantIdMissionsCreateMissionForm.endDate')}
              </label>
              <input
                id={`${baseId}-travelEndDate`}
                name="travelEndDate"
                type="date"
                className="input"
                defaultValue={values.travelEndDate ?? ''}
                {...dateRange.end.control}
              />
              {dateRange.end.message}
            </div>
          </div>
        </fieldset>
        {field('targetDeadline', 'Target Deadline (Optional)', (id, control) => (
          <input
            id={id}
            name="targetDeadline"
            type="date"
            className="input"
            defaultValue={values.targetDeadline ?? ''}
            {...control}
          />
        ))}
      </Disclosure>
      <StickyActionBar
        label={t('applicantMissions.appApplicantIdMissionsCreateMissionForm.createTheCase')}
      >
        <SubmitButton
          pending={pending}
          idle="Create Case"
          busy="Creating…"
          className="btn btn-primary"
        />
      </StickyActionBar>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
