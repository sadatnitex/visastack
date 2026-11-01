'use client';

import type { TravellerHealthThresholds } from '@visastack/services';
import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../../components/form-feedback';
import { saveTravellerThresholdsAction } from './actions';
import type { ThresholdField, ThresholdsState, ThresholdsValues } from './labels';

export interface TravellerThresholdsFormProps {
  readonly thresholds: TravellerHealthThresholds;
  /** False before the database is updated: the form is shown, but cannot be sent. */
  readonly available: boolean;
  /** Why it cannot be sent yet, shown above the boxes while `available` is false. */
  readonly unavailableMessage: string;
}

const NO_REPLY: ThresholdsState = { ok: true, message: '' };

interface Box {
  readonly name: ThresholdField;
  readonly label: string;
  readonly hint: string;
  readonly min: number;
  readonly max: number;
}

const BOXES: readonly Box[] = [
  {
    name: 'checkoutSuccessMinPercent',
    label: 'Checkout Success Below (Percent)',
    hint: 'Needs attention when fewer finished checkouts than this are paid. 0 to 100.',
    min: 0,
    max: 100,
  },
  {
    name: 'confirmationMaxMinutes',
    label: 'Time to Confirm Over (Minutes)',
    hint: 'Needs attention when payments take longer than this to confirm. 1 to 1440.',
    min: 1,
    max: 1440,
  },
  {
    name: 'stuckConfirmingMax',
    label: 'Stuck Confirming Above (Payments)',
    hint: 'Needs attention when more payments than this are still confirming after 30 minutes. 0 to 1000.',
    min: 0,
    max: 1000,
  },
  {
    name: 'needsCheckMax',
    label: 'Needs a Check Above (Payments)',
    hint: 'Needs attention when more payments than this are held for a check. 0 to 1000.',
    min: 0,
    max: 1000,
  },
];

/**
 * The owner's alert thresholds for the four traveller plan health signals: four whole numbers,
 * saved with a fresh sign-in check. Before the database is updated the boxes show the standard
 * thresholds and cannot be changed, and the form says why. The values typed are kept after every
 * reply.
 */
export function TravellerThresholdsForm({
  thresholds,
  available,
  unavailableMessage,
}: TravellerThresholdsFormProps) {
  const [state, formAction, pending] = useActionState(saveTravellerThresholdsAction, NO_REPLY);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-message`;
  const values: ThresholdsValues = state.values ?? {
    checkoutSuccessMinPercent: String(thresholds.checkoutSuccessMinPercent),
    confirmationMaxMinutes: String(thresholds.confirmationMaxMinutes),
    stuckConfirmingMax: String(thresholds.stuckConfirmingMax),
    needsCheckMax: String(thresholds.needsCheckMax),
  };

  return (
    <form ref={form} action={formAction} className="field-list form-narrow">
      {available ? null : <output className="notice notice-warn">{unavailableMessage}</output>}
      {/* A reply draws the boxes again from what was sent back, so the browser's reset after a
          reply never empties what was typed. */}
      <fieldset
        key={JSON.stringify(values)}
        className="form-section"
        disabled={available ? undefined : true}
      >
        <legend>Alert When</legend>
        <div className="form-grid">
          {BOXES.map((box) => {
            const hintId = `${id}-${box.name}-hint`;
            return (
              <div className="field-row" key={box.name}>
                <label className="field-label" htmlFor={`${id}-${box.name}`}>
                  {box.label}
                </label>
                <input
                  id={`${id}-${box.name}`}
                  name={box.name}
                  type="number"
                  inputMode="numeric"
                  min={box.min}
                  max={box.max}
                  step={1}
                  required
                  className="input"
                  defaultValue={values[box.name]}
                  {...fieldProblem(state, box.name, messageId, hintId)}
                />
                <p id={hintId} className="muted u-fs-085">
                  {box.hint}
                </p>
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className="page-actions">
        <SubmitButton
          pending={pending}
          idle="Save Thresholds"
          busy="Saving…"
          unavailable={!available}
        />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
