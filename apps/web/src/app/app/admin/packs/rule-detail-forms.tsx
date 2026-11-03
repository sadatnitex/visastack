'use client';

import {
  ACCEPTED_FORMS,
  ACCEPTED_FORM_LABELS,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_CATEGORY_LABELS,
  STATEMENT_PERIOD_MONTHS_MAX,
  VALID_MONTHS_AFTER_TRAVEL_MAX,
} from '@visastack/core';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import type { ActionState } from './actions';
import { setRequirementDetailsAction, setRouteConditionsAction } from './rule-detail-actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** The saved details, as the form shows them (blank means not stated). */
export interface RequirementDetailsValues {
  readonly category: string;
  readonly acceptedForm: string;
  readonly translationNeeded: '' | 'yes' | 'no';
  readonly originalNeeded: '' | 'yes' | 'no';
  readonly statementPeriodMonths: string;
  readonly validMonthsAfterTravel: string;
  readonly effectiveSince: string;
}

function YesNoNotStated({
  id,
  name,
  label,
  value,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} className="input">
        <option value="">Not Stated</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>
  );
}

/**
 * UMPE G2: a draft requirement's category (R02), how a document must be provided (R12), when the
 * source's rule took effect (R08) and how long a document must stay valid after the trip (R22).
 */
export function RequirementDetailsForm({
  packId,
  requirementId,
  kind,
  values,
}: {
  readonly packId: string;
  readonly requirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly values: RequirementDetailsValues;
}) {
  const [state, formAction, pending] = useActionState(setRequirementDetailsAction, INITIAL);
  const id = (name: string) => `${requirementId}-details-${name}`;
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="requirementId" value={requirementId} />
      <p className="muted">
        Organise the item and say how it must be provided. Leave a value as Not Stated when the
        source does not say.
      </p>
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor={id('category')}>
            Category
          </label>
          <select
            id={id('category')}
            name="category"
            defaultValue={values.category}
            className="input"
          >
            <option value="">Not Set</option>
            {REQUIREMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {REQUIREMENT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={id('effectiveSince')}>
            Rule in Effect Since
          </label>
          <input
            id={id('effectiveSince')}
            name="effectiveSince"
            type="date"
            defaultValue={values.effectiveSince}
            className="input"
          />
        </div>
        {kind === 'DOCUMENT' ? (
          <>
            <div className="field-row">
              <label className="field-label" htmlFor={id('acceptedForm')}>
                Accepted As
              </label>
              <select
                id={id('acceptedForm')}
                name="acceptedForm"
                defaultValue={values.acceptedForm}
                className="input"
              >
                <option value="">Not Stated</option>
                {ACCEPTED_FORMS.map((form) => (
                  <option key={form} value={form}>
                    {ACCEPTED_FORM_LABELS[form]}
                  </option>
                ))}
              </select>
            </div>
            <YesNoNotStated
              id={id('originalNeeded')}
              name="originalNeeded"
              label="Original Needed"
              value={values.originalNeeded}
            />
            <YesNoNotStated
              id={id('translationNeeded')}
              name="translationNeeded"
              label="Translation Needed"
              value={values.translationNeeded}
            />
            <div className="field-row">
              <label className="field-label" htmlFor={id('statementPeriodMonths')}>
                Period Covered in Months
              </label>
              <input
                id={id('statementPeriodMonths')}
                name="statementPeriodMonths"
                type="number"
                inputMode="numeric"
                min={1}
                max={STATEMENT_PERIOD_MONTHS_MAX}
                step={1}
                defaultValue={values.statementPeriodMonths}
                className="input"
              />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={id('validMonthsAfterTravel')}>
                Months Valid After the Trip
              </label>
              <input
                id={id('validMonthsAfterTravel')}
                name="validMonthsAfterTravel"
                type="number"
                inputMode="numeric"
                min={0}
                max={VALID_MONTHS_AFTER_TRAVEL_MAX}
                step={1}
                defaultValue={values.validMonthsAfterTravel}
                className="input"
              />
            </div>
          </>
        ) : null}
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Rule Details"
          busy="Saving…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

/**
 * UMPE G2 (R05): which application posts and trip start dates a pack is for. Left empty, the pack
 * narrows by neither, exactly as before.
 */
export function RouteConditionsForm({
  packId,
  consularPosts,
  travelFrom,
  travelUntil,
}: {
  readonly packId: string;
  readonly consularPosts: readonly string[];
  readonly travelFrom: string;
  readonly travelUntil: string;
}) {
  const [state, formAction, pending] = useActionState(setRouteConditionsAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="packId" value={packId} />
      <p className="muted">
        Only fill these in when the source limits the checklist to some embassies, consulates or
        visa centres, or to trips starting in a date window. A case that does not say is asked, and
        a case for another post or window is not offered this checklist.
      </p>
      <div className="form-grid">
        <div className="field-row field-wide">
          <label className="field-label" htmlFor={`${packId}-consularPosts`}>
            Application Posts, One per Line
          </label>
          <textarea
            id={`${packId}-consularPosts`}
            name="consularPosts"
            rows={3}
            defaultValue={consularPosts.join('\n')}
            className="input"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${packId}-travelFrom`}>
            Trips Starting From
          </label>
          <input
            id={`${packId}-travelFrom`}
            name="travelFrom"
            type="date"
            defaultValue={travelFrom}
            className="input"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${packId}-travelUntil`}>
            Trips Starting Until
          </label>
          <input
            id={`${packId}-travelUntil`}
            name="travelUntil"
            type="date"
            defaultValue={travelUntil}
            className="input"
          />
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Who This Checklist Is For"
          busy="Saving…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
