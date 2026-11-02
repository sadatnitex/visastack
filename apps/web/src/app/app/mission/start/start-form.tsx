'use client';

import Link from 'next/link';
import { useActionState, useId, useRef, useState } from 'react';
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
  // Controlled, so a refused try (for example nobody ticked) keeps what was already chosen.
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(travellers.length === 1 && travellers[0] ? [travellers[0].applicantId] : []),
  );
  const toggle = (applicantId: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(applicantId);
      else next.delete(applicantId);
      return next;
    });
  return (
    <form ref={form} action={formAction} className="trip-start-form">
      <label className="label" htmlFor={`${id}-destination`}>
        Where Are You Going?
      </label>
      <select
        id={`${id}-destination`}
        name="destination"
        className="input"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
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
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
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
              checked={chosen.has(t.applicantId)}
              onChange={(e) => toggle(t.applicantId, e.target.checked)}
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
      {state.cases && state.cases.length > 0 ? (
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
