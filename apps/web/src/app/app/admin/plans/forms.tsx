'use client';

import { AI_FEATURE_KEYS, AI_FEATURE_LIMIT_MAX } from '@visastack/core/ai-features';
import { CAPACITY_KEYS, type CapacityKey } from '@visastack/core/entitlements';
import { useActionState, useEffect, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { retirePlanAction, savePlanAction } from './actions';
import {
  AI_ALLOWANCE_HINT,
  AI_LIMIT_HINT,
  PERIOD_LOCKED_NOTE,
  PRICE_CHANGE_NOTE,
  type PlanFormState,
  type PlanFormValues,
  RETIRE_NOTE,
  type RetireFormState,
  UNLIMITED_HINT,
  aiFeatureName,
  capacityLabel,
  featureLimitField,
  featureOnField,
  limitField,
} from './labels';

const NO_REPLY: PlanFormState = { ok: true, message: '' };
const NO_RETIRE_REPLY: RetireFormState = { ok: true, message: '' };

export interface PlanFormProps {
  /** Absent for the New Plan form. */
  readonly planId?: string;
  /** Shown in the button's name, so each Save on the page says which plan it saves. */
  readonly planName: string;
  /** What the form shows before anything is typed (field name to text). */
  readonly initial: PlanFormValues;
  readonly periodLocked: boolean;
  /** The traveller plan has no price and no billing period of its own to set. */
  readonly traveller: boolean;
  /** What was typed before a fresh sign-in check, to save again; it was not saved yet. */
  readonly retry?: PlanFormValues;
}

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined.length > 0 ? joined : undefined;
}

/**
 * One plan's name, period, price, limits and AI features (S29). The reply is announced politely;
 * a problem puts focus on its field and is linked to it; a new price is shown with what it means
 * before it is saved, with focus moved to that step; what was typed is kept after every reply.
 */
