'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { saveBillingRulesAction } from './actions';
import {
  type BillingRulesPreview,
  type BillingRulesState,
  type BillingRulesValues,
  previewSentence,
} from './labels';

export interface BillingRulesFormProps {
  readonly dueDays: number;
  readonly overdueHandlingEnabled: boolean;
  readonly graceAfterDays: number | null;
  readonly suspendAfterDays: number | null;
}

const NO_REPLY: BillingRulesState = { ok: true, message: '' };

/** A field's own hint plus, when the reply is about it, the reply's message. */
function described(
  hintId: string,
  problem: { 'aria-invalid'?: true; 'aria-describedby'?: string },
): { 'aria-invalid'?: true; 'aria-describedby': string } {
  return {
    ...(problem['aria-invalid'] ? { 'aria-invalid': true as const } : {}),
    'aria-describedby': [hintId, problem['aria-describedby']].filter(Boolean).join(' '),
  };
}

/**
 * The billing rules: when an invoice falls due, and whether an unpaid one moves the agency to
 * Grace and then Suspended. Turning that on, or changing its day counts while it is on, is saved
 * only after the server has shown how many agencies those exact day counts move today and the
 * box next to that preview is ticked. The values typed are kept after every reply.
 */
export function BillingRulesForm({
  dueDays,
  overdueHandlingEnabled,
  graceAfterDays,
  suspendAfterDays,
}: BillingRulesFormProps) {
  const [state, formAction, pending] = useActionState(saveBillingRulesAction, NO_REPLY);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-message`;
  const values: BillingRulesValues = state.values ?? {
    dueDays: String(dueDays),
    overdueHandling: overdueHandlingEnabled ? 'on' : 'off',
    graceAfterDays: graceAfterDays === null ? '' : String(graceAfterDays),
    suspendAfterDays: suspendAfterDays === null ? '' : String(suspendAfterDays),
  };

  return (
    <form ref={form} action={formAction} className="field-list">
      {/* A reply with other values or a new preview draws the fields again from what was sent
          back, so the browser's reset after a reply never empties what was typed. */}
      <RulesFields
        key={JSON.stringify([values, state.preview ?? null])}
        id={id}
        values={values}
        preview={state.preview}
        state={state}
        messageId={messageId}
      />
      <div className="page-actions">
        <SubmitButton pending={pending} idle="Save Billing Rules" busy="Saving…" />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

function RulesFields({
  id,
  values,
  preview,
  state,
  messageId,
}: {
  readonly id: string;
  readonly values: BillingRulesValues;
  readonly preview: BillingRulesPreview | undefined;
  readonly state: BillingRulesState;
  readonly messageId: string;
}) {
  const [on, setOn] = useState(values.overdueHandling === 'on');
  const previewId = `${id}-preview`;
  return (
    <>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-due`}>
          Payment Due After (Days)
        </label>
        <input
          id={`${id}-due`}
          name="dueDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          step={1}
          required
          className="input"
          defaultValue={values.dueDays}
          {...described(`${id}-due-hint`, fieldProblem(state, 'dueDays', messageId))}
        />
        <p id={`${id}-due-hint`} className="muted u-fs-085">
          Counted from the day each billing period starts, or from the day the invoice is made if
          that is later.
        </p>
      </div>

      <fieldset className="field-row">
        <legend className="field-label">Automatic Grace and Suspended</legend>
        <label>
          <input
            type="radio"
            name="overdueHandling"
            value="off"
            defaultChecked={!on}
            onChange={() => setOn(false)}
          />{' '}
          Off
        </label>
        <label>
          <input
            type="radio"
            name="overdueHandling"
            value="on"
            defaultChecked={on}
            onChange={() => setOn(true)}
          />{' '}
          On
        </label>
      </fieldset>

      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-grace`}>
          Move to Grace (Days After the Due Date)
        </label>
        <input
          id={`${id}-grace`}
          name="graceAfterDays"
          type="number"
          inputMode="numeric"
          min={0}
          max={364}
          step={1}
          className="input"
          defaultValue={values.graceAfterDays}
          required={on}
          aria-required={on ? true : undefined}
          {...fieldProblem(state, 'graceAfterDays', messageId)}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-suspend`}>
          Suspend (Days After the Due Date)
        </label>
        <input
          id={`${id}-suspend`}
          name="suspendAfterDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          step={1}
          className="input"
          defaultValue={values.suspendAfterDays}
          required={on}
          aria-required={on ? true : undefined}
          {...described(`${id}-suspend-hint`, fieldProblem(state, 'suspendAfterDays', messageId))}
        />
        <p id={`${id}-suspend-hint`} className="muted u-fs-085">
          Later than Grace. Nothing moves before the day after the due date. Leave both empty while
          you have not decided.
        </p>
      </div>

      {preview ? (
        <div className="field-row">
          <p id={previewId} className="notice notice-warn">
            {previewSentence(preview)} (Grace after {preview.graceAfterDays}, Suspended after{' '}
            {preview.suspendAfterDays} days.)
          </p>
          <input type="hidden" name="previewGraceAfterDays" value={preview.graceAfterDays} />
          <input type="hidden" name="previewSuspendAfterDays" value={preview.suspendAfterDays} />
          <label>
            <input
              type="checkbox"
              name="confirmed"
              value="yes"
              {...described(previewId, fieldProblem(state, 'confirmed', messageId))}
            />{' '}
            I have seen how many agencies this moves today
          </label>
        </div>
      ) : null}
    </>
  );
}
