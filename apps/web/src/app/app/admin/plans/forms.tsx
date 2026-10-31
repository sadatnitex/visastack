'use client';

import { AI_AGENCY_FEATURE_KEYS, AI_TRAVELLER_FEATURE_KEYS } from '@visastack/core/ai-features';
import {
  type CapacityKey,
  TRAVELLER_STORAGE_KEYS,
  type TravellerStorageKey,
} from '@visastack/core/entitlements';
import { useActionState, useEffect, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { retirePlanAction, savePlanAction } from './actions';
import {
  AGENCY_AI_LIMIT_HINT,
  AGENCY_AI_NOTE,
  AI_ALLOWANCE_HINT,
  AI_LIMIT_HINT,
  EDITABLE_CAPACITY_KEYS,
  PERIOD_LOCKED_NOTE,
  PRICE_CHANGE_NOTE,
  type PlanFormState,
  type PlanFormValues,
  type PlanKind,
  RETIRED_LINE,
  RETIRE_NOTE,
  type RetireFormState,
  TRAVELLER_FLOOR_NOTE,
  TRAVELLER_PERIOD_LOCKED_NOTE,
  TRAVELLER_PRICE_CHANGE_STEP,
  TRAVELLER_PRICE_NOTE,
  TRAVELLER_RETIRED_LINE,
  TRAVELLER_RETIRE_NOTE,
  UNLIMITED_HINT,
  aiFeatureName,
  capacityLabel,
  featureLimitField,
  featureOnField,
  keepingWords,
  limitField,
  shownField,
  storageKeysOf,
  travellerFreeStorageNote,
  travellerStorageHint,
  travellerStorageLabel,
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
  /**
   * Which plan it edits: an agency plan; Traveller Free (no price, no period of its own, storage
   * from the upload settings); or a paid traveller plan (a price in BDT, storage and AI rules).
   */
  readonly kind: PlanKind;
  /** The upload settings a traveller storage rule follows when empty, in bytes. */
  readonly uploadDefaults: { readonly accountBytes: number; readonly personBytes: number };
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
  kind,
  uploadDefaults,
  retry,
}: PlanFormProps) {
  const traveller = kind !== 'agency';
  const free = kind === 'traveller_free';
  const [state, formAction, pending] = useActionState(savePlanAction, NO_REPLY);
  const form = useRef<HTMLFormElement>(null);
  const confirmStep = useRef<HTMLFieldSetElement>(null);
  const notSaved = useRef<HTMLOutputElement>(null);
  useFocusInvalidField(form, state);
  useEffect(() => {
    if (state.pricePreview && state.ok) confirmStep.current?.focus();
  }, [state]);
  // Back from the fresh sign-in check: focus starts on the notice that the change waits.
  useEffect(() => {
    if (retry) notSaved.current?.focus();
  }, [retry]);
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
  const storage = (key: TravellerStorageKey) => (
    <div className="field-row" key={key}>
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {travellerStorageLabel(key)}
      </label>
      <input
        id={`${id}-${key}`}
        type="text"
        inputMode="numeric"
        className="input"
        {...input(limitField(key), `${id}-${key}-hint`)}
      />
      <small className="muted" id={`${id}-${key}-hint`}>
        {travellerStorageHint(
          key === 'account_storage_bytes'
            ? uploadDefaults.accountBytes
            : uploadDefaults.personBytes,
        )}
      </small>
    </div>
  );
  return (
    <form ref={form} action={formAction} className="field-list form-narrow">
      <input type="hidden" name="planId" value={planId ?? ''} />
      <input type="hidden" name="audience" value={traveller ? 'TRAVELLER' : 'AGENCY'} />
      {kind === 'traveller' ? <input type="hidden" name="fixedCurrency" value="yes" /> : null}
      {planId
        ? storageKeysOf(kind).map((key) => (
            <input
              key={key}
              type="hidden"
              name={shownField(key)}
              value={initial[limitField(key)] ?? ''}
            />
          ))
        : null}
      {retry && state === NO_REPLY ? (
        <output className="notice notice-warn" ref={notSaved} tabIndex={-1}>
          Your change was not saved yet. Check it below and choose Save again.
        </output>
      ) : null}
      <div key={JSON.stringify(values)} className="field-list">
        <fieldset className="form-section">
          <legend>Plan Details</legend>
          <div className="form-grid">
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
            {free ? (
              <input type="hidden" name="periodDays" value={value('periodDays')} />
            ) : (
              <div className="field-row">
                <label className="field-label" htmlFor={`${id}-period`}>
                  {traveller ? 'Period (Days)' : 'Billing Period (Days)'}
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
                    {traveller ? TRAVELLER_PERIOD_LOCKED_NOTE : PERIOD_LOCKED_NOTE}
                  </small>
                ) : null}
              </div>
            )}
          </div>
        </fieldset>
        {kind === 'traveller' ? (
          <fieldset className="form-section">
            <legend>Price per Period</legend>
            <div className="form-grid">
              <div className="field-row">
                <label className="field-label" htmlFor={`${id}-price`}>
                  Amount (BDT)
                </label>
                <input
                  id={`${id}-price`}
                  type="text"
                  inputMode="decimal"
                  className="input"
                  {...input('price', `${id}-price-hint`)}
                />
              </div>
            </div>
            <small className="muted" id={`${id}-price-hint`}>
              {TRAVELLER_PRICE_NOTE}
            </small>
          </fieldset>
        ) : null}
        {traveller ? null : (
          <fieldset className="form-section">
            <legend>Price per Billing Period</legend>
            <div className="form-grid">
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
            </div>
            <small className="muted" id={`${id}-price-hint`}>
              Leave both empty for a plan with no price. {planId ? PRICE_CHANGE_NOTE : ''}
            </small>
          </fieldset>
        )}
        {free ? (
          <p className="muted u-fs-085">
            {travellerFreeStorageNote(uploadDefaults.accountBytes, uploadDefaults.personBytes)}
          </p>
        ) : kind === 'traveller' ? (
          <fieldset className="form-section">
            <legend>Storage</legend>
            <div className="form-grid">{TRAVELLER_STORAGE_KEYS.map(storage)}</div>
            <p className="muted u-fs-085">{TRAVELLER_FLOOR_NOTE}</p>
          </fieldset>
        ) : (
          <fieldset className="form-section">
            <legend>Limits</legend>
            <div className="form-grid">{EDITABLE_CAPACITY_KEYS.map(capacity)}</div>
          </fieldset>
        )}
        <fieldset className="form-section">
          <legend>AI Features</legend>
          <div className="form-grid">
            {(traveller ? AI_TRAVELLER_FEATURE_KEYS : AI_AGENCY_FEATURE_KEYS).map((feature) => (
              <div className="field-row" key={feature}>
                <div className="checks">
                  <label className="check" htmlFor={`${id}-${feature}-on`}>
                    <input
                      id={`${id}-${feature}-on`}
                      type="checkbox"
                      name={featureOnField(feature)}
                      defaultChecked={value(featureOnField(feature)) === 'on'}
                      {...(problem(featureOnField(feature))['aria-invalid']
                        ? { 'aria-invalid': true as const, 'aria-describedby': messageId }
                        : {})}
                    />
                    <span>{aiFeatureName(feature)}</span>
                  </label>
                </div>
                <label className="field-label" htmlFor={`${id}-${feature}-limit`}>
                  {traveller ? 'Daily Limit per Person' : 'Daily Limit per Agency'}:{' '}
                  {aiFeatureName(feature)}
                </label>
                <input
                  id={`${id}-${feature}-limit`}
                  type="text"
                  inputMode="numeric"
                  className="input"
                  {...input(featureLimitField(feature), `${id}-${feature}-hint`)}
                />
                <small className="muted" id={`${id}-${feature}-hint`}>
                  {traveller ? AI_LIMIT_HINT : AGENCY_AI_LIMIT_HINT}
                </small>
              </div>
            ))}
          </div>
          {traveller ? null : <p className="muted u-fs-085">{AGENCY_AI_NOTE}</p>}
        </fieldset>
      </div>
      {state.pricePreview ? (
        <fieldset
          ref={confirmStep}
          tabIndex={-1}
          className="fieldset notice notice-warn"
          aria-describedby={`${id}-price-step`}
        >
          <legend className="field-label">Before You Save the New Price</legend>
          <p id={`${id}-price-step`}>
            {state.pricePreview.before
              ? `The price changes from ${state.pricePreview.before} to ${state.pricePreview.after}.`
              : `The plan gets a price of ${state.pricePreview.after}.`}{' '}
            {traveller ? TRAVELLER_PRICE_CHANGE_STEP : PRICE_CHANGE_NOTE}
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
              <span>
                {traveller
                  ? 'I Understand the New Price Applies to Purchases from Now'
                  : 'I Understand the New Price Applies from the Next Billing Period'}
              </span>
            </label>
          </div>
        </fieldset>
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
  headingId,
  retired = false,
  audience = 'AGENCY',
}: {
  readonly planId: string;
  readonly planName: string;
  /** Who the plan is for: the words say agencies or people (ADR 0025). */
  readonly audience?: 'AGENCY' | 'TRAVELLER';
  /** The plan card's heading, where focus goes once the plan is retired. */
  readonly headingId: string;
  /** The plan is retired: the card keeps a polite line saying so, and no button. */
  readonly retired?: boolean;
}) {
  const [state, formAction, pending] = useActionState(retirePlanAction, NO_RETIRE_REPLY);
  const form = useRef<HTMLFormElement>(null);
  const confirmStep = useRef<HTMLFieldSetElement>(null);
  useFocusInvalidField(form, state);
  useEffect(() => {
    if (state.agenciesKeepingIt !== undefined && state.ok) confirmStep.current?.focus();
  }, [state]);
  // Once retired, focus moves to the card's heading, where the polite line below is read.
  useEffect(() => {
    if (state.ok && state.retired) document.getElementById(headingId)?.focus();
  }, [state, headingId]);
  const id = useId();
  const messageId = `${id}-message`;
  const keeping = state.agenciesKeepingIt;
  if (retired || (state.ok && state.retired)) {
    return (
      <output className="notice">
        {audience === 'TRAVELLER' ? TRAVELLER_RETIRED_LINE : RETIRED_LINE}
      </output>
    );
  }
  return (
    <form ref={form} action={formAction} className="field-list">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="audience" value={audience} />
      <p className="muted u-fs-085">
        {audience === 'TRAVELLER' ? TRAVELLER_RETIRE_NOTE : RETIRE_NOTE}
      </p>
      {keeping !== undefined ? (
        <fieldset ref={confirmStep} tabIndex={-1} className="fieldset notice notice-warn">
          <legend className="field-label">Retire {planName}</legend>
          <p>{keepingWords(keeping, audience)}</p>
          {state.waiting ? (
            <p>{state.waiting}</p>
          ) : (
            <>
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
            </>
          )}
        </fieldset>
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
