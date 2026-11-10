'use client';

import Link from 'next/link';
import { useActionState, useId, useRef, useState } from 'react';
import { CountryField } from '../../../../components/country-field';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { PurposeChoice } from '../../../../components/purpose-choice';
import { StickyActionBar } from '../../../../components/sticky-action-bar';
import { AboutDisclosure } from '../../../../components/ui-lift';
import type { CaseCountryOption, CasePurposeGroup } from '../../../../lib/case-choices';
import { type TripStartState, startTripAction } from './actions';

const INITIAL: TripStartState = { ok: true, message: '' };

export interface TripTraveller {
  readonly applicantId: string;
  readonly name: string;
}

/**
 * Where a person goes when they do not know the country yet: the Cases page of the first
 * traveller they ticked (or the first one listed), with the by-name form already open.
 */
function manualHref(
  chosen: ReadonlySet<string>,
  travellers: readonly TripTraveller[],
): string | null {
  // Never a guess: with several travellers and nobody ticked, no case is offered for a stranger.
  const who = travellers.find((t) => chosen.has(t.applicantId));
  return who ? `/app/applicant/${who.applicantId}/missions?manual=1#start-case` : null;
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
  initialTravellerId,
}: {
  readonly countries: readonly CaseCountryOption[];
  readonly purposes: readonly CasePurposeGroup[];
  readonly travellers: readonly TripTraveller[];
  /** A traveller to tick on arrival (for example from the Cases list); only used when listed above. */
  readonly initialTravellerId?: string;
}) {
  const [state, formAction, pending] = useActionState(startTripAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  // Controlled, so a refused try (for example nobody ticked) keeps what was already chosen.
  const [purpose, setPurpose] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        initialTravellerId && travellers.some((t) => t.applicantId === initialTravellerId)
          ? [initialTravellerId]
          : travellers.length === 1 && travellers[0]
            ? [travellers[0].applicantId]
            : [],
      ),
  );
  const byNameHref = manualHref(chosen, travellers);
  const toggle = (applicantId: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(applicantId);
      else next.delete(applicantId);
      return next;
    });
  return (
    <form ref={form} action={formAction} className="trip-start-form">
      <div className="lc-step">
        <label className="label" htmlFor={`${id}-destination`}>
          Where Are You Going?
        </label>
        <CountryField
          id={`${id}-destination`}
          countries={countries}
          placeholder="For example: Japan"
          hint="Type a name or open the list."
          problem={fieldProblem(state, 'destination', messageId)}
        />
      </div>
      <div className="lc-step">
        <PurposeChoice
          id={`${id}-purpose`}
          purposes={purposes}
          value={purpose}
          onChange={setPurpose}
          problem={fieldProblem(state, 'purpose', messageId)}
        />
      </div>
      <fieldset className="trip-start-travellers lc-step">
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
      <AboutDisclosure summary="About This">
        <p className="muted u-fs-085 u-m-0 lc-help">
          Each traveller gets their own case. We ask for dates or other details only when the
          checklist needs them.
        </p>
      </AboutDisclosure>
      <StickyActionBar label="Start the Trip">
        <SubmitButton pending={pending} idle="Start Trip" busy="Starting…" />
      </StickyActionBar>
      <FormMessage id={messageId} result={state} />
      {!state.ok && state.field === 'destination' && byNameHref ? (
        <p className="muted u-fs-085">
          Not sure where yet? <Link href={byNameHref}>Start a Case by Name</Link>
        </p>
      ) : null}
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
