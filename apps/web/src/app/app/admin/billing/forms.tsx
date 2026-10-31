'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
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
  confirmLabel,
  previewDays,
  previewSentence,
} from './labels';

export interface BillingRulesFormProps {
  readonly dueDays: number;
  readonly overdueHandlingEnabled: boolean;
  readonly graceAfterDays: number | null;
  readonly suspendAfterDays: number | null;
}

const NO_REPLY: BillingRulesState = { ok: true, message: '' };

/** A field's own hints plus, when the reply is about it, the reply's message. */
function described(
  hintIds: readonly string[],
  problem: { 'aria-invalid'?: true; 'aria-describedby'?: string },
): { 'aria-invalid'?: true; 'aria-describedby': string } {
  return {
    ...(problem['aria-invalid'] ? { 'aria-invalid': true as const } : {}),
    'aria-describedby': [...hintIds, problem['aria-describedby']].filter(Boolean).join(' '),
  };
}

/**
 * The billing rules: when an invoice falls due, and whether an unpaid one moves the agency to
 * Grace and then Suspended. Turning that on, or changing its day counts while it is on, is saved
 * only after the server has shown how many agencies those exact day counts move today and the
 * box next to that preview is ticked. The preview is information, not an error: it is announced
 * politely and focus moves to its box. The values typed are kept after every reply.
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
    <form ref={form} action={formAction} className="field-list form-narrow">
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
  const confirmBox = useRef<HTMLInputElement>(null);
  const previewId = `${id}-preview`;
  const graceHint = `${id}-grace-hint`;
  const suspendHint = `${id}-suspend-hint`;
  const bothHint = `${id}-both-hint`;
  // A new preview (this part is drawn again for each one) takes focus to its box. A save with the
  // box unticked is a problem instead, and the shared form code focuses the box for that.
  const newPreview = preview !== undefined && state.ok;
  useEffect(() => {
    if (newPreview) confirmBox.current?.focus();
  }, [newPreview]);
  return (
    <>
      <fieldset className="form-section">
        <legend>Due Date</legend>
        <div className="form-grid">
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
              {...described([`${id}-due-hint`], fieldProblem(state, 'dueDays', messageId))}
            />
            <p id={`${id}-due-hint`} className="muted u-fs-085">
              Counted from the day each billing period starts, or from the day the invoice is made
              if that is later.
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Unpaid Invoices</legend>
        <div className="form-grid">
          <div className="field-wide">
            <fieldset className="fieldset">
              <legend className="field-label">
                Move Unpaid Agencies to Grace and Suspended Automatically
              </legend>
              <label className="check">
                <input
                  type="radio"
                  name="overdueHandling"
                  value="off"
                  defaultChecked={!on}
                  onChange={() => setOn(false)}
                />
                Off
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="overdueHandling"
                  value="on"
                  defaultChecked={on}
                  onChange={() => setOn(true)}
                />
                On
              </label>
            </fieldset>
          </div>

          <div className="field-row">
            <label className="field-label" htmlFor={`${id}-grace`}>
              Move to Grace (Days After the Due Date)
            </label>
            <input
              id={`${id}-grace`}
              name="graceAfterDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={364}
              step={1}
              className="input"
              defaultValue={values.graceAfterDays}
              required={on}
              aria-required={on ? true : undefined}
              {...described(
                [graceHint, bothHint],
                fieldProblem(state, 'graceAfterDays', messageId),
              )}
            />
            <p id={graceHint} className="muted u-fs-085">
              1 means the day after the due date. Used only when this is On.
            </p>
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
              min={2}
              max={365}
              step={1}
              className="input"
              defaultValue={values.suspendAfterDays}
              required={on}
              aria-required={on ? true : undefined}
              {...described(
                [suspendHint, bothHint],
                fieldProblem(state, 'suspendAfterDays', messageId),
              )}
            />
            <p id={suspendHint} className="muted u-fs-085">
              Later than Grace, so 2 or more. Used only when this is On.
            </p>
            <p id={bothHint} className="muted u-fs-085">
              Leave both day counts empty while you have not decided.
            </p>
          </div>

          {preview ? (
            <div className="field-row field-wide">
              <output id={previewId} className="notice notice-warn">
                {previewSentence(preview)} {previewDays(preview)}
              </output>
              <input type="hidden" name="previewGraceAfterDays" value={preview.graceAfterDays} />
              <input
                type="hidden"
                name="previewSuspendAfterDays"
                value={preview.suspendAfterDays}
              />
              <label className="check">
                <input
                  ref={confirmBox}
                  type="checkbox"
                  name="confirmed"
                  value="yes"
                  {...described([previewId], fieldProblem(state, 'confirmed', messageId))}
                />
                {confirmLabel(preview)}
              </label>
            </div>
          ) : null}
        </div>
      </fieldset>
    </>
  );
}
