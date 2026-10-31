'use client';

import { AI_FEATURE_LIMIT_MAX, AI_FEATURE_LIMIT_MIN } from '@visastack/core/ai-features';
import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { saveAiFeatureAction } from './actions';
import { type AiFeatureFormState, type AiFeatureValues, LIMIT_NOTE } from './labels';

const NO_REPLY: AiFeatureFormState = { ok: true, message: '' };

export interface AiFeatureFormProps {
  readonly feature: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly adminDailyLimit: number | null;
  readonly planDailyLimit: number | null;
  /** What was typed before a fresh sign-in check, to save again; it was not saved yet. */
  readonly retry?: AiFeatureValues;
}

/**
 * One AI feature's switch and daily limit (S21). The reply is announced politely; a problem with
 * the limit puts focus on its box. What was typed is kept after every reply.
 */
export function AiFeatureForm({
  feature,
  name,
  enabled,
  adminDailyLimit,
  planDailyLimit,
  retry,
}: AiFeatureFormProps) {
  const [state, formAction, pending] = useActionState(saveAiFeatureAction, NO_REPLY);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-message`;
  const values: AiFeatureValues = state.values ??
    retry ?? {
      enabled,
      dailyLimit: adminDailyLimit === null ? '' : String(adminDailyLimit),
    };
  return (
    <form ref={form} action={formAction} className="field-list form-narrow">
      <input type="hidden" name="feature" value={feature} />
      {/* Drawn again from what was sent back, so the browser's reset never empties it. */}
      {retry && state === NO_REPLY ? (
        <output className="notice notice-warn">
          Your change was not saved yet. Check it below and choose Save again.
        </output>
      ) : null}
      <fieldset className="fieldset" key={JSON.stringify(values)}>
        <legend className="field-label">{name}</legend>
        <div className="form-grid">
          <div className="checks">
            <label className="check" htmlFor={`${id}-enabled`}>
              <input
                id={`${id}-enabled`}
                type="checkbox"
                name="enabled"
                defaultChecked={values.enabled}
              />
              <span>On for Everyone</span>
            </label>
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`${id}-limit`}>
              Daily Limit per Person
            </label>
            <input
              id={`${id}-limit`}
              name="dailyLimit"
              type="number"
              inputMode="numeric"
              min={AI_FEATURE_LIMIT_MIN}
              max={AI_FEATURE_LIMIT_MAX}
              step={1}
              className="input"
              defaultValue={values.dailyLimit}
              placeholder={planDailyLimit === null ? '' : String(planDailyLimit)}
              aria-describedby={[
                `${id}-limit-hint`,
                fieldProblem(state, 'dailyLimit', messageId)['aria-describedby'],
              ]
                .filter(Boolean)
                .join(' ')}
              {...(fieldProblem(state, 'dailyLimit', messageId)['aria-invalid']
                ? { 'aria-invalid': true as const }
                : {})}
            />
            <small className="muted" id={`${id}-limit-hint`}>
              {LIMIT_NOTE}
            </small>
          </div>
        </div>
      </fieldset>
      <div className="page-actions">
        <SubmitButton pending={pending} idle="Save" busy="Saving…" label={`Save: ${name}`} />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
