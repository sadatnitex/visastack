'use client';

import Link from 'next/link';
import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import type { CaseCountryOption, CasePurposeGroup } from '../../../../lib/case-choices';
import { type TripStartState, startTripAction } from './actions';

const INITIAL: TripStartState = { ok: true, message: '' };

export interface TripTraveller {
  readonly applicantId: string;
  readonly name: string;
}

/**
 * UMPE P4 (R13): start from the trip, not from an empty case form. Three questions; each chosen
 * traveller gets their own case (or their existing one for the same trip is opened). Dates,
 * embassy and other details are asked later, and only when the checklist needs them.
 */
export function TripStartForm({
  countries,
  purposes,
  travellers,
}: {
  readonly countries: readonly CaseCountryOption[];
  readonly purposes: readonly CasePurposeGroup[];
  readonly travellers: readonly TripTraveller[];
}) {
  const [state, formAction, pending] = useActionState(startTripAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <form ref={form} action={formAction} className="trip-start-form">
      <label className="label" htmlFor={`${id}-destination`}>
        Where Are You Going?
      </label>
      <select
        id={`${id}-destination`}
        name="destination"
        className="input"
        defaultValue=""
        {...fieldProblem(state, 'destination', messageId)}
      >
        <option value="" disabled>
          Choose a Country
        </option>
        {countries.map((country) => (
          <option key={country.iso2} value={country.iso2}>
            {country.name}
          </option>
        ))}
      </select>
      <label className="label" htmlFor={`${id}-purpose`}>
        Why?
      </label>
      <select
        id={`${id}-purpose`}
        name="purpose"
        className="input"
        defaultValue=""
        {...fieldProblem(state, 'purpose', messageId)}
      >
        <option value="" disabled>
          Choose a Purpose
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
      <fieldset className="trip-start-travellers">
        <legend className="label">Who&apos;s Travelling?</legend>
        {travellers.map((t, index) => (
          <label key={t.applicantId} className="package-check">
            <input
              type="checkbox"
              name="traveller"
              value={t.applicantId}
              defaultChecked={travellers.length === 1}
              {...(index === 0 ? fieldProblem(state, 'traveller', messageId) : {})}
            />
            <span>{t.name}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted u-fs-085 u-m-0">
        Each traveller gets their own case. We ask for dates or other details only when the
        checklist needs them.
      </p>
      <div>
        <SubmitButton pending={pending} idle="Start Trip" busy="Starting…" />
        <FormMessage id={messageId} result={state} />
      </div>
      {state.ok && state.cases && state.cases.length > 0 ? (
        <ul className="trip-start-cases">
          {state.cases.map((c) => (
            <li key={c.missionId}>
              <Link href={`/app/mission/${c.missionId}#trip-package`}>
                {c.existing
                  ? `Open the Existing Case for ${c.name}`
                  : `Open the Case for ${c.name}`}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