export function PlanForm({
  planId,
  planName,
  initial,
  periodLocked,
  traveller,
  retry,
}: PlanFormProps) {
  const [state, formAction, pending] = useActionState(savePlanAction, NO_REPLY);
  const form = useRef<HTMLFormElement>(null);
  const confirmStep = useRef<HTMLDivElement>(null);
  useFocusInvalidField(form, state);
  useEffect(() => {
    if (state.pricePreview && state.ok) confirmStep.current?.focus();
  }, [state]);
  const id = useId();
  const messageId = `${id}-message`;
  const values: PlanFormValues = state.values ?? retry ?? initial;
  const value = (name: string) => values[name] ?? '';
  const problem = (name: string) => fieldProblem(state, name, messageId);
  const input = (name: string, hintId?: string) => ({
    name,
    defaultValue: value(name),
    'aria-describedby': describedBy(hintId, problem(name)['aria-describedby']),
    ...(problem(name)['aria-invalid'] ? { 'aria-invalid': true as const } : {}),
  });
  const capacity = (key: CapacityKey) => (
    <div className="field-row" key={key}>
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {capacityLabel(key)}
      </label>
      <input
        id={`${id}-${key}`}
        type="text"
        inputMode="numeric"
        className="input"
        {...input(limitField(key), `${id}-${key}-hint`)}
      />
      <small className="muted" id={`${id}-${key}-hint`}>
        {key === 'ai_allowance_units' ? AI_ALLOWANCE_HINT : UNLIMITED_HINT}
      </small>
    </div>
  );
  return (
    <form ref={form} action={formAction} className="field-list">
      <input type="hidden" name="planId" value={planId ?? ''} />
      {retry && state === NO_REPLY ? (
        <output className="notice notice-warn">
          Your change was not saved yet. Check it below and choose Save again.
        </output>
      ) : null}
      <div key={JSON.stringify(values)} className="field-list">
        <div className="field-row">
          <label className="field-label" htmlFor={`${id}-name`}>
            Plan Name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            className="input"
            maxLength={80}
            {...input('name')}
          />
        </div>
        {traveller ? (
          <input type="hidden" name="periodDays" value={value('periodDays')} />
        ) : (
          <div className="field-row">
            <label className="field-label" htmlFor={`${id}-period`}>
              Billing Period (Days)
            </label>
            <input
              id={`${id}-period`}
              type="text"
              inputMode="numeric"
              className="input"
              readOnly={periodLocked}
              {...input('periodDays', periodLocked ? `${id}-period-hint` : undefined)}
            />
            {periodLocked ? (
              <small className="muted" id={`${id}-period-hint`}>
                {PERIOD_LOCKED_NOTE}
              </small>
            ) : null}
          </div>
        )}
        {traveller ? null : (
          <fieldset className="fieldset">
            <legend className="field-label">Price per Billing Period</legend>
            <div className="field-row">
              <label className="field-label" htmlFor={`${id}-price`}>
                Amount
              </label>
              <input
                id={`${id}-price`}
                type="text"
                inputMode="decimal"
                className="input"
                {...input('price', `${id}-price-hint`)}
              />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor={`${id}-currency`}>
                Currency
              </label>
              <input
                id={`${id}-currency`}
                type="text"
                className="input"
                maxLength={3}
                autoCapitalize="characters"
                {...input('currency', `${id}-price-hint`)}
              />
            </div>
            <small className="muted" id={`${id}-price-hint`}>
              Leave both empty for a plan with no price. {planId ? PRICE_CHANGE_NOTE : ''}
            </small>
          </fieldset>
        )}
        <fieldset className="fieldset">
          <legend className="field-label">Limits</legend>
          {CAPACITY_KEYS.map(capacity)}
        </fieldset>
        <fieldset className="fieldset">
          <legend className="field-label">AI Features</legend>
          {AI_FEATURE_KEYS.map((feature) => (
            <div className="field-row" key={feature}>
              <div className="checks">
                <label className="check" htmlFor={`${id}-${feature}-on`}>
                  <input
                    id={`${id}-${feature}-on`}
                    type="checkbox"
                    name={featureOnField(feature)}
                    defaultChecked={value(featureOnField(feature)) === 'on'}
                  />
                  <span>{aiFeatureName(feature)}</span>
                </label>
              </div>
              <label className="field-label" htmlFor={`${id}-${feature}-limit`}>
                Daily Limit per Person: {aiFeatureName(feature)}
              </label>
              <input
                id={`${id}-${feature}-limit`}
                type="number"
                inputMode="numeric"
                min={0}
                max={AI_FEATURE_LIMIT_MAX}
                step={1}
                className="input"
                {...input(featureLimitField(feature), `${id}-${feature}-hint`)}
              />
              <small className="muted" id={`${id}-${feature}-hint`}>
                {AI_LIMIT_HINT}
              </small>
            </div>
          ))}
        </fieldset>
      </div>
      {state.pricePreview ? (
        <div
          ref={confirmStep}
          tabIndex={-1}
          className="notice notice-warn"
          aria-labelledby={`${id}-price-step`}
        >
          <p id={`${id}-price-step`}>
            <strong>Before You Save the New Price.</strong> {PRICE_CHANGE_NOTE}
          </p>
          <input type="hidden" name="pricePreviewed" value="yes" />
          <div className="checks">
            <label className="check" htmlFor={`${id}-confirm-price`}>
              <input
                id={`${id}-confirm-price`}
                type="checkbox"
                name="confirmPrice"
                value="yes"
                {...(problem('confirmPrice')['aria-invalid']
                  ? { 'aria-invalid': true as const, 'aria-describedby': messageId }
                  : {})}
              />
              <span>I Understand the New Price Applies from the Next Billing Period</span>
            </label>
          </div>
        </div>
      ) : null}
      <div className="page-actions">
        <SubmitButton pending={pending} idle="Save" busy="Saving…" label={`Save: ${planName}`} />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

/**
 * Retire one plan (S29): the first press shows how many agencies keep it, the second, with the
 * box ticked, retires it. Focus moves to the confirming step when it appears.
 */
export function RetirePlanForm({
  planId,
  planName,
}: { readonly planId: string; readonly planName: string }) {
  const [state, formAction, pending] = useActionState(retirePlanAction, NO_RETIRE_REPLY);
  const form = useRef<HTMLFormElement>(null);
  const confirmStep = useRef<HTMLDivElement>(null);
  useFocusInvalidField(form, state);
  useEffect(() => {
    if (state.agenciesKeepingIt !== undefined && state.ok) confirmStep.current?.focus();
  }, [state]);
  const id = useId();
  const messageId = `${id}-message`;
  const keeping = state.agenciesKeepingIt;
  return (
    <form ref={form} action={formAction} className="field-list">
      <input type="hidden" name="planId" value={planId} />
      <p className="muted u-fs-085">{RETIRE_NOTE}</p>
      {keeping !== undefined ? (
        <div ref={confirmStep} tabIndex={-1} className="notice notice-warn">
          <p>
            {keeping === 0
              ? 'No agency is on this plan now.'
              : keeping === 1
                ? '1 agency is on this plan now and keeps it.'
                : `${keeping} agencies are on this plan now and keep it.`}
          </p>
          <input type="hidden" name="retirePreviewed" value="yes" />
          <div className="checks">
            <label className="check" htmlFor={`${id}-confirm`}>
              <input
                id={`${id}-confirm`}
                type="checkbox"
                name="confirmRetire"
                value="yes"
                {...(fieldProblem(state, 'confirmRetire', messageId)['aria-invalid']
                  ? { 'aria-invalid': true as const, 'aria-describedby': messageId }
                  : {})}
              />
              <span>Retire {planName}</span>
            </label>
          </div>
        </div>
      ) : null}
      <div className="page-actions">
        <SubmitButton
          pending={pending}
          idle="Retire Plan"
          busy="Retiring…"
          className="btn btn-secondary"
          label={`Retire Plan: ${planName}`}
        />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
